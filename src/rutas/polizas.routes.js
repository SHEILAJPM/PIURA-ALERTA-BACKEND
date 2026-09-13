import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { validarBody } from "../intermediarios/validate.js";
import { checkoutSeguroSchema } from "../validacion/schemas.js";
import { crearSesionCheckout, PLANES_SEGURO, calcularPrecioCentavos } from "../servicios/pagos.js";

const router = Router();

router.get("/planes", (_req, res) => {
  const planes = Object.values(PLANES_SEGURO).map((plan) => ({
    meses: plan.meses,
    descuento: plan.descuento,
    precio_centavos: calcularPrecioCentavos(plan.meses),
  }));
  res.json(planes);
});

router.post("/checkout", requerirSesion, validarBody(checkoutSeguroSchema), async (req, res, next) => {
  try {
    const { meses } = req.body;
    const { rows } = await pool.query("SELECT correo FROM usuarios WHERE id = $1", [req.usuario.id]);
    const session = await crearSesionCheckout({ usuarioId: req.usuario.id, correo: rows[0].correo, meses });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.get("/mia", requerirSesion, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT meses, precio_centavos, moneda, fecha_inicio, fecha_fin
       FROM polizas_seguro
       WHERE usuario_id = $1
       ORDER BY fecha_fin DESC
       LIMIT 1`,
      [req.usuario.id]
    );
    const poliza = rows[0] ?? null;
    res.json({ vigente: poliza ? new Date(poliza.fecha_fin) > new Date() : false, poliza });
  } catch (err) {
    next(err);
  }
});

// Panel admin: quién contrató, cuánto pagó y cuándo vence cada póliza. Sin
// esto el seguro es una caja negra -- el checkout y el webhook funcionan,
// pero nadie del lado operativo puede ver el resultado.
router.get("/", requerirSesion, requerirRol("administrador"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.meses, p.precio_centavos, p.moneda, p.fecha_inicio, p.fecha_fin, p.creado_en,
              u.id AS usuario_id, u.nombre AS usuario_nombre, u.correo AS usuario_correo
       FROM polizas_seguro p
       JOIN usuarios u ON u.id = p.usuario_id
       ORDER BY p.fecha_fin DESC
       LIMIT 200`
    );
    const ahora = new Date();
    const polizas = rows.map((p) => ({ ...p, vigente: new Date(p.fecha_fin) > ahora }));
    res.json(polizas);
  } catch (err) {
    next(err);
  }
});

export default router;

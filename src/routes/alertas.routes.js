import { Router } from "express";
import { pool } from "../../db/pool.js";
import { validarBody } from "../middleware/validate.js";
import { difusionSchema } from "../validation/schemas.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";
import { enviarMensajeATodos } from "../services/telegram.js";
import { registrarAccion } from "../services/auditoria.js";

const router = Router();

// Historial público de cambios de estado del río (transparencia hacia la
// comunidad): no requiere sesión, cualquiera puede ver qué pasó y cuándo.
router.get("/historial", async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 30, 1), 100);
    const { rows } = await pool.query(
      `SELECT e.id, e.estado_anterior, e.estado_nuevo, e.nivel_cm, e.iniciado_en,
              s.codigo AS sensor_codigo, s.nombre AS sensor_nombre
       FROM eventos_alerta e
       JOIN sensores s ON s.id = e.sensor_id
       ORDER BY e.iniciado_en DESC
       LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Difusión manual (a diferencia del aviso automático de alertEngine.js, que
// solo se dispara en un cambio de estado del río): exclusiva de Defensa
// Civil/COER y administrador -- operario no redacta avisos a la población.
router.post(
  "/difundir",
  requerirSesion,
  requerirRol("defensa_civil", "administrador"),
  limitadorEscrituraPublica,
  validarBody(difusionSchema),
  async (req, res, next) => {
    try {
      const { mensaje } = req.body;
      const resultado = await enviarMensajeATodos(`📣 AVISO DE DEFENSA CIVIL\n\n${mensaje}`);
      await registrarAccion({
        usuario: req.usuario,
        accion: "difusion_manual",
        detalle: mensaje.slice(0, 200),
      });
      res.json({ enviado_a: resultado.enviados });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

import { Router } from "express";
import { pool } from "../../db/pool.js";
import { validarBody } from "../middleware/validate.js";
import { rolSchema } from "../validation/schemas.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";
import { registrarAccion } from "../services/auditoria.js";

const router = Router();

// Cambiar el rol de una cuenta es exclusivo de administrador (ver
// ROLES_ADMINISTRADOR en el frontend) -- operario y defensa_civil no deben
// poder otorgarse permisos entre ellos ni a sí mismos.
const SOLO_ADMINISTRADOR = requerirRol("administrador");

// Nunca se devuelve password_hash/dni/telefono/direccion aquí: mismo criterio
// que GET /api/auth/yo (ver docs/plans/2026-08-16-reportes-modo-insta-design.md).
router.get("/", requerirSesion, SOLO_ADMINISTRADOR, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, correo, rol, creado_en FROM usuarios ORDER BY creado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/rol",
  requerirSesion,
  SOLO_ADMINISTRADOR,
  validarBody(rolSchema),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `UPDATE usuarios SET rol = $1 WHERE id = $2 RETURNING id, nombre, correo, rol`,
        [req.body.rol, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      await registrarAccion({
        usuario: req.usuario,
        accion: "cambiar_rol",
        detalle: `${rows[0].nombre} (${rows[0].correo}) -> ${rows[0].rol}`,
      });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

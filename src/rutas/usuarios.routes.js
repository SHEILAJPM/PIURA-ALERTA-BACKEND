import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import { rolSchema, activoUsuarioSchema } from "../validacion/schemas.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { registrarAccion } from "../servicios/auditoria.js";

const router = Router();

// Cambiar el rol de una cuenta es exclusivo de administrador (ver
// ROLES_ADMINISTRADOR en el frontend) -- operario y defensa_civil no deben
// poder otorgarse permisos entre ellos ni a sí mismos.
const SOLO_ADMINISTRADOR = requerirRol("administrador");

// Nunca se devuelve password_hash/dni/telefono/direccion aquí: mismo criterio
// que GET /api/auth/yo (ver documentacion/plans/2026-08-16-reportes-modo-insta-design.md).
router.get("/", requerirSesion, SOLO_ADMINISTRADOR, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, correo, rol, activo, creado_en FROM usuarios ORDER BY creado_en DESC`
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

// "Eliminar" una cuenta desde el panel es desactivarla (ver activo en
// schema.sql) -- un DELETE real chocaría contra las llaves foráneas de
// reportes/pólizas/auditoría en cuanto la cuenta tuviera cualquier actividad.
router.patch(
  "/:id/activo",
  requerirSesion,
  SOLO_ADMINISTRADOR,
  validarBody(activoUsuarioSchema),
  async (req, res, next) => {
    try {
      // Nadie se desactiva a sí mismo desde acá -- evita que un admin se
      // quede afuera por error (y sin nadie más con sesión para revertirlo).
      if (req.params.id === req.usuario.id) {
        return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
      }

      const { rows } = await pool.query(
        `UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, correo, rol, activo`,
        [req.body.activo, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
      }
      await registrarAccion({
        usuario: req.usuario,
        accion: rows[0].activo ? "activar_usuario" : "desactivar_usuario",
        detalle: `${rows[0].nombre} (${rows[0].correo})`,
      });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

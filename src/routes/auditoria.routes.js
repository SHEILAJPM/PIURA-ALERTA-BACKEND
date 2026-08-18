import { Router } from "express";
import { pool } from "../../db/pool.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";

const router = Router();

// Solo administrador ve el log completo de acciones del panel (incluye
// quién cambió qué, para todas las secciones -- no solo las propias).
router.get("/", requerirSesion, requerirRol("administrador"), async (req, res, next) => {
  try {
    const limite = Number(req.query.limite ?? 100);
    const { rows } = await pool.query(
      `SELECT id, usuario_nombre, accion, detalle, creado_en
       FROM auditoria_acciones
       ORDER BY creado_en DESC
       LIMIT $1`,
      [limite]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;

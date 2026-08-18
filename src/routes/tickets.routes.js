import { Router } from "express";
import { pool } from "../../db/pool.js";
import { validarBody } from "../middleware/validate.js";
import { ticketSchema, ticketEstadoSchema } from "../validation/schemas.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";
import { registrarAccion } from "../services/auditoria.js";

const router = Router();

// Abrir/atender tickets es tarea de cualquier rol operativo, no solo del
// operador técnico (defensa civil también puede reportar un nodo caído).
const ROLES_STAFF = requerirRol("operario", "defensa_civil", "administrador");

router.get("/", requerirSesion, ROLES_STAFF, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.titulo, t.descripcion, t.prioridad, t.estado, t.creado_en, t.actualizado_en,
              s.codigo AS sensor_codigo, s.nombre AS sensor_nombre
       FROM tickets_mantenimiento t
       LEFT JOIN sensores s ON s.id = t.sensor_id
       ORDER BY (t.estado = 'cerrado'), t.creado_en DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requerirSesion,
  ROLES_STAFF,
  limitadorEscrituraPublica,
  validarBody(ticketSchema),
  async (req, res, next) => {
    try {
      const { sensor_id: sensorId, titulo, descripcion, prioridad } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO tickets_mantenimiento (sensor_id, titulo, descripcion, prioridad, creado_por)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, titulo, descripcion, prioridad, estado, creado_en, actualizado_en`,
        [sensorId ?? null, titulo, descripcion ?? null, prioridad, req.usuario.id]
      );
      await registrarAccion({ usuario: req.usuario, accion: "crear_ticket", detalle: titulo });
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id/estado",
  requerirSesion,
  ROLES_STAFF,
  validarBody(ticketEstadoSchema),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `UPDATE tickets_mantenimiento SET estado = $1, actualizado_en = now()
         WHERE id = $2
         RETURNING id, estado`,
        [req.body.estado, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Ticket no encontrado" });
      }
      await registrarAccion({
        usuario: req.usuario,
        accion: "actualizar_ticket",
        detalle: `#${rows[0].id} -> ${rows[0].estado}`,
      });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

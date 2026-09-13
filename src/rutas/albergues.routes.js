import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import { albergueSchema, ocupacionSchema } from "../validacion/schemas.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { transmitir } from "../servicios/websocket.js";

const router = Router();

// Crear albergues y actualizar su ocupación es tarea operativa (operario,
// defensa civil o admin), no algo que cualquier visitante deba poder hacer.
const ROLES_GESTION_ALBERGUES = requerirRol("operario", "defensa_civil", "administrador");

router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, direccion, capacidad, ocupacion_actual,
              ST_AsGeoJSON(ubicacion)::json AS ubicacion, activo
       FROM albergues
       WHERE activo = true
       ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  "/",
  requerirSesion,
  ROLES_GESTION_ALBERGUES,
  limitadorEscrituraPublica,
  validarBody(albergueSchema),
  async (req, res, next) => {
    try {
      const { nombre, direccion, capacidad, lon, lat } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO albergues (nombre, direccion, capacidad, ubicacion)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
       RETURNING id, nombre, direccion, capacidad, ocupacion_actual,
                 ST_AsGeoJSON(ubicacion)::json AS ubicacion, activo`,
        [nombre, direccion ?? null, capacidad, lon, lat]
      );
      // Todos los que tengan el mapa/reportes abiertos ven el albergue nuevo
      // sin recargar -- mismo espíritu que reporte_ciudadano en reportes.routes.js.
      transmitir("albergue_creado", rows[0]);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// Baja lógica, no DELETE de la fila: si el albergue tuvo reportes u ocupación
// registrada en el pasado, borrarlo de verdad rompería ese historial. Por
// eso GET / ya filtra por activo = true.
router.delete(
  "/:id",
  requerirSesion,
  ROLES_GESTION_ALBERGUES,
  limitadorEscrituraPublica,
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `UPDATE albergues SET activo = false, actualizado_en = now()
         WHERE id = $1
         RETURNING id`,
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Albergue no encontrado" });
      }
      transmitir("albergue_eliminado", { id: rows[0].id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/:id/ocupacion",
  requerirSesion,
  ROLES_GESTION_ALBERGUES,
  limitadorEscrituraPublica,
  validarBody(ocupacionSchema),
  async (req, res, next) => {
    try {
      const { ocupacion_actual: ocupacionActual } = req.body;
      const { rows } = await pool.query(
        `UPDATE albergues SET ocupacion_actual = $1, actualizado_en = now()
       WHERE id = $2
       RETURNING id, ocupacion_actual`,
        [ocupacionActual, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Albergue no encontrado" });
      }
      // Así el cambio de aforo se ve en vivo en el mapa/feed público de
      // cualquiera que esté mirando, no solo en la pestaña de quien lo editó.
      transmitir("albergue_actualizado", rows[0]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

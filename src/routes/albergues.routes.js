import { Router } from "express";
import { pool } from "../../db/pool.js";
import { validarBody } from "../middleware/validate.js";
import { albergueSchema, ocupacionSchema } from "../validation/schemas.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";

const router = Router();

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

router.post("/", limitadorEscrituraPublica, validarBody(albergueSchema), async (req, res, next) => {
  try {
    const { nombre, direccion, capacidad, lon, lat } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO albergues (nombre, direccion, capacidad, ubicacion)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
       RETURNING id`,
      [nombre, direccion ?? null, capacidad, lon, lat]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/ocupacion", limitadorEscrituraPublica, validarBody(ocupacionSchema), async (req, res, next) => {
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
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

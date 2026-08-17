import { Router } from "express";
import { pool } from "../../db/pool.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, codigo, nombre, ST_AsGeoJSON(ubicacion)::json AS ubicacion,
              nivel_prealerta_cm, nivel_alerta_roja_cm, activo
       FROM sensores
       ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;

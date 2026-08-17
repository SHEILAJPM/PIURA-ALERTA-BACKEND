import { Router } from "express";
import { pool } from "../../db/pool.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, nivel_riesgo, ST_AsGeoJSON(geom)::json AS geom
       FROM zonas_riesgo
       ORDER BY nombre`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;

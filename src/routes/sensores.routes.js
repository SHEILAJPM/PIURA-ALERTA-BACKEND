import { Router } from "express";
import { pool } from "../../db/pool.js";
import { obtenerEstadoSensores } from "../services/sensorEstado.js";

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

// Estado de hardware por sensor (activo/inactivo, última lectura recibida y
// si sigue "en línea"), para que el operario detecte sensores caídos antes
// de que dejen de reportar justo cuando el río empieza a subir.
router.get("/estado", async (_req, res, next) => {
  try {
    const estado = await obtenerEstadoSensores();
    res.json(estado);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from "express";
import { pool } from "../../db/pool.js";
import { procesarLectura } from "../services/alertEngine.js";
import { estimarTiempoCrecida } from "../services/prediccion.js";
import { transmitir } from "../services/websocket.js";
import { notificarCambioEstado } from "../services/telegram.js";
import { validarBody } from "../middleware/validate.js";
import { lecturaSchema } from "../validation/schemas.js";
import { limitadorLecturas } from "../middleware/rateLimit.js";
import { requerirApiKeySensor } from "../middleware/sensorAuth.js";

const router = Router();
const SENSOR_POR_DEFECTO = "RIO-PIURA-01";

router.get("/ultima", async (req, res, next) => {
  try {
    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    const { rows } = await pool.query(
      `SELECT l.id, l.nivel_cm, l.porcentaje, l.estado, l.medido_en
       FROM lecturas l JOIN sensores s ON s.id = l.sensor_id
       WHERE s.codigo = $1
       ORDER BY l.medido_en DESC LIMIT 1`,
      [sensorCodigo]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sin lecturas todavía para este sensor" });
    }

    const prediccion = await estimarTiempoCrecida(sensorCodigo);
    res.json({ ...rows[0], prediccion });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const sensorCodigo = req.query.sensor ?? SENSOR_POR_DEFECTO;
    const minutos = Number(req.query.minutos ?? 180);
    const { rows } = await pool.query(
      `SELECT l.nivel_cm, l.porcentaje, l.estado, l.medido_en
       FROM lecturas l JOIN sensores s ON s.id = l.sensor_id
       WHERE s.codigo = $1 AND l.medido_en >= now() - ($2 || ' minutes')::interval
       ORDER BY l.medido_en ASC`,
      [sensorCodigo, minutos]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Registra una medición. Hoy la usa el simulador (npm run simulate); cuando
// el ESP32 esté conectado por SerialPort, seguirá siendo el mismo punto de
// entrada (procesarLectura) llamado directamente en vez de vía HTTP.
router.post(
  "/",
  limitadorLecturas,
  requerirApiKeySensor,
  validarBody(lecturaSchema),
  async (req, res, next) => {
    try {
      const { sensor_codigo: sensorCodigo = SENSOR_POR_DEFECTO, nivel_cm: nivelCm } = req.body;

      const { lectura, evento } = await procesarLectura({ sensorCodigo, nivelCm });
      transmitir("lectura", lectura);

      if (evento) {
        transmitir("evento_alerta", evento);
        await notificarCambioEstado(evento);
      }

      res.status(201).json({ lectura, evento });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

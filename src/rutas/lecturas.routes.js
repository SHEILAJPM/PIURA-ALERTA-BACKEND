import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { procesarLectura } from "../servicios/alertEngine.js";
import { estimarTiempoCrecida } from "../servicios/prediccion.js";
import { transmitir } from "../servicios/websocket.js";
import { notificarCambioEstado, recordarSeguridad } from "../servicios/telegram.js";
import { notificarCambioEstadoPush, recordarSeguridadPush } from "../servicios/webpush.js";
import { notificarCambioEstadoSMS } from "../servicios/sms.js";
import { validarBody } from "../intermediarios/validate.js";
import { lecturaSchema } from "../validacion/schemas.js";
import { limitadorLecturas } from "../intermediarios/rateLimit.js";
import { requerirApiKeySensor } from "../intermediarios/sensorAuth.js";

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
        await notificarCambioEstadoPush(evento);
        await notificarCambioEstadoSMS(evento);

        // Recordatorio de "estoy a salvo" (ver chequeos.routes.js): solo al
        // ENTRAR en alerta roja, no en cada lectura mientras dure -- un
        // recordatorio repetido cada pocos segundos sería spam, no ayuda.
        if (evento.estado_nuevo === "alerta_roja") {
          await recordarSeguridad(
            "🔴 Sigue la alerta roja. Si estás bien, márcalo en la app con el botón 'Estoy a salvo'. Si ves a alguien en peligro, usa el botón de SOS."
          );
          await recordarSeguridadPush("Recuerda marcar 'Estoy a salvo' en la app mientras dure la alerta roja.");
        }
      }

      res.status(201).json({ lectura, evento });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

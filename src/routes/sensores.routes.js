import { Router } from "express";
import { pool } from "../../db/pool.js";
import { obtenerEstadoSensores } from "../services/sensorEstado.js";
import { validarBody } from "../middleware/validate.js";
import { calibracionSchema, sensorSchema } from "../validation/schemas.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";
import { registrarAccion } from "../services/auditoria.js";

const router = Router();
const ROLES_NODOS = requerirRol("operario", "administrador");

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

// Registrar un ESP32 nuevo en el catálogo. El código debe coincidir con el
// que la placa manda en POST /api/lecturas (ver sensor_codigo en
// lecturaSchema) para que sus lecturas empiecen a asociarse a este nodo.
router.post(
  "/",
  requerirSesion,
  ROLES_NODOS,
  limitadorEscrituraPublica,
  validarBody(sensorSchema),
  async (req, res, next) => {
    try {
      const { codigo, nombre, lon, lat, nivel_prealerta_cm: prealerta, nivel_alerta_roja_cm: alertaRoja } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO sensores (codigo, nombre, ubicacion, nivel_prealerta_cm, nivel_alerta_roja_cm)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
         RETURNING id, codigo, nombre, ST_AsGeoJSON(ubicacion)::json AS ubicacion,
                   nivel_prealerta_cm, nivel_alerta_roja_cm, activo`,
        [codigo, nombre, lon, lat, prealerta, alertaRoja]
      );
      await registrarAccion({ usuario: req.usuario, accion: "crear_sensor", detalle: `${codigo} — ${nombre}` });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: `Ya existe un sensor con el código "${req.body.codigo}"` });
      }
      next(err);
    }
  }
);

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

// Calibración de umbrales: tarea del operador técnico (o admin), no de
// defensa civil -- cambiar cuándo dispara una alerta es una decisión técnica
// sobre el sensor, no operativa de campo.
router.patch(
  "/:id",
  requerirSesion,
  ROLES_NODOS,
  validarBody(calibracionSchema),
  async (req, res, next) => {
    try {
      const { nivel_prealerta_cm: prealerta, nivel_alerta_roja_cm: alertaRoja } = req.body;
      const { rows } = await pool.query(
        `UPDATE sensores SET nivel_prealerta_cm = $1, nivel_alerta_roja_cm = $2
         WHERE id = $3
         RETURNING id, codigo, nivel_prealerta_cm, nivel_alerta_roja_cm`,
        [prealerta, alertaRoja, req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Sensor no encontrado" });
      }
      await registrarAccion({
        usuario: req.usuario,
        accion: "calibrar_sensor",
        detalle: `${rows[0].codigo}: prealerta=${prealerta}cm, alerta_roja=${alertaRoja}cm`,
      });
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { transmitir } from "../servicios/websocket.js";
import { validarBody } from "../intermediarios/validate.js";
import { sosSchema, sosEstadoSchema } from "../validacion/schemas.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { requerirSesion, requerirRol, autenticacionOpcional } from "../intermediarios/auth.js";

const router = Router();

// Botón de pánico: no requiere sesión (mismo criterio que reportes_ciudadanos
// -- una emergencia real no debería esperar un login). Se transmite por
// WebSocket para que la Consola de Despacho lo muestre al instante.
router.post(
  "/",
  autenticacionOpcional,
  limitadorEscrituraPublica,
  validarBody(sosSchema),
  async (req, res, next) => {
    try {
      const { nombre_contacto: nombreContacto, telefono_contacto: telefonoContacto, lon, lat } = req.body;
      const usuarioId = req.usuario?.id ?? null;
      const nombreMostrado = req.usuario?.nombre ?? nombreContacto ?? null;
      const telefonoMostrado = req.usuario?.telefono ?? telefonoContacto ?? null;

      const { rows } = await pool.query(
        `INSERT INTO alertas_sos (usuario_id, nombre_contacto, telefono_contacto, ubicacion)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
         RETURNING id, estado, creado_en`,
        [usuarioId, nombreMostrado, telefonoMostrado, lon, lat]
      );

      const alerta = {
        ...rows[0],
        nombre_contacto: nombreMostrado,
        telefono_contacto: telefonoMostrado,
        ubicacion: { type: "Point", coordinates: [lon, lat] },
      };
      transmitir("alerta_sos", alerta);
      res.status(201).json(alerta);
    } catch (err) {
      next(err);
    }
  }
);

// Panel de Defensa Civil/admin: solo lo pendiente por defecto (para que la
// consola de despacho no se llene de casos ya resueltos), con lo más
// reciente primero -- una emergencia nueva no debería quedar tapada.
router.get("/", requerirSesion, requerirRol("administrador", "defensa_civil"), async (req, res, next) => {
  try {
    const soloPendientes = req.query.incluirAtendidas !== "true";
    const { rows } = await pool.query(
      `SELECT id, nombre_contacto, telefono_contacto, estado, creado_en, atendido_en,
              ST_AsGeoJSON(ubicacion)::json AS ubicacion
       FROM alertas_sos
       WHERE $1 = false OR estado = 'pendiente'
       ORDER BY creado_en DESC`,
      [soloPendientes]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/estado",
  requerirSesion,
  requerirRol("administrador", "defensa_civil"),
  validarBody(sosEstadoSchema),
  async (req, res, next) => {
    try {
      // $2::varchar explícito en las dos apariciones: sin el cast, Postgres
      // deduce tipos distintos para el mismo parámetro (varchar por la
      // columna `estado`, text por la comparación con el literal) y rechaza
      // la consulta entera con "inconsistent types deduced for parameter $2".
      const { rows } = await pool.query(
        `UPDATE alertas_sos
         SET estado = $2::varchar, atendido_en = CASE WHEN $2::varchar = 'atendido' THEN now() ELSE NULL END
         WHERE id = $1
         RETURNING id, estado, atendido_en`,
        [req.params.id, req.body.estado]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Alerta no encontrada" });
      }

      transmitir("alerta_sos_actualizada", rows[0]);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

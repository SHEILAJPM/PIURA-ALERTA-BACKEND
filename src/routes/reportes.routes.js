import { Router } from "express";
import { pool } from "../../db/pool.js";
import { transmitir } from "../services/websocket.js";
import { validarBody } from "../middleware/validate.js";
import { reporteSchema, estadoReporteSchema } from "../validation/schemas.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";
import { requerirSesion, requerirRol, autenticacionOpcional } from "../middleware/auth.js";
import { analizarReporte } from "../services/moderacionIA.js";

const router = Router();

// Paginación por cursor (keyset, no OFFSET): mandar antes=<creado_en del
// último reporte recibido> para pedir la página siguiente. Más estable que
// OFFSET si llegan reportes nuevos mientras se pagina (no salta ni repite
// filas) y no se degrada con páginas lejanas.
router.get("/", autenticacionOpcional, async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 30, 1), 100);
    const soloConFoto = req.query.conFoto === "true";
    const antes =
      typeof req.query.antes === "string" && !Number.isNaN(Date.parse(req.query.antes))
        ? req.query.antes
        : null;

    const { rows } = await pool.query(
      `SELECT r.id, r.descripcion, r.foto_url,
              ST_AsGeoJSON(r.ubicacion)::json AS ubicacion, r.estado, r.likes_count, r.creado_en,
              r.posible_spam, r.motivo_ia,
              u.id AS usuario_id, COALESCE(u.nombre, r.autor_nombre, 'Anónimo') AS usuario_nombre,
              EXISTS (
                SELECT 1 FROM reportes_likes rl
                WHERE rl.reporte_id = r.id AND rl.usuario_id = $2
              ) AS te_gusta
       FROM reportes_ciudadanos r
       LEFT JOIN usuarios u ON u.id = r.usuario_id
       WHERE ($3 = false OR r.foto_url IS NOT NULL)
         AND ($4::timestamptz IS NULL OR r.creado_en < $4::timestamptz)
       ORDER BY r.creado_en DESC
       LIMIT $1`,
      [limite, req.usuario?.id ?? null, soloConFoto, antes]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// El reporte no requiere sesión (una emergencia no debería esperar un login):
// si hay token válido, el autor sale de la cuenta; si no, se usa el nombre
// libre del body (autor_nombre), igual que antes de tener cuentas.
router.post(
  "/",
  autenticacionOpcional,
  limitadorEscrituraPublica,
  validarBody(reporteSchema),
  async (req, res, next) => {
    try {
      const { autor_nombre: autorNombre, descripcion, foto_url: fotoUrl, lon, lat } = req.body;
      const usuarioId = req.usuario?.id ?? null;
      const nombreMostrado = req.usuario?.nombre ?? autorNombre ?? "Anónimo";

      // Best-effort (nunca lanza, nunca bloquea el reporte): ver moderacionIA.js.
      const analisis = await analizarReporte(descripcion);

      const tieneUbicacion = typeof lon === "number" && typeof lat === "number";
      const params = [usuarioId, usuarioId ? null : nombreMostrado, descripcion, fotoUrl ?? null];
      let ubicacionSql = "NULL";
      if (tieneUbicacion) {
        params.push(lon, lat);
        ubicacionSql = "ST_SetSRID(ST_MakePoint($5, $6), 4326)";
      }
      const idxSpam = params.length + 1;
      const idxMotivo = params.length + 2;
      params.push(analisis?.es_sospechoso ?? null, analisis?.motivo ?? null);

      const { rows } = await pool.query(
        `INSERT INTO reportes_ciudadanos (usuario_id, autor_nombre, descripcion, foto_url, ubicacion, posible_spam, motivo_ia)
       VALUES ($1, $2, $3, $4, ${ubicacionSql}, $${idxSpam}, $${idxMotivo})
       RETURNING id, descripcion, foto_url, estado, likes_count, creado_en, posible_spam, motivo_ia`,
        params
      );

      const reporte = { ...rows[0], usuario_id: usuarioId, usuario_nombre: nombreMostrado, te_gusta: false };
      transmitir("reporte_ciudadano", reporte);
      res.status(201).json(reporte);
    } catch (err) {
      next(err);
    }
  }
);

// Toggle: si el usuario ya le dio like, lo quita; si no, lo agrega. Insert/delete
// del like y el contador denormalizado van en la misma transacción para que
// nunca queden desincronizados.
router.post("/:id/like", requerirSesion, limitadorEscrituraPublica, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existentes } = await client.query(
      "SELECT 1 FROM reportes_likes WHERE reporte_id = $1 AND usuario_id = $2",
      [req.params.id, req.usuario.id]
    );

    const yaLeGustaba = existentes.length > 0;
    if (yaLeGustaba) {
      await client.query("DELETE FROM reportes_likes WHERE reporte_id = $1 AND usuario_id = $2", [
        req.params.id,
        req.usuario.id,
      ]);
    } else {
      await client.query("INSERT INTO reportes_likes (reporte_id, usuario_id) VALUES ($1, $2)", [
        req.params.id,
        req.usuario.id,
      ]);
    }

    const { rows } = await client.query(
      `UPDATE reportes_ciudadanos
       SET likes_count = likes_count + $2
       WHERE id = $1
       RETURNING id, likes_count`,
      [req.params.id, yaLeGustaba ? -1 : 1]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reporte no encontrado" });
    }

    await client.query("COMMIT");
    res.json({ ...rows[0], te_gusta: !yaLeGustaba });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// Moderación: solo roles no públicos pueden cambiar el estado de un reporte
// (ver rol en db/schema.sql). El registro público nunca crea estos roles.
router.patch(
  "/:id/estado",
  requerirSesion,
  requerirRol("administrador", "operario", "defensa_civil"),
  validarBody(estadoReporteSchema),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "UPDATE reportes_ciudadanos SET estado = $2 WHERE id = $1 RETURNING id, estado",
        [req.params.id, req.body.estado]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Reporte no encontrado" });
      }

      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

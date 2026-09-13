import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { transmitir } from "../servicios/websocket.js";
import { validarBody } from "../intermediarios/validate.js";
import { reporteSchema, estadoReporteSchema } from "../validacion/schemas.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { requerirSesion, requerirRol, autenticacionOpcional } from "../intermediarios/auth.js";
import { analizarReporte } from "../servicios/moderacionIA.js";

const router = Router();

// Paginación por cursor (keyset, no OFFSET): mandar antes=<creado_en del
// último reporte recibido> para pedir la página siguiente. Más estable que
// OFFSET si llegan reportes nuevos mientras se pagina (no salta ni repite
// filas) y no se degrada con páginas lejanas.
// Tres audiencias, tres recortes de estado:
// - Operario/Defensa Civil moderan lo pendiente y nada más: una vez
//   verificado o descartado deja de ser su responsabilidad.
// - Administrador ve el archivo completo (pendiente/verificado/descartado)
//   SOLO cuando pide incluirArchivados=true (panel de moderación, ver
//   admin/Reportes.jsx) — sin ese flag ve el mismo feed limpio que cualquier
//   otro usuario, para que "administrador" no sea sinónimo de "el feed
//   normal me muestra basura archivada".
// - Ciudadano/anónimo (el feed público) nunca ve 'descartado': archivar un
//   reporte (a mano o por la IA en moderacionIA.js) tiene que sacarlo de la
//   vista de todos, no solo del panel de moderación.
const ROLES_SOLO_PENDIENTES = ["operario", "defensa_civil"];

router.get("/", autenticacionOpcional, async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(Number(req.query.limite) || 30, 1), 100);
    const soloConFoto = req.query.conFoto === "true";
    const antes =
      typeof req.query.antes === "string" && !Number.isNaN(Date.parse(req.query.antes))
        ? req.query.antes
        : null;
    const soloPendientes = ROLES_SOLO_PENDIENTES.includes(req.usuario?.rol);
    const verArchivados = req.usuario?.rol === "administrador" && req.query.incluirArchivados === "true";

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
         AND (
           ($5 = true AND r.estado = 'pendiente')
           OR $6 = true
           OR ($5 = false AND $6 = false AND r.estado <> 'descartado')
         )
       ORDER BY r.creado_en DESC
       LIMIT $1`,
      [limite, req.usuario?.id ?? null, soloConFoto, antes, soloPendientes, verArchivados]
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
      // fuera_de_tema=true (con confianza, según el prompt) archiva el reporte
      // de una vez -- no llega a mostrarse al público ni a la cola de
      // moderación. Cualquier otro caso (incluido "no se pudo analizar") sigue
      // el flujo normal: pendiente, con posible_spam como pista para el humano.
      const analisis = await analizarReporte({ descripcion, fotoUrl });
      const archivadoPorIA = analisis?.fuera_de_tema === true;

      const tieneUbicacion = typeof lon === "number" && typeof lat === "number";
      const params = [usuarioId, usuarioId ? null : nombreMostrado, descripcion, fotoUrl];
      let ubicacionSql = "NULL";
      if (tieneUbicacion) {
        params.push(lon, lat);
        ubicacionSql = "ST_SetSRID(ST_MakePoint($5, $6), 4326)";
      }
      const idxSpam = params.length + 1;
      const idxMotivo = params.length + 2;
      const idxEstado = params.length + 3;
      params.push(analisis?.es_sospechoso ?? null, analisis?.motivo ?? null, archivadoPorIA ? "descartado" : "pendiente");

      const { rows } = await pool.query(
        `INSERT INTO reportes_ciudadanos (usuario_id, autor_nombre, descripcion, foto_url, ubicacion, posible_spam, motivo_ia, estado)
       VALUES ($1, $2, $3, $4, ${ubicacionSql}, $${idxSpam}, $${idxMotivo}, $${idxEstado})
       RETURNING id, descripcion, foto_url, estado, likes_count, creado_en, posible_spam, motivo_ia`,
        params
      );

      const reporte = { ...rows[0], usuario_id: usuarioId, usuario_nombre: nombreMostrado, te_gusta: false };
      // Un reporte que la IA ya archivó no debe aparecer ni un instante en el
      // feed en vivo de nadie que esté conectado en ese momento.
      if (!archivadoPorIA) {
        transmitir("reporte_ciudadano", reporte);
      }
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
// (ver rol en bd/schema.sql). El registro público nunca crea estos roles.
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

import { pool } from "../../bd/pool.js";
import { TOPES_INDEMNIZACION_CENTAVOS } from "./pagos.js";
import { enviarCorreoReclamoRevisado } from "./email.js";

// La cobertura se valida contra la póliza que estaba vigente el día del
// daño, no la más reciente -- alguien puede reclamar semanas después de que
// bajó el río, para entonces su póliza de ese momento ya pudo haber vencido.
async function buscarPolizaVigenteEn(usuarioId, fechaDano) {
  const { rows } = await pool.query(
    `SELECT id, meses FROM polizas_seguro
     WHERE usuario_id = $1 AND fecha_inicio <= $2 AND fecha_fin >= $2
     ORDER BY fecha_inicio DESC LIMIT 1`,
    [usuarioId, fechaDano]
  );
  return rows[0] ?? null;
}

export async function crearReclamo({ usuarioId, fecha_dano: fechaDano, descripcion, foto_urls: fotoUrls }) {
  const poliza = await buscarPolizaVigenteEn(usuarioId, fechaDano);
  if (!poliza) {
    const error = new Error("No tenías una póliza vigente en la fecha del daño que indicaste");
    error.status = 400;
    throw error;
  }

  const { rows } = await pool.query(
    `INSERT INTO reclamos_seguro (poliza_id, usuario_id, fecha_dano, descripcion, foto_urls)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [poliza.id, usuarioId, fechaDano, descripcion, fotoUrls]
  );
  return { ...rows[0], tope_indemnizacion_centavos: TOPES_INDEMNIZACION_CENTAVOS[poliza.meses] };
}

export async function listarReclamosUsuario(usuarioId) {
  const { rows } = await pool.query(
    `SELECT r.*, p.meses
     FROM reclamos_seguro r
     JOIN polizas_seguro p ON p.id = r.poliza_id
     WHERE r.usuario_id = $1
     ORDER BY r.creado_en DESC`,
    [usuarioId]
  );
  return rows.map((r) => ({ ...r, tope_indemnizacion_centavos: TOPES_INDEMNIZACION_CENTAVOS[r.meses] }));
}

// Panel admin: pendientes primero (son los que necesitan acción), el resto
// por fecha -- sin esto, un reclamo viejo ya resuelto se mezcla con los que
// de verdad hay que revisar.
export async function listarReclamosAdmin() {
  const { rows } = await pool.query(
    `SELECT r.*, p.meses, u.nombre AS usuario_nombre, u.correo AS usuario_correo
     FROM reclamos_seguro r
     JOIN polizas_seguro p ON p.id = r.poliza_id
     JOIN usuarios u ON u.id = r.usuario_id
     ORDER BY (r.estado = 'pendiente') DESC, r.creado_en DESC
     LIMIT 200`
  );
  return rows.map((r) => ({ ...r, tope_indemnizacion_centavos: TOPES_INDEMNIZACION_CENTAVOS[r.meses] }));
}

// Quién puede llegar a `estado` y desde dónde -- el inverso de "desde X, a
// dónde se puede ir". Se usa como condición del propio UPDATE (no de una
// lectura previa) para que dos revisiones concurrentes del mismo reclamo no
// se pisen: ver el mismo problema resuelto con advisory locks en
// reportes.routes.js (like/confirmar), acá basta con el estado en el WHERE
// porque no hay un contador que sumar, solo una transición que ganar.
const ORIGENES_VALIDOS = {
  aprobado: ["pendiente"],
  rechazado: ["pendiente", "aprobado"],
  pagado: ["aprobado"],
};

export async function revisarReclamo({
  id,
  revisorId,
  estado,
  monto_aprobado_centavos: montoAprobadoCentavos,
  motivo_rechazo: motivoRechazo,
}) {
  const { rows: actuales } = await pool.query(
    `SELECT r.estado, p.meses, r.usuario_id, u.correo
     FROM reclamos_seguro r
     JOIN polizas_seguro p ON p.id = r.poliza_id
     JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.id = $1`,
    [id]
  );
  const actual = actuales[0];
  if (!actual) {
    const error = new Error("Reclamo no encontrado");
    error.status = 404;
    throw error;
  }

  if (estado === "aprobado") {
    const tope = TOPES_INDEMNIZACION_CENTAVOS[actual.meses];
    if (montoAprobadoCentavos > tope) {
      const error = new Error(`El monto supera el tope de este plan (S/ ${(tope / 100).toFixed(2)})`);
      error.status = 400;
      throw error;
    }
  }

  const { rows } = await pool.query(
    `UPDATE reclamos_seguro
     SET estado = $2, monto_aprobado_centavos = COALESCE($3, monto_aprobado_centavos),
         motivo_rechazo = $4, revisado_por = $5, revisado_en = now()
     WHERE id = $1 AND estado = ANY($6)
     RETURNING *`,
    [id, estado, montoAprobadoCentavos ?? null, motivoRechazo ?? null, revisorId, ORIGENES_VALIDOS[estado] ?? []]
  );

  if (rows.length === 0) {
    // No lo tocó el UPDATE: o el estado ya cambió bajo nuestros pies (otra
    // revisión ganó la carrera), o la transición pedida nunca fue válida.
    // Cualquiera de los dos casos, se reporta el estado real, no el que
    // leímos hace un instante.
    const { rows: frescos } = await pool.query("SELECT estado FROM reclamos_seguro WHERE id = $1", [id]);
    const error = new Error(`No se puede pasar de "${frescos[0].estado}" a "${estado}"`);
    error.status = 409;
    throw error;
  }

  if (estado === "aprobado" || estado === "rechazado") {
    await enviarCorreoReclamoRevisado(actual.correo, { estado, montoAprobadoCentavos, motivoRechazo });
  }

  return rows[0];
}

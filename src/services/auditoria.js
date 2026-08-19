import { pool } from "../../db/pool.js";
import { logger } from "../lib/logger.js";

// Best-effort (nunca lanza, nunca bloquea la acción que audita): si falla el
// insert acá, la acción principal (cambiar un rol, moderar un reporte, etc.)
// ya se hizo y no tiene sentido revertirla por esto. Mismo criterio que
// src/services/moderacionIA.js.
export async function registrarAccion({ usuario, accion, detalle }) {
  try {
    await pool.query(
      `INSERT INTO auditoria_acciones (usuario_id, usuario_nombre, accion, detalle)
       VALUES ($1, $2, $3, $4)`,
      [usuario?.id ?? null, usuario?.nombre ?? "Sistema", accion, detalle ?? null]
    );
  } catch (err) {
    logger.error({ err }, "No se pudo registrar en auditoría");
  }
}

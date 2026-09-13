import { pool } from "../../bd/pool.js";

const CAMPOS_EDITABLES = [
  "sms_habilitado",
  "email_habilitado",
  "push_habilitado",
  "telegram_habilitado",
  "radio_notificacion_push_km",
];

// Sin caché a propósito: se lee poco (una vez por evento de alerta, una vez
// por carga del panel admin) y así un cambio desde el panel se aplica al
// instante sin coordinar invalidación entre procesos/instancias.
export async function obtenerConfiguracion() {
  const { rows } = await pool.query("SELECT * FROM configuracion_sistema WHERE id = 1");
  return rows[0];
}

export async function actualizarConfiguracion(cambios, usuarioId) {
  const claves = Object.keys(cambios).filter((clave) => CAMPOS_EDITABLES.includes(clave));
  if (claves.length === 0) return obtenerConfiguracion();

  const set = claves.map((clave, i) => `${clave} = $${i + 1}`).join(", ");
  const valores = claves.map((clave) => cambios[clave]);
  const { rows } = await pool.query(
    `UPDATE configuracion_sistema
     SET ${set}, actualizado_en = now(), actualizado_por = $${claves.length + 1}
     WHERE id = 1
     RETURNING *`,
    [...valores, usuarioId]
  );
  return rows[0];
}

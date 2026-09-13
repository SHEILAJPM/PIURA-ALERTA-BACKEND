import { pool } from "../../db/pool.js";

// Un sensor manda lecturas cada pocos segundos (ver db/schema.sql). Si no
// llegó ninguna en este umbral, es señal de una falla de hardware (batería,
// conexión, sensor físico desconectado), no de que el río esté tranquilo.
const UMBRAL_SIN_SENAL_MIN = 5;

// Función pura (sin DB) para poder testearla directo.
export function calcularEnLinea(ultimaLecturaEn, ahora = new Date()) {
  if (!ultimaLecturaEn) return false;
  const minutosDesdeUltimaLectura = (ahora.getTime() - ultimaLecturaEn.getTime()) / 60000;
  return minutosDesdeUltimaLectura <= UMBRAL_SIN_SENAL_MIN;
}

export async function obtenerEstadoSensores() {
  const { rows } = await pool.query(
    `SELECT s.id, s.codigo, s.nombre, s.activo,
            s.nivel_prealerta_cm, s.nivel_alerta_roja_cm,
            l.nivel_cm AS ultima_lectura_cm, l.estado AS ultimo_estado, l.medido_en AS ultima_lectura_en
     FROM sensores s
     LEFT JOIN LATERAL (
       SELECT nivel_cm, estado, medido_en
       FROM lecturas
       WHERE sensor_id = s.id
       ORDER BY medido_en DESC
       LIMIT 1
     ) l ON true
     ORDER BY s.nombre`
  );

  return rows.map((fila) => ({
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    activo: fila.activo,
    nivel_prealerta_cm: fila.nivel_prealerta_cm,
    nivel_alerta_roja_cm: fila.nivel_alerta_roja_cm,
    ultima_lectura: fila.ultima_lectura_en
      ? { nivel_cm: fila.ultima_lectura_cm, estado: fila.ultimo_estado, medido_en: fila.ultima_lectura_en }
      : null,
    en_linea: calcularEnLinea(fila.ultima_lectura_en),
  }));
}

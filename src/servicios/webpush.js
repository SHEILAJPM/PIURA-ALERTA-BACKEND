import webpush from "web-push";
import { pool } from "../../bd/pool.js";
import { logger } from "../utilidades/logger.js";
import { obtenerConfiguracion } from "./configuracion.js";

const MENSAJES_ESTADO = {
  normal: "El nivel del río volvió a la normalidad.",
  prealerta: "PREALERTA: el nivel del río está subiendo, mantente atento.",
  alerta_roja: "ALERTA ROJA: nivel crítico del río. Sigue las indicaciones de las autoridades.",
};

let habilitado = false;

// Igual que Telegram (ver iniciarTelegram en telegram.js): si no hay claves
// configuradas, las notificaciones push quedan desactivadas sin romper nada
// más — es un servicio externo opcional, mismo patrón que GROQ_API_KEY,
// TELEGRAM_BOT_TOKEN, SENTRY_DSN.
export function iniciarWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contacto@piuraalerta.pe";

  if (!publicKey || !privateKey) {
    logger.warn(
      "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY no configurados: las notificaciones push quedan desactivadas."
    );
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  habilitado = true;
}

export function clavePublicaPush() {
  return habilitado ? process.env.VAPID_PUBLIC_KEY : null;
}

// lon/lat son opcionales (el visitante puede no haber dado permiso de
// geolocalización): cuando faltan, ubicacion queda NULL y esa suscripción
// sigue recibiendo todas las notificaciones (ver obtenerSuscripcionesParaEvento
// más abajo). COALESCE en el UPDATE evita que una resuscripción sin ubicación
// borre una que ya se había guardado antes para el mismo endpoint.
export async function guardarSuscripcionPush({ endpoint, keys, lon, lat }) {
  const tieneUbicacion = lon !== undefined && lat !== undefined;
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, ubicacion)
     VALUES (
       $1, $2, $3,
       CASE WHEN $4::double precision IS NULL OR $5::double precision IS NULL
            THEN NULL ELSE ST_SetSRID(ST_MakePoint($4, $5), 4326) END
     )
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       ubicacion = COALESCE(EXCLUDED.ubicacion, push_subscriptions.ubicacion)`,
    [endpoint, keys.p256dh, keys.auth, tieneUbicacion ? lon : null, tieneUbicacion ? lat : null]
  );
}

export async function eliminarSuscripcionPush(endpoint) {
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

// Igual que enviarATodos en telegram.js: manda en tandas para no disparar
// cientos de requests HTTP simultáneas si la base de suscriptores crece.
// `enviar` es inyectable solo para que pruebas/webpush.test.js pueda probar el
// batching y la limpieza de suscripciones muertas sin un push service real.
const TANDA = 50;

export async function enviarATodos(
  suscripciones,
  payload,
  {
    enviar = (sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ),
    tamañoTanda = TANDA,
  } = {}
) {
  let enviados = 0;
  for (let i = 0; i < suscripciones.length; i += tamañoTanda) {
    const tanda = suscripciones.slice(i, i + tamañoTanda);
    const resultados = await Promise.allSettled(tanda.map((sub) => enviar(sub)));
    for (const [idx, resultado] of resultados.entries()) {
      if (resultado.status === "fulfilled") {
        enviados += 1;
        continue;
      }
      const status = resultado.reason?.statusCode;
      // 404/410: el navegador canceló la suscripción o expiró — el push
      // service no la va a volver a aceptar nunca, así que se limpia de una
      // vez en vez de reintentar contra un endpoint muerto en cada alerta.
      if (status === 404 || status === 410) {
        await eliminarSuscripcionPush(tanda[idx].endpoint).catch(() => {});
      } else {
        logger.error({ err: resultado.reason }, "Error enviando notificación push");
      }
    }
  }
  return enviados;
}

// Qué tan cerca del sensor debe estar una zona de riesgo para considerarla
// "la zona activa" de este evento (el sensor no vive necesariamente dentro
// del polígono dibujado en el mapa, pero si está a un par de km es la zona
// que ese sensor está vigilando).
const RADIO_DETECCION_ZONA_M = 3000;

// Filtra los destinatarios de un aviso automático por cercanía a la zona de
// riesgo activa, para no despertar con una alerta roja de un sensor del otro
// lado de la ciudad a alguien que vive lejos de ahí. Dos casos siguen
// recibiendo todo sin filtrar, a propósito:
//   - "normal" (todo volvió a la normalidad): buena noticia para cualquiera
//     que haya recibido la alerta original, esté donde esté.
//   - suscripciones sin ubicación guardada (no dieron permiso de
//     geolocalización): perderían el aviso por completo si se filtraran.
async function obtenerSuscripcionesParaEvento(evento) {
  if (evento.estado_nuevo === "normal") {
    const { rows } = await pool.query("SELECT endpoint, p256dh, auth FROM push_subscriptions");
    return rows;
  }

  const config = await obtenerConfiguracion();
  const radioNotificacionM = Number(config.radio_notificacion_push_km) * 1000;

  const { rows } = await pool.query(
    `WITH zona AS (
       SELECT ST_Union(z.geom) AS geom
       FROM zonas_riesgo z, sensores s
       WHERE s.id = $1 AND ST_DWithin(z.geom::geography, s.ubicacion::geography, $2)
     )
     SELECT p.endpoint, p.p256dh, p.auth
     FROM push_subscriptions p, zona
     WHERE zona.geom IS NULL
        OR p.ubicacion IS NULL
        OR ST_DWithin(p.ubicacion::geography, zona.geom::geography, $3)`,
    [evento.sensor_id, RADIO_DETECCION_ZONA_M, radioNotificacionM]
  );
  return rows;
}

export async function notificarCambioEstadoPush(evento) {
  if (!habilitado) return;
  const config = await obtenerConfiguracion();
  if (!config.push_habilitado) return;

  const rows = await obtenerSuscripcionesParaEvento(evento);
  if (rows.length === 0) return;

  const payload = JSON.stringify({
    titulo: "Piura Alerta",
    cuerpo: `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo} Nivel actual: ${evento.nivel_cm} cm`,
    estado: evento.estado_nuevo,
  });

  await enviarATodos(rows, payload);
}

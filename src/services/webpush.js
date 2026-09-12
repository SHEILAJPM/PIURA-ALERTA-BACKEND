import webpush from "web-push";
import { pool } from "../../db/pool.js";
import { logger } from "../lib/logger.js";

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

export async function guardarSuscripcionPush({ endpoint, keys }) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [endpoint, keys.p256dh, keys.auth]
  );
}

export async function eliminarSuscripcionPush(endpoint) {
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

// Igual que enviarATodos en telegram.js: manda en tandas para no disparar
// cientos de requests HTTP simultáneas si la base de suscriptores crece.
// `enviar` es inyectable solo para que test/webpush.test.js pueda probar el
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

export async function notificarCambioEstadoPush(evento) {
  if (!habilitado) return;
  const { rows } = await pool.query("SELECT endpoint, p256dh, auth FROM push_subscriptions");
  if (rows.length === 0) return;

  const payload = JSON.stringify({
    titulo: "Piura Alerta",
    cuerpo: `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo} Nivel actual: ${evento.nivel_cm} cm`,
    estado: evento.estado_nuevo,
  });

  await enviarATodos(rows, payload);
}

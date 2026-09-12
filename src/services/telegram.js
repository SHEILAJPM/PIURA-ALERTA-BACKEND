import TelegramBot from "node-telegram-bot-api";
import { pool } from "../../db/pool.js";
import { logger } from "../lib/logger.js";

const MENSAJES_ESTADO = {
  normal: "🟢 El nivel del río volvió a la normalidad.",
  prealerta: "🟡 PREALERTA: el nivel del río está subiendo, mantente atento.",
  alerta_roja: "🔴 ALERTA ROJA: nivel crítico del río. Sigue las indicaciones de las autoridades.",
};

let bot = null;

// Telegram permite ~30 mensajes/seg en total para el bot. Con pocos
// suscriptores un Promise.all disparado de una vez nunca lo nota, pero si la
// base de suscriptores crece, mandar todo de golpe empieza a devolver 429 de
// Telegram. Se manda en tandas con una pausa entre cada una para quedar
// cómodamente debajo del límite.
const TANDA = 25;
const PAUSA_MS = 1100;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `enviar`/`tamañoTanda`/`pausaMs` son inyectables solo para que
// test/telegram.test.js pueda probar el batching sin un bot real ni esperar
// los ~1.1s de pausa entre tandas; en producción siempre usan sus defaults.
export async function enviarATodos(
  chatIds,
  mensaje,
  { enviar = (chatId, msg) => bot.sendMessage(chatId, msg), tamañoTanda = TANDA, pausaMs = PAUSA_MS } = {}
) {
  let enviados = 0;
  for (let i = 0; i < chatIds.length; i += tamañoTanda) {
    const tanda = chatIds.slice(i, i + tamañoTanda);
    const resultados = await Promise.allSettled(tanda.map((chatId) => enviar(chatId, mensaje)));
    resultados.forEach((resultado, idx) => {
      if (resultado.status === "fulfilled") {
        enviados += 1;
      } else {
        logger.error({ chatId: tanda[idx], err: resultado.reason }, "Error enviando Telegram");
      }
    });
    if (i + tamañoTanda < chatIds.length) await esperar(pausaMs);
  }
  return enviados;
}

export function iniciarTelegram(token) {
  if (!token || token === "tu_token_de_botfather") {
    logger.warn("TELEGRAM_BOT_TOKEN no configurado: el bot de Telegram queda desactivado.");
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  bot.on("polling_error", (err) => logger.error({ err }, "Error de polling de Telegram"));

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const nombreUsuario = msg.chat.username ?? msg.chat.first_name ?? null;
    await pool.query(
      `INSERT INTO suscriptores_telegram (chat_id, nombre_usuario)
       VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET activo = true, nombre_usuario = EXCLUDED.nombre_usuario`,
      [chatId, nombreUsuario]
    );
    await bot.sendMessage(
      chatId,
      "✅ Te suscribiste a las alertas de PIURA ALERTA. Te avisaremos ante cualquier cambio en el nivel del río."
    );
  });

  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    await pool.query("UPDATE suscriptores_telegram SET activo = false WHERE chat_id = $1", [chatId]);
    await bot.sendMessage(chatId, "❌ Cancelaste tu suscripción a las alertas.");
  });

  return bot;
}

// Apagado ordenado (server.js): detiene el polling para no dejar un handle
// colgado que impida que el proceso termine limpio.
export function detenerTelegram() {
  return bot?.stopPolling() ?? Promise.resolve();
}

// Difusión manual (ver POST /api/alertas/difundir), a diferencia de
// notificarCambioEstado que solo se dispara automático desde alertEngine.js.
export async function enviarMensajeATodos(mensaje) {
  if (!bot) return { enviados: 0 };
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  const enviados = await enviarATodos(
    rows.map((s) => s.chat_id),
    mensaje
  );
  return { enviados };
}

export async function notificarCambioEstado(evento) {
  if (!bot) return;
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  const mensaje = `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo}\nNivel actual: ${evento.nivel_cm} cm`;
  await enviarATodos(
    rows.map((s) => s.chat_id),
    mensaje
  );
}

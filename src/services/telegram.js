import TelegramBot from "node-telegram-bot-api";
import { pool } from "../../db/pool.js";

const MENSAJES_ESTADO = {
  normal: "🟢 El nivel del río volvió a la normalidad.",
  prealerta: "🟡 PREALERTA: el nivel del río está subiendo, mantente atento.",
  alerta_roja: "🔴 ALERTA ROJA: nivel crítico del río. Sigue las indicaciones de las autoridades.",
};

let bot = null;

export function iniciarTelegram(token) {
  if (!token || token === "tu_token_de_botfather") {
    console.warn("TELEGRAM_BOT_TOKEN no configurado: el bot de Telegram queda desactivado.");
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  bot.on("polling_error", (err) => console.error("Error de polling de Telegram:", err.message));

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const nombreUsuario = msg.chat.username ?? msg.chat.first_name ?? null;
    await pool.query(
      `INSERT INTO suscriptores_telegram (chat_id, nombre_usuario)
       VALUES ($1, $2)
       ON CONFLICT (chat_id) DO UPDATE SET activo = true, nombre_usuario = EXCLUDED.nombre_usuario`,
      [chatId, nombreUsuario]
    );
    await bot.sendMessage(chatId, "✅ Te suscribiste a las alertas de PIURA ALERTA. Te avisaremos ante cualquier cambio en el nivel del río.");
  });

  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    await pool.query("UPDATE suscriptores_telegram SET activo = false WHERE chat_id = $1", [chatId]);
    await bot.sendMessage(chatId, "❌ Cancelaste tu suscripción a las alertas.");
  });

  return bot;
}

// Difusión manual (ver POST /api/alertas/difundir), a diferencia de
// notificarCambioEstado que solo se dispara automático desde alertEngine.js.
export async function enviarMensajeATodos(mensaje) {
  if (!bot) return { enviados: 0 };
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  await Promise.all(
    rows.map((s) =>
      bot.sendMessage(s.chat_id, mensaje).catch((err) =>
        console.error(`Error enviando Telegram a ${s.chat_id}:`, err.message)
      )
    )
  );
  return { enviados: rows.length };
}

export async function notificarCambioEstado(evento) {
  if (!bot) return;
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  const mensaje = `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo}\nNivel actual: ${evento.nivel_cm} cm`;

  await Promise.all(
    rows.map((s) =>
      bot.sendMessage(s.chat_id, mensaje).catch((err) =>
        console.error(`Error enviando Telegram a ${s.chat_id}:`, err.message)
      )
    )
  );
}

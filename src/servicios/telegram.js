import TelegramBot from "node-telegram-bot-api";
import { pool } from "../../bd/pool.js";
import { logger } from "../utilidades/logger.js";
import { obtenerConfiguracion } from "./configuracion.js";

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

// Caracteres especiales del modo "Markdown" (legacy) de Telegram -- ver
// https://core.telegram.org/bots/api#markdown-style. Se usa antes de meter
// texto que no controlamos (ej. el nombre de un usuario de Telegram) dentro
// de un mensaje con parse_mode: "Markdown".
export function escaparMarkdown(texto) {
  return texto.replace(/([_*`[])/g, "\\$1");
}

// `enviar`/`tamañoTanda`/`pausaMs` son inyectables solo para que
// pruebas/telegram.test.js pueda probar el batching sin un bot real ni esperar
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
    try {
      await pool.query(
        `INSERT INTO suscriptores_telegram (chat_id, nombre_usuario)
         VALUES ($1, $2)
         ON CONFLICT (chat_id) DO UPDATE SET activo = true, nombre_usuario = EXCLUDED.nombre_usuario`,
        [chatId, nombreUsuario]
      );
      // escaparMarkdown: un nombre real puede traer _, *, ` o [ (ej. "Jean_Pierre"),
      // que en modo Markdown de Telegram son formato -- sin escapar, la API
      // rechaza el mensaje entero (400 "can't parse entities") y quien recién
      // se suscribió no recibe ninguna confirmación, aunque el insert de
      // arriba sí haya quedado guardado.
      const nombre = msg.chat.first_name ? escaparMarkdown(msg.chat.first_name) : null;
      const saludo = nombre ? `¡Hola, ${nombre}! 👋` : "¡Hola! 👋";
      await bot.sendMessage(
        chatId,
        `${saludo} Quedaste suscrito a *Piura Alerta*, el sistema de monitoreo del río Piura.\n\n` +
          "Te vamos a avisar apenas cambie el nivel del río:\n" +
          "🟢 Normal\n" +
          "🟡 Prealerta — el río está subiendo\n" +
          "🔴 Alerta roja — nivel crítico, sigue las indicaciones de las autoridades\n\n" +
          "Cuando quieras dejar de recibir avisos, escribe /stop.",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      logger.error({ err, chatId }, "Error procesando /start de Telegram");
    }
  });

  bot.onText(/\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      await pool.query("UPDATE suscriptores_telegram SET activo = false WHERE chat_id = $1", [chatId]);
      await bot.sendMessage(
        chatId,
        "❌ Cancelaste tu suscripción a las alertas de Piura Alerta. Si cambias de opinión, escribe /start cuando quieras."
      );
    } catch (err) {
      logger.error({ err, chatId }, "Error procesando /stop de Telegram");
    }
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

// Recordatorio de "estoy a salvo" al entrar en alerta roja (ver
// lecturas.routes.js) -- aparte del aviso de cambio de estado de arriba, con
// un mensaje propio y su propio texto, para no reescribir MENSAJES_ESTADO.
export async function recordarSeguridad(mensaje) {
  if (!bot) return;
  const config = await obtenerConfiguracion();
  if (!config.telegram_habilitado) return;
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  await enviarATodos(
    rows.map((s) => s.chat_id),
    mensaje
  );
}

export async function notificarCambioEstado(evento) {
  if (!bot) return;
  // Interruptor global (ver src/servicios/configuracion.js): solo afecta el
  // aviso automático de cambio de estado, no la difusión manual de Defensa
  // Civil (enviarMensajeATodos), que es una acción explícita y puntual.
  const config = await obtenerConfiguracion();
  if (!config.telegram_habilitado) return;
  const { rows } = await pool.query("SELECT chat_id FROM suscriptores_telegram WHERE activo = true");
  const mensaje = `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo}\nNivel actual: ${evento.nivel_cm} cm`;
  await enviarATodos(
    rows.map((s) => s.chat_id),
    mensaje
  );
  // Sin esto, "alertas automáticas enviadas" en el panel de impacto (ver
  // impacto.routes.js) se queda en 0 para siempre: nada más pone esta
  // columna en true. Se marca acá porque este es el único lugar donde de
  // verdad se intenta el envío automático (a diferencia de la difusión
  // manual, que no es "automática").
  await pool.query("UPDATE eventos_alerta SET notificado_telegram = true WHERE id = $1", [evento.id]);
}

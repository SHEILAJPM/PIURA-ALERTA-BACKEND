import twilio from "twilio";
import { pool } from "../../db/pool.js";
import { logger } from "../lib/logger.js";

const MENSAJES_ESTADO = {
  normal: "Piura Alerta: el nivel del río volvió a la normalidad.",
  prealerta: "Piura Alerta: PREALERTA, el nivel del río está subiendo.",
  alerta_roja: "Piura Alerta: ALERTA ROJA, nivel crítico del río. Sigue las indicaciones de las autoridades.",
};

let cliente = null;
let numeroRemitente = null;

// Igual que Telegram/Web Push (ver iniciarTelegram/iniciarWebPush): sin
// cuenta de Twilio configurada, los SMS quedan desactivados sin romper nada
// más — servicio externo opcional, mismo patrón que las demás integraciones.
export function iniciarSMS() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  numeroRemitente = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !numeroRemitente) {
    logger.warn("TWILIO_* no configurado: las alertas por SMS quedan desactivadas.");
    return;
  }

  cliente = twilio(accountSid, authToken);
}

// Acepta números peruanos sueltos (9 dígitos, ej. "987654321") o ya en
// formato internacional ("+51987654321"). Cualquier otra cosa se descarta en
// vez de mandarla a Twilio y que falle ahí — es más barato y más claro
// filtrar acá que gastar el request.
export function normalizarNumeroPeru(telefono) {
  const limpio = telefono.trim().replace(/[\s-]/g, "");
  if (/^\+\d{8,15}$/.test(limpio)) return limpio;
  if (/^9\d{8}$/.test(limpio)) return `+51${limpio}`;
  return null;
}

// `enviar` es inyectable solo para que test/sms.test.js pueda probar el
// batching sin una cuenta de Twilio real (mismo patrón que telegram.js).
const TANDA = 20;

export async function enviarATodos(
  numeros,
  mensaje,
  {
    enviar = (to) => cliente.messages.create({ to, from: numeroRemitente, body: mensaje }),
    tamañoTanda = TANDA,
  } = {}
) {
  let enviados = 0;
  for (let i = 0; i < numeros.length; i += tamañoTanda) {
    const tanda = numeros.slice(i, i + tamañoTanda);
    const resultados = await Promise.allSettled(tanda.map((numero) => enviar(numero)));
    resultados.forEach((resultado, idx) => {
      if (resultado.status === "fulfilled") {
        enviados += 1;
      } else {
        logger.error({ numero: tanda[idx], err: resultado.reason }, "Error enviando SMS");
      }
    });
  }
  return enviados;
}

export async function notificarCambioEstadoSMS(evento) {
  if (!cliente) return;
  // sensor_interes_id NULL = le interesan todos los sensores (default al
  // activar el opt-in); si lo seteó, solo se le manda cuando cambia ESE
  // sensor puntual — evita spam a alguien que solo le importa un punto
  // específico del río cuando sube otro sensor lejos de su zona.
  const { rows } = await pool.query(
    `SELECT telefono FROM usuarios
     WHERE recibir_alertas_sms = true AND telefono IS NOT NULL
       AND (sensor_interes_id IS NULL OR sensor_interes_id = $1)`,
    [evento.sensor_id]
  );
  const numeros = rows.map((r) => normalizarNumeroPeru(r.telefono)).filter(Boolean);
  if (numeros.length === 0) return;

  const mensaje = `${MENSAJES_ESTADO[evento.estado_nuevo] ?? evento.estado_nuevo} Nivel actual: ${evento.nivel_cm} cm`;
  await enviarATodos(numeros, mensaje);
}

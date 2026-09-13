import { logger } from "../utilidades/logger.js";
import { obtenerConfiguracion } from "./configuracion.js";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

let apiKey = null;

// Igual que Telegram/Web Push/Twilio: sin cuenta de Brevo configurada, el
// envío de correos queda desactivado sin romper nada más.
export function iniciarEmail() {
  apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn("BREVO_API_KEY no configurado: los correos (recuperación, avisos) quedan desactivados.");
  }
}

// Compartida por cualquier correo que mande el backend (recuperación de
// contraseña, aviso de vencimiento de póliza, etc.) para no repetir el
// fetch a Brevo en cada uno. `avisoDev` es lo que queda en el log cuando no
// hay cuenta de Brevo configurada, para poder probar el flujo en local.
async function enviarCorreo({ correo, asunto, html, avisoDev }) {
  if (!apiKey) {
    // Fallback de desarrollo (nunca en producción): sin esto, no hay forma de
    // probar estos flujos localmente sin ya tener una cuenta de Brevo.
    if (process.env.NODE_ENV !== "production") {
      logger.warn(avisoDev, "BREVO_API_KEY no configurado: el correo solo queda en este log.");
    }
    return;
  }

  const res = await fetch(BREVO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_FROM ?? "onboarding@piuraalerta.pe", name: "Piura Alerta" },
      to: [{ email: correo }],
      subject: asunto,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    logger.error({ status: res.status, body, correo }, "Error enviando correo vía Brevo");
  }
}

export function enviarCorreoRecuperacion(correo, enlace) {
  return enviarCorreo({
    correo,
    asunto: "Recupera tu contraseña — Piura Alerta",
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña en Piura Alerta.</p>
      <p><a href="${enlace}">Haz clic acá para elegir una nueva contraseña</a></p>
      <p>Si no fuiste tú, ignora este correo — el enlace expira en 1 hora y nadie más puede usarlo.</p>
    `,
    avisoDev: { enlace },
  });
}

// A diferencia de enviarCorreoRecuperacion/enviarCorreoCodigo2FA, esto no es
// un flujo de seguridad crítico -- no verificar el correo no bloquea el
// acceso (ver POST /api/auth/registro), así que no hace falta consultar el
// interruptor global de email_habilitado acá tampoco (ese solo gobierna
// avisos automáticos, no acciones que la propia persona disparó).
export function enviarCorreoVerificacion(correo, enlace) {
  return enviarCorreo({
    correo,
    asunto: "Confirma tu correo — Piura Alerta",
    html: `
      <p>Gracias por registrarte en Piura Alerta.</p>
      <p><a href="${enlace}">Haz clic acá para confirmar tu correo</a></p>
      <p>Si no creaste esta cuenta, ignora este correo — el enlace expira en 24 horas.</p>
    `,
    avisoDev: { enlace },
  });
}

// Doble autenticación para roles operativos (ver POST /api/auth/login):
// tampoco depende de email_habilitado, es un paso de acceso a la cuenta, no
// un aviso automático que se pueda apagar desde Configuración.
export function enviarCorreoCodigo2FA(correo, codigo) {
  return enviarCorreo({
    correo,
    asunto: `${codigo} es tu código de acceso — Piura Alerta`,
    html: `
      <p>Tu código de verificación para entrar a Piura Alerta es:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
      <p>Vence en 10 minutos. Si no fuiste tú quien intentó iniciar sesión, cambia tu contraseña.</p>
    `,
    avisoDev: { codigo },
  });
}

export async function enviarCorreoVencimientoPoliza(correo, fechaFin) {
  // Interruptor global (ver src/servicios/configuracion.js): solo afecta este
  // aviso automático, nunca enviarCorreoRecuperacion, que es un flujo de
  // cuenta (recuperar contraseña), no una alerta que se pueda apagar.
  const config = await obtenerConfiguracion();
  if (!config.email_habilitado) return;

  const fecha = new Date(fechaFin).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
  return enviarCorreo({
    correo,
    asunto: "Tu seguro contra inundaciones está por vencer — Piura Alerta",
    html: `
      <p>Tu póliza del seguro contra inundaciones de Piura Alerta vence el <strong>${fecha}</strong>.</p>
      <p>Renueva antes de esa fecha para no quedarte sin cobertura durante una crecida del río.</p>
      <p><a href="${frontendUrl}/seguro">Renovar mi cobertura</a></p>
    `,
    avisoDev: { correo, fechaFin },
  });
}

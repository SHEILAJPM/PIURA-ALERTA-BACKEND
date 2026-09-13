import { logger } from "../utilidades/logger.js";

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

export function enviarCorreoVencimientoPoliza(correo, fechaFin) {
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

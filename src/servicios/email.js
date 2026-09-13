import { Resend } from "resend";
import { logger } from "../lib/logger.js";

let resend = null;

// Igual que Telegram/Web Push/Twilio: sin cuenta de Resend configurada, el
// envío de correos queda desactivado sin romper nada más.
export function iniciarEmail() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("RESEND_API_KEY no configurado: el correo de recuperación de contraseña queda desactivado.");
    return;
  }
  resend = new Resend(apiKey);
}

export async function enviarCorreoRecuperacion(correo, enlace) {
  if (!resend) {
    // Fallback de desarrollo (nunca en producción): sin esto, no hay forma de
    // probar el flujo completo de "olvidé mi contraseña" localmente sin ya
    // tener una cuenta de Resend configurada.
    if (process.env.NODE_ENV !== "production") {
      logger.warn(
        { enlace },
        "RESEND_API_KEY no configurado: el enlace de recuperación solo queda en este log."
      );
    }
    return;
  }

  // El SDK de Resend no lanza en errores de la API (dominio no verificado,
  // límite de la cuenta, etc.) — devuelve { data, error } — así que hay que
  // revisar `error` a mano, si no un fallo real del envío queda invisible.
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Piura Alerta <onboarding@resend.dev>",
    to: correo,
    subject: "Recupera tu contraseña — Piura Alerta",
    html: `
      <p>Recibimos una solicitud para restablecer tu contraseña en Piura Alerta.</p>
      <p><a href="${enlace}">Haz clic acá para elegir una nueva contraseña</a></p>
      <p>Si no fuiste tú, ignora este correo — el enlace expira en 1 hora y nadie más puede usarlo.</p>
    `,
  });

  if (error) {
    logger.error({ err: error, correo }, "Error enviando correo de recuperación vía Resend");
  }
}

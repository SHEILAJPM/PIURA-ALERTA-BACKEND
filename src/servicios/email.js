import nodemailer from "nodemailer";
import { logger } from "../utilidades/logger.js";
import { obtenerConfiguracion } from "./configuracion.js";

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// Mismos colores que --color-primary/--color-normal/--color-alerta en
// index.css del frontend -- un correo no puede leer esas variables CSS, así
// que se duplican acá a propósito (igual que en MascotaAsistente3D.jsx).
const COLOR_PRIMARIO = "#0a2f52";
const COLOR_PRIMARIO_SUAVE = "#e2ebf3";
const COLOR_NORMAL = "#2f9e44";
const COLOR_NORMAL_SUAVE = "#e6f6ea";
const COLOR_ALERTA_SUAVE = "#fbe4e5";

// Envoltorio compartido por todos los correos: header con el nombre de la
// app, el cuerpo que manda cada función, y un footer -- así no se repite el
// layout en cada plantilla y todos se ven como parte del mismo sistema.
function plantillaCorreo(cuerpoHtml) {
  return `
    <div style="background-color:#f2f4f7;padding:32px 16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background-color:${COLOR_PRIMARIO};padding:20px 32px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;">🌊 Piura Alerta</span>
        </div>
        <div style="padding:32px;color:#1a2b3c;font-size:15px;line-height:1.6;">
          ${cuerpoHtml}
        </div>
        <div style="padding:18px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#64748b;font-size:12px;">
            Piura Alerta — sistema de monitoreo y alerta temprana del río Piura.
          </p>
        </div>
      </div>
    </div>
  `;
}

function botonCorreo(href, texto) {
  return `<a href="${href}" style="display:inline-block;margin-top:4px;padding:12px 24px;background-color:${COLOR_PRIMARIO};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;">${texto}</a>`;
}

let apiKey = null;
let transportadorGmail = null;

// Igual que Telegram/Web Push/Twilio: sin nada configurado, el envío de
// correos queda desactivado sin romper nada más. Gmail es solo un atajo para
// probar estos flujos en local sin pelear con el allowlist de IPs de Brevo
// (ver security/authorised_ips) -- en production seguiría yendo por Brevo.
export function iniciarEmail() {
  apiKey = process.env.BREVO_API_KEY;

  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    transportadorGmail = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }

  if (!apiKey && !transportadorGmail) {
    logger.warn("BREVO_API_KEY/GMAIL_* no configurados: los correos (recuperación, avisos) quedan desactivados.");
  }
}

// Compartida por cualquier correo que mande el backend (recuperación de
// contraseña, aviso de vencimiento de póliza, etc.) para no repetir la
// lógica de envío en cada uno. `avisoDev` es lo que queda en el log cuando
// no hay nada configurado, para poder probar el flujo en local.
async function enviarCorreo({ correo, asunto, html, avisoDev }) {
  if (transportadorGmail) {
    try {
      await transportadorGmail.sendMail({
        from: `"Piura Alerta" <${process.env.GMAIL_USER}>`,
        to: correo,
        subject: asunto,
        html,
      });
    } catch (err) {
      logger.error({ err, correo }, "Error enviando correo vía Gmail");
    }
    return;
  }

  if (!apiKey) {
    // Fallback de desarrollo (nunca en producción): sin esto, no hay forma de
    // probar estos flujos localmente sin ya tener una cuenta de Brevo/Gmail.
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
    html: plantillaCorreo(`
      <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_PRIMARIO};">Recupera tu contraseña</h2>
      <p style="margin:0 0 20px;">Recibimos una solicitud para restablecer tu contraseña en Piura Alerta.</p>
      ${botonCorreo(enlace, "Elegir nueva contraseña")}
      <p style="margin:24px 0 0;font-size:13px;color:#64748b;">
        Si no fuiste tú, ignora este correo — el enlace expira en 1 hora y nadie más puede usarlo.
      </p>
    `),
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
    html: plantillaCorreo(`
      <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_PRIMARIO};">Confirma tu correo</h2>
      <p style="margin:0 0 20px;">Gracias por registrarte en Piura Alerta.</p>
      ${botonCorreo(enlace, "Confirmar mi correo")}
      <p style="margin:24px 0 0;font-size:13px;color:#64748b;">
        Si no creaste esta cuenta, ignora este correo — el enlace expira en 24 horas.
      </p>
    `),
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
    html: plantillaCorreo(`
      <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_PRIMARIO};">Tu código de acceso</h2>
      <p style="margin:0 0 20px;">Usa este código para iniciar sesión en Piura Alerta:</p>
      <div style="text-align:center;margin:8px 0 24px;">
        <span style="display:inline-block;padding:16px 28px;background-color:${COLOR_PRIMARIO_SUAVE};color:${COLOR_PRIMARIO};font-size:32px;font-weight:800;letter-spacing:8px;border-radius:12px;">${codigo}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#64748b;">
        Vence en 10 minutos. Si no fuiste tú quien intentó iniciar sesión, cambia tu contraseña.
      </p>
    `),
    avisoDev: { codigo },
  });
}

export async function enviarCorreoReclamoRevisado(correo, { estado, montoAprobadoCentavos, motivoRechazo }) {
  // Mismo interruptor que enviarCorreoVencimientoPoliza: es un aviso
  // automático, no un flujo de cuenta -- se puede apagar desde Configuración.
  const config = await obtenerConfiguracion();
  if (!config.email_habilitado) return;

  const cuerpo =
    estado === "aprobado"
      ? `
        <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_NORMAL};">✅ Reclamo aprobado</h2>
        <p style="margin:0 0 20px;">Revisamos tu reclamo por daños del río y fue aprobado.</p>
        <div style="text-align:center;margin:8px 0 24px;">
          <span style="display:inline-block;padding:14px 24px;background-color:${COLOR_NORMAL_SUAVE};color:${COLOR_NORMAL};font-size:24px;font-weight:800;border-radius:12px;">
            S/ ${(montoAprobadoCentavos / 100).toFixed(2)}
          </span>
        </div>
        <p style="margin:0;font-size:14px;">Nos pondremos en contacto contigo para coordinar el pago.</p>
      `
      : `
        <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_PRIMARIO};">Sobre tu reclamo</h2>
        <p style="margin:0 0 16px;">Revisamos tu reclamo por daños del río y no pudimos aprobarlo.</p>
        <p style="margin:0;padding:14px 16px;background-color:${COLOR_ALERTA_SUAVE};border-radius:8px;font-size:14px;">
          <strong>Motivo:</strong> ${motivoRechazo}
        </p>
      `;

  return enviarCorreo({
    correo,
    asunto:
      estado === "aprobado"
        ? "Tu reclamo fue aprobado — Piura Alerta"
        : "Sobre tu reclamo del seguro — Piura Alerta",
    html: plantillaCorreo(cuerpo),
    avisoDev: { correo, estado, montoAprobadoCentavos, motivoRechazo },
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
    html: plantillaCorreo(`
      <h2 style="margin:0 0 16px;font-size:20px;color:${COLOR_PRIMARIO};">Tu cobertura está por vencer</h2>
      <p style="margin:0 0 20px;">
        Tu póliza del seguro contra inundaciones de Piura Alerta vence el <strong>${fecha}</strong>.
        Renueva antes de esa fecha para no quedarte sin cobertura durante una crecida del río.
      </p>
      ${botonCorreo(`${frontendUrl}/seguro`, "Renovar mi cobertura")}
    `),
    avisoDev: { correo, fechaFin },
  });
}

import Stripe from "stripe";
import { pool } from "../../bd/pool.js";
import { logger } from "../utilidades/logger.js";
import { enviarCorreoVencimientoPoliza } from "./email.js";

let stripe = null;

// Igual que Telegram/Web Push/Brevo: sin cuenta de Stripe configurada, el
// seguro queda desactivado sin romper nada más.
export function iniciarPagos() {
  const claveSecreta = process.env.STRIPE_SECRET_KEY;
  if (!claveSecreta) {
    logger.warn("STRIPE_SECRET_KEY no configurado: el seguro contra inundaciones queda desactivado.");
    return;
  }
  stripe = new Stripe(claveSecreta);
}

// Precio base sin descuento; los periodos más largos llevan un descuento
// tipo "paga el año, ahorra meses" en vez de cobrar cada mes por separado.
const PRECIO_MENSUAL_CENTAVOS = 1500; // S/ 15.00/mes
export const PLANES_SEGURO = {
  1: { meses: 1, descuento: 0 },
  3: { meses: 3, descuento: 0.1 },
  6: { meses: 6, descuento: 0.15 },
  12: { meses: 12, descuento: 0.2 },
};

export function calcularPrecioCentavos(meses) {
  const plan = PLANES_SEGURO[meses];
  const bruto = PRECIO_MENSUAL_CENTAVOS * plan.meses;
  return Math.round(bruto * (1 - plan.descuento));
}

export async function crearSesionCheckout({ usuarioId, correo, meses }) {
  if (!stripe) {
    const error = new Error("El seguro no está disponible en este momento");
    error.status = 503;
    throw error;
  }

  const precioCentavos = calcularPrecioCentavos(meses);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: correo,
    line_items: [
      {
        price_data: {
          currency: "pen",
          unit_amount: precioCentavos,
          product_data: {
            name: `Seguro Piura Alerta — ${meses} ${meses === 1 ? "mes" : "meses"}`,
            description: "Cobertura prepago contra inundaciones del río Piura",
          },
        },
        quantity: 1,
      },
    ],
    // Metadata es lo único que sobrevive hasta el webhook: ahí (no en la
    // respuesta al frontend) es donde se activa la póliza de verdad.
    metadata: { usuario_id: usuarioId, meses: String(meses) },
    success_url: `${frontendUrl}/mi-poliza?pago=exitoso`,
    cancel_url: `${frontendUrl}/seguro?pago=cancelado`,
  });
}

// El webhook manda el body crudo (sin parsear) — Stripe firma esos bytes
// exactos, así que si Express ya lo hubiera convertido a JSON la firma no
// coincidiría nunca. Ver el montaje en app.js, antes de express.json().
export function construirEventoWebhook(payloadCrudo, firma) {
  if (!stripe) {
    const error = new Error("El seguro no está disponible en este momento");
    error.status = 503;
    throw error;
  }
  return stripe.webhooks.constructEvent(payloadCrudo, firma, process.env.STRIPE_WEBHOOK_SECRET);
}

// Si ya tiene una póliza vigente, el nuevo periodo se suma al final de la
// que tiene en vez de pisarla (comprar antes de que venza extiende la
// cobertura, no la reinicia).
export async function activarPoliza({ usuarioId, meses, precioCentavos, stripeCheckoutSessionId }) {
  const { rows } = await pool.query(
    `SELECT fecha_fin FROM polizas_seguro
     WHERE usuario_id = $1 ORDER BY fecha_fin DESC LIMIT 1`,
    [usuarioId]
  );
  const vigenteHasta = rows[0]?.fecha_fin;
  const inicioBase = vigenteHasta && new Date(vigenteHasta) > new Date() ? vigenteHasta : new Date();

  await pool.query(
    `INSERT INTO polizas_seguro
       (usuario_id, meses, precio_centavos, moneda, stripe_checkout_session_id, fecha_inicio, fecha_fin)
     VALUES ($1, $2, $3, 'PEN', $4, $5, $5::timestamptz + ($6 || ' months')::interval)
     ON CONFLICT (stripe_checkout_session_id) DO NOTHING`,
    [usuarioId, meses, precioCentavos, stripeCheckoutSessionId, inicioBase, meses]
  );
}

const DIAS_ANTES_DE_AVISAR = 3;

// Solo avisa por la póliza VIGENTE de cada usuario (la de fecha_fin más
// lejana) -- si alguien ya tiene historial de periodos pasados, esos ya
// vencieron hace rato y no son la cobertura que le importa ahora mismo.
// Llamado por avisosVencimientoCron.js una vez al día.
export async function enviarAvisosVencimiento() {
  const { rows } = await pool.query(
    `SELECT p.id, p.fecha_fin, u.correo
     FROM polizas_seguro p
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.aviso_vencimiento_enviado = false
       AND p.fecha_fin BETWEEN now() AND now() + ($1 || ' days')::interval
       AND p.fecha_fin = (
         SELECT MAX(p2.fecha_fin) FROM polizas_seguro p2 WHERE p2.usuario_id = p.usuario_id
       )`,
    [DIAS_ANTES_DE_AVISAR]
  );

  for (const poliza of rows) {
    try {
      await enviarCorreoVencimientoPoliza(poliza.correo, poliza.fecha_fin);
      await pool.query("UPDATE polizas_seguro SET aviso_vencimiento_enviado = true WHERE id = $1", [
        poliza.id,
      ]);
    } catch (err) {
      // Un correo que falla no debe impedir que se intente con el resto de
      // la lista -- ni se marca como enviado, así el cron de mañana reintenta.
      logger.error({ err, polizaId: poliza.id }, "Error avisando vencimiento de póliza");
    }
  }

  return rows.length;
}

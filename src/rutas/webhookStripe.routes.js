import { Router } from "express";
import { construirEventoWebhook, activarPoliza } from "../servicios/pagos.js";
import { logger } from "../utilidades/logger.js";

const router = Router();

// Montada en app.js con express.raw() en vez de express.json(): Stripe firma
// los bytes exactos del body, así que si ya viniera parseado a objeto la
// verificación de la firma fallaría siempre.
router.post("/", async (req, res) => {
  let evento;
  try {
    evento = construirEventoWebhook(req.body, req.get("stripe-signature"));
  } catch (err) {
    logger.warn({ err }, "Webhook de Stripe con firma inválida");
    return res.status(400).send(`Firma inválida: ${err.message}`);
  }

  if (evento.type === "checkout.session.completed") {
    const session = evento.data.object;
    const { usuario_id: usuarioId, meses } = session.metadata;
    await activarPoliza({
      usuarioId,
      meses: Number(meses),
      precioCentavos: session.amount_total,
      stripeCheckoutSessionId: session.id,
    });
  }

  res.json({ recibido: true });
});

export default router;

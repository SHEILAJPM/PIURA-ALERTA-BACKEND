import { Router } from "express";
import { validarBody } from "../intermediarios/validate.js";
import { pushSuscripcionSchema, pushDesuscripcionSchema } from "../validacion/schemas.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { clavePublicaPush, guardarSuscripcionPush, eliminarSuscripcionPush } from "../servicios/webpush.js";

const router = Router();

// El frontend necesita la clave pública VAPID para pedir permiso de
// notificaciones (PushManager.subscribe). null si el backend no la tiene
// configurada: el frontend simplemente no ofrece la opción.
router.get("/clave-publica", (_req, res) => {
  res.json({ publicKey: clavePublicaPush() });
});

// Sin sesión, igual que /start de Telegram: cualquier visitante puede
// suscribirse desde el navegador sin necesitar cuenta.
router.post(
  "/suscribir",
  limitadorEscrituraPublica,
  validarBody(pushSuscripcionSchema),
  async (req, res, next) => {
    try {
      await guardarSuscripcionPush(req.body);
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/desuscribir",
  limitadorEscrituraPublica,
  validarBody(pushDesuscripcionSchema),
  async (req, res, next) => {
    try {
      await eliminarSuscripcionPush(req.body.endpoint);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;

import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { pool } from "../bd/pool.js";
import { logger } from "./utilidades/logger.js";
import sensoresRouter from "./rutas/sensores.routes.js";
import lecturasRouter from "./rutas/lecturas.routes.js";
import alberguesRouter from "./rutas/albergues.routes.js";
import zonasRiesgoRouter from "./rutas/zonasRiesgo.routes.js";
import reportesRouter from "./rutas/reportes.routes.js";
import authRouter from "./rutas/auth.routes.js";
import usuariosRouter from "./rutas/usuarios.routes.js";
import auditoriaRouter from "./rutas/auditoria.routes.js";
import ticketsRouter from "./rutas/tickets.routes.js";
import alertasRouter from "./rutas/alertas.routes.js";
import pushRouter from "./rutas/push.routes.js";
import polizasRouter from "./rutas/polizas.routes.js";
import webhookStripeRouter from "./rutas/webhookStripe.routes.js";
import asistenteRouter from "./rutas/asistente.routes.js";
import { manejadorErrores } from "./intermediarios/errorHandler.js";
import { limitadorGeneral } from "./intermediarios/rateLimit.js";

export const app = express();

// CORS_ORIGIN: lista separada por comas (ej. "https://piura-alerta.vercel.app,http://localhost:5173").
// Sin configurar, permite cualquier origen — cómodo en desarrollo local, pero
// se avisa una vez al arrancar para que no pase desapercibido en producción.
const origenesPermitidos = process.env.CORS_ORIGIN?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (!origenesPermitidos?.length) {
  logger.warn(
    "CORS_ORIGIN no configurado: se acepta cualquier origen. Configúralo antes de exponer el backend en producción."
  );
}

app.use(helmet());
app.use(cors(origenesPermitidos?.length ? { origin: origenesPermitidos } : undefined));
// Log estructurado por request (método, ruta, status, tiempo de respuesta) —
// en /health se apaga: el simulador/monitor de uptime le pega cada pocos
// segundos y ensuciaría los logs sin aportar nada. Serializers recortados a
// propósito: los de pino-http por defecto vuelcan headers/CSP completos por
// request, generan mucho volumen para el plan gratuito de un host de logs.
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);
// Antes de express.json(): Stripe firma el body crudo, así que esta ruta
// necesita los bytes tal cual llegan, no el objeto ya parseado. Ver
// src/servicios/pagos.js (construirEventoWebhook).
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), webhookStripeRouter);

app.use(express.json({ limit: "1mb" }));
app.use("/api", limitadorGeneral);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ estado: "ok", db: "conectada" });
  } catch (err) {
    res.status(503).json({ estado: "error", db: err.message });
  }
});

app.use("/api/sensores", sensoresRouter);
app.use("/api/lecturas", lecturasRouter);
app.use("/api/albergues", alberguesRouter);
app.use("/api/zonas-riesgo", zonasRiesgoRouter);
app.use("/api/reportes-ciudadanos", reportesRouter);
app.use("/api/auth", authRouter);
app.use("/api/usuarios", usuariosRouter);
app.use("/api/auditoria", auditoriaRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/alertas", alertasRouter);
app.use("/api/push", pushRouter);
app.use("/api/polizas", polizasRouter);
app.use("/api/asistente", asistenteRouter);

app.use(manejadorErrores);

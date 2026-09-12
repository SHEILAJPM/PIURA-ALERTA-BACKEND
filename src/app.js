import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { pool } from "../db/pool.js";
import { logger } from "./lib/logger.js";
import sensoresRouter from "./routes/sensores.routes.js";
import lecturasRouter from "./routes/lecturas.routes.js";
import alberguesRouter from "./routes/albergues.routes.js";
import zonasRiesgoRouter from "./routes/zonasRiesgo.routes.js";
import reportesRouter from "./routes/reportes.routes.js";
import authRouter from "./routes/auth.routes.js";
import usuariosRouter from "./routes/usuarios.routes.js";
import auditoriaRouter from "./routes/auditoria.routes.js";
import ticketsRouter from "./routes/tickets.routes.js";
import alertasRouter from "./routes/alertas.routes.js";
import pushRouter from "./routes/push.routes.js";
import { manejadorErrores } from "./middleware/errorHandler.js";
import { limitadorGeneral } from "./middleware/rateLimit.js";

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

app.use(manejadorErrores);

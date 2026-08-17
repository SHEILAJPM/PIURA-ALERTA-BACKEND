import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "../db/pool.js";
import sensoresRouter from "./routes/sensores.routes.js";
import lecturasRouter from "./routes/lecturas.routes.js";
import alberguesRouter from "./routes/albergues.routes.js";
import zonasRiesgoRouter from "./routes/zonasRiesgo.routes.js";
import reportesRouter from "./routes/reportes.routes.js";
import authRouter from "./routes/auth.routes.js";
import { manejadorErrores } from "./middleware/errorHandler.js";
import { limitadorGeneral } from "./middleware/rateLimit.js";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
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

app.use(manejadorErrores);

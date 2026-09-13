import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import { preguntaAsistenteSchema, feedbackAsistenteSchema } from "../validacion/schemas.js";
import { limitadorAsistente, limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { responderPregunta } from "../servicios/asistente.js";

const router = Router();

// Público, sin sesión: cualquier visitante (con o sin cuenta) puede tener
// una duda antes de decidir reportar algo o buscar un albergue.
router.post("/preguntar", limitadorAsistente, validarBody(preguntaAsistenteSchema), async (req, res, next) => {
  try {
    const { pregunta, historial } = req.body;
    const respuesta = await responderPregunta({ pregunta, historial });
    res.json({ respuesta });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/feedback",
  limitadorEscrituraPublica,
  validarBody(feedbackAsistenteSchema),
  async (req, res, next) => {
    try {
      const { pregunta, respuesta, util } = req.body;
      await pool.query(
        "INSERT INTO asistente_feedback (pregunta, respuesta, util) VALUES ($1, $2, $3)",
        [pregunta, respuesta, util]
      );
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// Panel admin: para saber si el asistente de verdad ayuda o si hay
// preguntas que sistemáticamente responde mal.
router.get("/feedback", requerirSesion, requerirRol("administrador"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, pregunta, respuesta, util, creado_en FROM asistente_feedback ORDER BY creado_en DESC LIMIT 200"
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";

const router = Router();

// Marcar "estoy a salvo": un registro nuevo cada vez (no un UPDATE), para que
// quede el historial completo de una emergencia larga -- ver bd/schema.sql.
router.post("/", requerirSesion, limitadorEscrituraPublica, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "INSERT INTO chequeos_seguridad (usuario_id) VALUES ($1) RETURNING id, creado_en",
      [req.usuario.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get("/mio", requerirSesion, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT creado_en FROM chequeos_seguridad WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT 1",
      [req.usuario.id]
    );
    res.json({ ultimoChequeo: rows[0]?.creado_en ?? null });
  } catch (err) {
    next(err);
  }
});

// Panel de Defensa Civil/admin: quién marcó que está a salvo y cuándo fue su
// último chequeo (o nunca), para priorizar a quién buscar durante una
// emergencia. Solo ciudadanos con cuenta -- no hay forma de rastrear a
// alguien anónimo, que es justo el punto de este chequeo.
router.get(
  "/",
  requerirSesion,
  requerirRol("administrador", "defensa_civil"),
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id AS usuario_id, u.nombre, u.telefono,
                (SELECT MAX(c.creado_en) FROM chequeos_seguridad c WHERE c.usuario_id = u.id) AS ultimo_chequeo
         FROM usuarios u
         WHERE u.rol = 'ciudadano'
         ORDER BY ultimo_chequeo DESC NULLS LAST, u.nombre`
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

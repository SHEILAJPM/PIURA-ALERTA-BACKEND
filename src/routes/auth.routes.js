import { Router } from "express";
import { pool } from "../../db/pool.js";
import { validarBody } from "../middleware/validate.js";
import { registroSchema, loginSchema } from "../validation/schemas.js";
import { requerirSesion } from "../middleware/auth.js";
import { limitadorLogin } from "../middleware/rateLimit.js";
import { hashearPassword, verificarPassword, generarToken } from "../services/auth.js";

const router = Router();

// Código de Postgres para violación de restricción UNIQUE (dni o correo repetido).
const VIOLACION_UNIQUE = "23505";
const MENSAJE_POR_CONSTRAINT = {
  usuarios_dni_key: "Ya existe una cuenta con ese DNI",
  usuarios_correo_key: "Ya existe una cuenta con ese correo",
};

router.post("/registro", validarBody(registroSchema), async (req, res, next) => {
  try {
    const { nombre, dni, telefono, direccion, correo, password } = req.body;
    const passwordHash = await hashearPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, dni, telefono, direccion, correo, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, correo, rol`,
      [nombre, dni ?? null, telefono ?? null, direccion ?? null, correo, passwordHash]
    );

    const usuario = rows[0];
    res.status(201).json({ token: generarToken(usuario), usuario });
  } catch (err) {
    if (err.code === VIOLACION_UNIQUE) {
      const mensaje = MENSAJE_POR_CONSTRAINT[err.constraint] ?? "Ese usuario ya existe";
      return res.status(409).json({ error: mensaje });
    }
    next(err);
  }
});

router.post("/login", limitadorLogin, validarBody(loginSchema), async (req, res, next) => {
  try {
    const { correo, password } = req.body;
    const { rows } = await pool.query(
      "SELECT id, nombre, correo, password_hash, rol FROM usuarios WHERE correo = $1",
      [correo]
    );

    // Mensaje genérico sin importar cuál de los dos falló, para no revelar
    // qué correos están registrados.
    const credencialesInvalidas = () => res.status(401).json({ error: "Correo o contraseña incorrectos" });

    if (rows.length === 0) return credencialesInvalidas();

    const usuario = rows[0];
    const passwordValido = await verificarPassword(password, usuario.password_hash);
    if (!passwordValido) return credencialesInvalidas();

    const { password_hash: _hash, ...usuarioPublico } = usuario;
    res.json({ token: generarToken(usuarioPublico), usuario: usuarioPublico });
  } catch (err) {
    next(err);
  }
});

router.get("/yo", requerirSesion, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, dni, telefono, direccion, correo, rol, creado_en FROM usuarios WHERE id = $1",
      [req.usuario.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;

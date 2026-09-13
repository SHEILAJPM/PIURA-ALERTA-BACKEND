import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../../bd/pool.js";
import { validarBody } from "../intermediarios/validate.js";
import {
  registroSchema,
  loginSchema,
  perfilSchema,
  cambiarPasswordSchema,
  olvidePasswordSchema,
  restablecerPasswordSchema,
  verificarCorreoSchema,
  login2FASchema,
} from "../validacion/schemas.js";
import { requerirSesion } from "../intermediarios/auth.js";
import { limitadorLogin } from "../intermediarios/rateLimit.js";
import { hashearPassword, verificarPassword, generarToken } from "../servicios/auth.js";
import { enviarCorreoRecuperacion, enviarCorreoVerificacion, enviarCorreoCodigo2FA } from "../servicios/email.js";

// Roles operativos: manejan datos sensibles y pueden difundir alertas
// masivas, por eso llevan un segundo paso de verificación al iniciar sesión
// (ver POST /login). Un ciudadano normal no lo necesita.
const ROLES_CON_2FA = ["operario", "defensa_civil", "administrador"];

const router = Router();

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generarCodigo6Digitos() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// Compartido por /registro (primer correo) y /reenviar-verificacion. No
// lanza si el correo falla (mismo criterio que enviarCorreoRecuperacion en
// olvide-password): un correo de bienvenida caído no debe tumbar el
// registro de la cuenta.
async function mandarCorreoVerificacion(usuarioId, correo) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiraEn = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO verificaciones_correo (usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)",
    [usuarioId, hashToken(token), expiraEn]
  );
  const base = process.env.FRONTEND_URL ?? "http://localhost:5173";
  await enviarCorreoVerificacion(correo, `${base}/verificar-correo?token=${token}`);
}

// Código de Postgres para violación de restricción UNIQUE (dni o correo repetido).
const VIOLACION_UNIQUE = "23505";
const MENSAJE_POR_CONSTRAINT = {
  usuarios_dni_key: "Ya existe una cuenta con ese DNI",
  usuarios_correo_key: "Ya existe una cuenta con ese correo",
};

router.post("/registro", validarBody(registroSchema), async (req, res, next) => {
  try {
    const { nombre, dni, telefono, direccion, correo, password, recibir_alertas_sms: recibirSMS } = req.body;
    const passwordHash = await hashearPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, dni, telefono, direccion, correo, password_hash, recibir_alertas_sms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre, correo, rol`,
      [nombre, dni ?? null, telefono ?? null, direccion ?? null, correo, passwordHash, recibirSMS ?? false]
    );

    const usuario = rows[0];
    await mandarCorreoVerificacion(usuario.id, usuario.correo);
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

    if (ROLES_CON_2FA.includes(usuario.rol)) {
      const codigo = generarCodigo6Digitos();
      const expiraEn = new Date(Date.now() + 10 * 60 * 1000);
      const { rows: verifRows } = await pool.query(
        "INSERT INTO verificaciones_2fa (usuario_id, codigo_hash, expira_en) VALUES ($1, $2, $3) RETURNING id",
        [usuario.id, hashToken(codigo), expiraEn]
      );
      await enviarCorreoCodigo2FA(usuario.correo, codigo);
      return res.json({ requiere_2fa: true, referencia: verifRows[0].id });
    }

    res.json({ token: generarToken(usuarioPublico), usuario: usuarioPublico });
  } catch (err) {
    next(err);
  }
});

// Segundo paso del login para roles operativos (ver ROLES_CON_2FA arriba).
// limitadorLogin acá también: sin él, el código de 6 dígitos (1 millón de
// combinaciones) sería adivinable a fuerza bruta en los 10 minutos que dura.
router.post("/verificar-2fa", limitadorLogin, validarBody(login2FASchema), async (req, res, next) => {
  try {
    const { referencia, codigo } = req.body;
    const { rows } = await pool.query(
      `SELECT v.usuario_id, u.nombre, u.correo, u.rol
       FROM verificaciones_2fa v JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.id = $1 AND v.codigo_hash = $2 AND v.usado_en IS NULL AND v.expira_en > now()`,
      [referencia, hashToken(codigo)]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "Código inválido o expirado" });
    }

    await pool.query("UPDATE verificaciones_2fa SET usado_en = now() WHERE id = $1", [referencia]);
    const usuarioPublico = { id: rows[0].usuario_id, nombre: rows[0].nombre, correo: rows[0].correo, rol: rows[0].rol };
    res.json({ token: generarToken(usuarioPublico), usuario: usuarioPublico });
  } catch (err) {
    next(err);
  }
});

router.get("/yo", requerirSesion, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, dni, telefono, direccion, correo, rol, recibir_alertas_sms,
              sensor_interes_id, correo_verificado, creado_en
       FROM usuarios WHERE id = $1`,
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

// Solo nombre/teléfono/dirección/opt-in de SMS/sensor de interés — no correo
// (es el identificador de login) ni DNI (dato sensible que se pide una sola
// vez, ver registro).
router.patch("/yo", requerirSesion, validarBody(perfilSchema), async (req, res, next) => {
  try {
    const { nombre, telefono, direccion, recibir_alertas_sms: recibirSMS } = req.body;
    // sensor_interes_id necesita distinguir "no vino en el body" (no tocar)
    // de "vino como null" (quitar el filtro, volver a 'todos los sensores'):
    // COALESCE no puede distinguir esos dos casos porque ambos son NULL a
    // nivel SQL, por eso se maneja aparte con el CASE WHEN de abajo.
    const tocaSensorInteres = "sensor_interes_id" in req.body;
    const sensorInteres = req.body.sensor_interes_id ?? null;

    if (recibirSMS === true) {
      // No se puede activar el opt-in sin un teléfono al que mandar el SMS
      // (ni el que llega en este mismo request, ni el que ya tenía guardado).
      const telefonoResultante =
        telefono ??
        (await pool.query("SELECT telefono FROM usuarios WHERE id = $1", [req.usuario.id])).rows[0]?.telefono;
      if (!telefonoResultante) {
        return res.status(400).json({ error: "Agrega primero un teléfono para activar las alertas por SMS" });
      }
    }

    const { rows } = await pool.query(
      `UPDATE usuarios
       SET nombre = COALESCE($2, nombre),
           telefono = COALESCE($3, telefono),
           direccion = COALESCE($4, direccion),
           recibir_alertas_sms = COALESCE($5, recibir_alertas_sms),
           sensor_interes_id = CASE WHEN $6 THEN $7::uuid ELSE sensor_interes_id END
       WHERE id = $1
       RETURNING id, nombre, dni, telefono, direccion, correo, rol, recibir_alertas_sms,
                 sensor_interes_id, correo_verificado, creado_en`,
      [
        req.usuario.id,
        nombre ?? null,
        telefono ?? null,
        direccion ?? null,
        recibirSMS ?? null,
        tocaSensorInteres,
        sensorInteres,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/contrasena", requerirSesion, validarBody(cambiarPasswordSchema), async (req, res, next) => {
  try {
    const { passwordActual, passwordNueva } = req.body;
    const { rows } = await pool.query("SELECT password_hash FROM usuarios WHERE id = $1", [req.usuario.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const valida = await verificarPassword(passwordActual, rows[0].password_hash);
    if (!valida) {
      return res.status(401).json({ error: "La contraseña actual no es correcta" });
    }

    const nuevoHash = await hashearPassword(passwordNueva);
    await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [nuevoHash, req.usuario.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// No requiere sesión (obviamente: es para cuando no puedes entrar). Mismo
// mensaje exista o no la cuenta, para no revelar qué correos están
// registrados — el que sí recibe el correo es el único indicio real.
router.post("/olvide-password", limitadorLogin, validarBody(olvidePasswordSchema), async (req, res, next) => {
  try {
    const { correo } = req.body;
    const { rows } = await pool.query("SELECT id FROM usuarios WHERE correo = $1", [correo]);

    if (rows.length > 0) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiraEn = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        "INSERT INTO restablecimientos_password (usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)",
        [rows[0].id, hashToken(token), expiraEn]
      );
      const base = process.env.FRONTEND_URL ?? "http://localhost:5173";
      await enviarCorreoRecuperacion(correo, `${base}/restablecer-password?token=${token}`);
    }

    res.json({ mensaje: "Si el correo existe, te llegará un enlace para restablecer tu contraseña." });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/restablecer-password",
  limitadorLogin,
  validarBody(restablecerPasswordSchema),
  async (req, res, next) => {
    try {
      const { token, passwordNueva } = req.body;
      const { rows } = await pool.query(
        `SELECT id, usuario_id FROM restablecimientos_password
         WHERE token_hash = $1 AND usado_en IS NULL AND expira_en > now()`,
        [hashToken(token)]
      );
      if (rows.length === 0) {
        return res.status(400).json({ error: "El enlace no es válido o ya expiró" });
      }

      const { id, usuario_id: usuarioId } = rows[0];
      const nuevoHash = await hashearPassword(passwordNueva);
      await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [nuevoHash, usuarioId]);
      await pool.query("UPDATE restablecimientos_password SET usado_en = now() WHERE id = $1", [id]);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post("/verificar-correo", validarBody(verificarCorreoSchema), async (req, res, next) => {
  try {
    const { token } = req.body;
    const { rows } = await pool.query(
      `SELECT id, usuario_id FROM verificaciones_correo
       WHERE token_hash = $1 AND usado_en IS NULL AND expira_en > now()`,
      [hashToken(token)]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "El enlace no es válido o ya expiró" });
    }

    const { id, usuario_id: usuarioId } = rows[0];
    await pool.query("UPDATE usuarios SET correo_verificado = true WHERE id = $1", [usuarioId]);
    await pool.query("UPDATE verificaciones_correo SET usado_en = now() WHERE id = $1", [id]);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Para cuando el primer correo (enviado en /registro) se perdió o expiró.
router.post("/reenviar-verificacion", requerirSesion, limitadorLogin, async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT correo, correo_verificado FROM usuarios WHERE id = $1", [
      req.usuario.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (rows[0].correo_verificado) {
      return res.status(400).json({ error: "Tu correo ya está verificado" });
    }

    await mandarCorreoVerificacion(req.usuario.id, rows[0].correo);
    res.json({ mensaje: "Te mandamos un nuevo correo de verificación." });
  } catch (err) {
    next(err);
  }
});

export default router;

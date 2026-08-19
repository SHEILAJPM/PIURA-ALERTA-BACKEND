import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const COSTO_HASH = 10;
const EXPIRA_EN = "7d";

// Falla al arrancar (igual que db/pool.js con DATABASE_URL) en vez de recién
// al primer login/registro: sin esto, todo /api/auth/* y cualquier ruta con
// requerirSesion responderían 500 en producción sin ninguna pista clara.
if (!process.env.JWT_SECRET) {
  throw new Error("Falta JWT_SECRET en el archivo .env");
}
const SECRETO = process.env.JWT_SECRET;

export function hashearPassword(password) {
  return bcrypt.hash(password, COSTO_HASH);
}

export function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generarToken(usuario) {
  return jwt.sign({ sub: usuario.id, nombre: usuario.nombre, rol: usuario.rol ?? "ciudadano" }, SECRETO, {
    expiresIn: EXPIRA_EN,
  });
}

// Lanza si el token es inválido o expiró; el llamador decide qué responder.
export function verificarToken(token) {
  const payload = jwt.verify(token, SECRETO);
  return { id: payload.sub, nombre: payload.nombre, rol: payload.rol ?? "ciudadano" };
}

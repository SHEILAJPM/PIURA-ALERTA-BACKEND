import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const COSTO_HASH = 10;
const EXPIRA_EN = "7d";

function obtenerSecreto() {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) {
    throw new Error("Falta JWT_SECRET en el archivo .env");
  }
  return secreto;
}

export function hashearPassword(password) {
  return bcrypt.hash(password, COSTO_HASH);
}

export function verificarPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generarToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, nombre: usuario.nombre, rol: usuario.rol ?? "ciudadano" },
    obtenerSecreto(),
    { expiresIn: EXPIRA_EN }
  );
}

// Lanza si el token es inválido o expiró; el llamador decide qué responder.
export function verificarToken(token) {
  const payload = jwt.verify(token, obtenerSecreto());
  return { id: payload.sub, nombre: payload.nombre, rol: payload.rol ?? "ciudadano" };
}

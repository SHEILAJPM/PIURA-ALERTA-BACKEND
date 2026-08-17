import { verificarToken } from "../services/auth.js";

function extraerToken(req) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

// Para rutas que solo pueden usarse con sesión (publicar, dar like).
export function requerirSesion(req, res, next) {
  const token = extraerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Se requiere iniciar sesión" });
  }
  try {
    req.usuario = verificarToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

// Para rutas de un rol específico (ej. operario verificando reportes). Debe ir
// después de requerirSesion en la cadena de middlewares, ya que depende de
// req.usuario.
export function requerirRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.usuario?.rol)) {
      return res.status(403).json({ error: "No tenés permiso para esta acción" });
    }
    next();
  };
}

// Para rutas públicas que además quieren saber quién está mirando si hay
// sesión (ej. marcar si el usuario actual ya le dio like a cada reporte).
// Nunca rechaza la request: si el token falta o es inválido, sigue sin
// req.usuario en vez de responder 401.
export function autenticacionOpcional(req, _res, next) {
  const token = extraerToken(req);
  if (token) {
    try {
      req.usuario = verificarToken(token);
    } catch {
      // token inválido/expirado en una ruta pública: se ignora, sigue como anónimo
    }
  }
  next();
}

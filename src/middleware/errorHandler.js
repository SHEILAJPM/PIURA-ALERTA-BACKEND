import { logger } from "../lib/logger.js";
import { capturarError } from "../lib/sentry.js";

// Errores "operacionales" (los que el propio código lanza a propósito, ej. 404
// sensor no encontrado, 400 de validación) traen `status` y su mensaje es
// seguro para el cliente. Cualquier otro error (SQL, bug, etc.) se loguea
// completo en el servidor pero al cliente solo le llega un mensaje genérico,
// para no filtrar detalles internos (consultas, rutas de archivo, etc.).
export function manejadorErrores(err, req, res, _next) {
  const esOperacional = typeof err.status === "number";

  if (esOperacional) {
    logger.warn({ err, path: req.path }, err.message);
  } else {
    logger.error({ err, path: req.path }, "Error inesperado");
    capturarError(err);
  }

  res.status(esOperacional ? err.status : 500).json({
    error: esOperacional ? err.message : "Error interno del servidor",
  });
}

import rateLimit from "express-rate-limit";

function respuestaLimite(_req, res) {
  res.status(429).json({ error: "Demasiadas solicitudes, intenta de nuevo más tarde" });
}

// Aplica a todo /api/*: protección general contra scraping/abuso básico.
export const limitadorGeneral = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuestaLimite,
});

// Ingesta de lecturas: el simulador/ESP32 envía ~1 lectura cada pocos
// segundos, así que el límite deja bastante margen sobre el uso normal.
export const limitadorLecturas = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuestaLimite,
});

// Escritura pública (reportes ciudadanos, albergues): tráfico humano, no de
// sensores, así que el límite es mucho más estricto.
export const limitadorEscrituraPublica = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuestaLimite,
});

// Login: mucho más estricto que el límite general (300/5min compartido por
// todo /api/*), para frenar fuerza bruta de contraseñas por IP sin depender
// de un bloqueo por cuenta (que además abriría la puerta a bloquear a otro
// usuario a propósito con solo su correo).
export const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: respuestaLimite,
});

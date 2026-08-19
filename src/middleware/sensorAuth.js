import { logger } from "../lib/logger.js";

// Protege el endpoint de ingesta (POST /api/lecturas) con una API key
// compartida, para que no cualquiera pueda inyectar lecturas falsas y
// disparar alertas reales (Telegram, WebSocket) a la población.
//
// Igual que el bot de Telegram (ver services/telegram.js), si no se configura
// SENSOR_API_KEY el sistema sigue funcionando mientras se termina de armar el
// entorno, pero queda sin proteger: se avisa una sola vez al arrancar.
export function requerirApiKeySensor(req, res, next) {
  const apiKey = process.env.SENSOR_API_KEY;
  if (!apiKey) return next();

  if (req.get("x-api-key") !== apiKey) {
    return res.status(401).json({ error: "API key de sensor inválida o ausente" });
  }
  next();
}

export function advertirSiSensorApiKeyFalta() {
  if (!process.env.SENSOR_API_KEY) {
    logger.warn(
      "SENSOR_API_KEY no configurado: POST /api/lecturas queda sin autenticar. " +
        "Configúralo en .env antes de exponer el backend públicamente."
    );
  }
}

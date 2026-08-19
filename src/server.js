import "dotenv/config";
// Antes que "./app.js" y su árbol de imports (rutas, servicios, db/pool.js):
// si algo revienta durante la inicialización, igual queda reportado. Ver el
// comentario en lib/sentry.js sobre por qué esto tiene que ser un import
// posicional y no una función que se llama después.
import "./lib/sentry.js";
import { app } from "./app.js";
import { pool } from "../db/pool.js";
import { logger } from "./lib/logger.js";
import { iniciarWebSocket, cerrarWebSocket } from "./services/websocket.js";
import { iniciarTelegram, detenerTelegram } from "./services/telegram.js";
import { iniciarIngestaSerial } from "./services/serialIngest.js";
import { iniciarCronParticiones } from "./jobs/particionesCron.js";
import { advertirSiSensorApiKeyFalta } from "./middleware/sensorAuth.js";

const PORT = process.env.PORT ?? 4000;
const SENSOR_POR_DEFECTO = process.env.SIM_SENSOR_CODIGO ?? "RIO-PIURA-01";

// El WebSocket se monta sobre el mismo servidor HTTP (ver services/websocket.js)
// en vez de un puerto aparte: un solo puerto público, como esperan la mayoría
// de hosts (Render, Railway, Docker con un solo puerto mapeado).
const server = app.listen(PORT, () => {
  logger.info(`API REST + WebSocket escuchando en http://localhost:${PORT}`);
});

iniciarWebSocket(server);

const puertoSerial = iniciarIngestaSerial({
  path: process.env.SERIAL_PORT,
  baudRate: Number(process.env.BAUD_RATE ?? 115200),
  sensorCodigo: SENSOR_POR_DEFECTO,
});

const tareaCron = iniciarCronParticiones();
iniciarTelegram(process.env.TELEGRAM_BOT_TOKEN);
advertirSiSensorApiKeyFalta();

// Apagado ordenado: en Render/Railway/Docker, `docker stop`/redeploys mandan
// SIGTERM y dan un plazo corto antes de matar el proceso a la fuerza. Sin
// esto, las requests e conexiones WS en curso se cortan de golpe y el pool
// de Postgres queda con conexiones a medio cerrar.
let apagando = false;
async function apagar(señal) {
  if (apagando) return;
  apagando = true;
  console.log(`\n${señal} recibido, cerrando ordenadamente...`);

  tareaCron.stop();
  puertoSerial?.close?.();
  await detenerTelegram();
  await cerrarWebSocket();

  server.close(async () => {
    await pool.end();
    console.log("Apagado completo.");
    process.exit(0);
  });

  // Si algo queda colgado (una request larga, un handle que no cierra), no
  // dejar el proceso vivo indefinidamente esperando.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));

import "dotenv/config";
import { app } from "./app.js";
import { iniciarWebSocket } from "./services/websocket.js";
import { iniciarTelegram } from "./services/telegram.js";
import { iniciarIngestaSerial } from "./services/serialIngest.js";
import { iniciarCronParticiones } from "./jobs/particionesCron.js";
import { advertirSiSensorApiKeyFalta } from "./middleware/sensorAuth.js";

const PORT = process.env.PORT ?? 4000;
const WS_PORT = process.env.WS_PORT ?? 8080;
const SENSOR_POR_DEFECTO = process.env.SIM_SENSOR_CODIGO ?? "RIO-PIURA-01";

app.listen(PORT, () => {
  console.log(`API REST escuchando en http://localhost:${PORT}`);
});

iniciarWebSocket(WS_PORT);
console.log(`WebSocket escuchando en ws://localhost:${WS_PORT}`);

iniciarTelegram(process.env.TELEGRAM_BOT_TOKEN);

iniciarIngestaSerial({
  path: process.env.SERIAL_PORT,
  baudRate: Number(process.env.BAUD_RATE ?? 115200),
  sensorCodigo: SENSOR_POR_DEFECTO,
});

iniciarCronParticiones();
advertirSiSensorApiKeyFalta();

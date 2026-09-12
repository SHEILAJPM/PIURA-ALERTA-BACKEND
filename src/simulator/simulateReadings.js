import "dotenv/config";

// Sustituye al ESP32 mientras no está conectado por SerialPort: envía
// lecturas por HTTP al mismo endpoint que usará el hardware real
// (POST /api/lecturas), para poder probar todo el pipeline
// (alertEngine -> WebSocket -> Telegram) de punta a punta.

const PORT = process.env.PORT ?? 4000;
const URL_LECTURAS = `http://localhost:${PORT}/api/lecturas`;
const SENSOR_CODIGO = process.env.SIM_SENSOR_CODIGO ?? "RIO-PIURA-01";
const INTERVALO_MS = Number(process.env.SIM_INTERVALO_MS ?? 5000);

let nivel = 6;
let direccion = 1;

async function enviarLectura() {
  nivel += direccion * Math.random() * 0.8 + (Math.random() - 0.5) * 0.3;
  if (nivel >= 20) direccion = -1;
  if (nivel <= 2) direccion = 1;
  const nivelCm = Math.max(0, Number(nivel.toFixed(2)));

  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.SENSOR_API_KEY) headers["x-api-key"] = process.env.SENSOR_API_KEY;

    const respuesta = await fetch(URL_LECTURAS, {
      method: "POST",
      headers,
      body: JSON.stringify({ sensor_codigo: SENSOR_CODIGO, nivel_cm: nivelCm }),
    });
    const datos = await respuesta.json();
    console.log(
      `[simulador] nivel=${nivelCm}cm -> ${respuesta.status}`,
      datos.lectura?.estado ?? datos.error
    );
  } catch (err) {
    console.error("[simulador] error enviando lectura:", err.message);
  }
}

console.log(`Simulando lecturas de '${SENSOR_CODIGO}' cada ${INTERVALO_MS}ms hacia ${URL_LECTURAS}`);
setInterval(enviarLectura, INTERVALO_MS);

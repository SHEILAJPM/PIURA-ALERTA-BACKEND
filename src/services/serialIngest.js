import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { procesarLectura } from "./alertEngine.js";
import { transmitir } from "./websocket.js";
import { notificarCambioEstado } from "./telegram.js";

// Ingesta real del ESP32: el firmware escribe una línea de texto por lectura
// (número plano "12.4" o JSON {"nivel_cm":12.4}) y acá se reusa el mismo
// punto de entrada que usa el simulador HTTP (procesarLectura), tal como
// estaba planeado en el comentario original de lecturas.routes.js.
export function iniciarIngestaSerial({ path, baudRate, sensorCodigo }) {
  if (!path) {
    console.warn("SERIAL_PORT no configurado: la ingesta por puerto serie del ESP32 queda desactivada.");
    return null;
  }

  const puerto = new SerialPort({ path, baudRate }, (err) => {
    if (err) console.error(`No se pudo abrir el puerto serie ${path}:`, err.message);
  });

  const parser = puerto.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (linea) => manejarLinea(linea, sensorCodigo));

  puerto.on("error", (err) => console.error("Error de puerto serie:", err.message));
  puerto.on("open", () => console.log(`Puerto serie ${path} abierto a ${baudRate} baudios.`));

  return puerto;
}

async function manejarLinea(linea, sensorCodigo) {
  const nivelCm = parsearNivel(linea);
  if (nivelCm === null) {
    console.warn(`[serial] línea ignorada (formato inválido): ${linea.trim()}`);
    return;
  }

  try {
    const { lectura, evento } = await procesarLectura({ sensorCodigo, nivelCm });
    transmitir("lectura", lectura);
    if (evento) {
      transmitir("evento_alerta", evento);
      await notificarCambioEstado(evento);
    }
  } catch (err) {
    console.error("[serial] error procesando lectura:", err.message);
  }
}

function parsearNivel(linea) {
  const texto = linea.trim();
  if (!texto) return null;

  const comoJson = intentarParsearJson(texto);
  if (comoJson && typeof comoJson.nivel_cm === "number" && Number.isFinite(comoJson.nivel_cm)) {
    return comoJson.nivel_cm;
  }

  const comoNumero = Number(texto);
  return Number.isFinite(comoNumero) ? comoNumero : null;
}

function intentarParsearJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

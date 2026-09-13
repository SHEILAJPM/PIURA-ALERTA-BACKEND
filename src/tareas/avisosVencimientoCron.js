import cron from "node-cron";
import { logger } from "../utilidades/logger.js";
import { enviarAvisosVencimiento } from "../servicios/pagos.js";

// Corre una vez al iniciar el servidor (por si el servidor estuvo caído el
// día que le tocaba avisar a alguien) y luego todos los días a las 09:00 --
// mismo patrón que particionesCron.js.
export function iniciarCronAvisosVencimiento() {
  avisar();
  return cron.schedule("0 9 * * *", avisar);
}

async function avisar() {
  try {
    const cantidad = await enviarAvisosVencimiento();
    if (cantidad > 0) {
      logger.info(`[cron] ${cantidad} aviso(s) de vencimiento de póliza enviado(s).`);
    }
  } catch (err) {
    logger.error({ err }, "[cron] error enviando avisos de vencimiento de pólizas");
  }
}

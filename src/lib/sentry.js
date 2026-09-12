import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

// Se inicializa al importar este módulo (no al llamar una función después):
// en ES modules, TODOS los imports de un archivo se evalúan antes que
// cualquier otra sentencia del propio archivo, sin importar el orden en que
// estén escritos (ver test/env-setup.js para el mismo problema en los
// tests). La única forma de garantizar que Sentry quede listo antes que el
// resto del proyecto es que la inicialización sea un efecto de este import,
// y que server.js lo importe primero que a "./app.js".
//
// Mismo patrón que GROQ_API_KEY/TELEGRAM_BOT_TOKEN/SENSOR_API_KEY: sin
// SENTRY_DSN configurado, el backend sigue funcionando igual, solo sin
// reportar errores a Sentry (se avisa una vez al arrancar). Cuenta gratis en
// sentry.io — ver DEPLOY.md.
const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  logger.warn("SENTRY_DSN no configurado: los errores no se reportan a Sentry.");
} else {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Trazas de performance con muestreo bajo: suficiente para detectar
    // endpoints lentos sin generar volumen que agote el plan gratuito.
    tracesSampleRate: 0.1,
  });
}

// Solo errores no operacionales (500 — bugs/fallos inesperados) llegan acá,
// ver errorHandler.js: los operacionales (400/404/etc.) son parte normal del
// flujo y no tiene sentido reportarlos como incidentes.
export function capturarError(err) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}

import pino from "pino";

// JSON estructurado siempre (para que un backend de logs como Render/Railway
// o algo tipo Loki lo pueda indexar), pero legible en la terminal durante
// desarrollo local vía pino-pretty. NODE_ENV=production evita el transport
// (pino-pretty es una devDependency, no viaja en la imagen de Docker).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
});

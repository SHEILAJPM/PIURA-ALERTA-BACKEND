import pg from "pg";
import dotenv from "dotenv";
import { logger } from "../src/lib/logger.js";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("Falta DATABASE_URL en el archivo .env");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon (y la mayoría de Postgres gestionados) usan certificados de una CA
  // pública, así que se puede validar el certificado normalmente. Si en algún
  // entorno local se necesita un Postgres con certificado autofirmado, exportar
  // NODE_TLS_REJECT_UNAUTHORIZED=0 en ese entorno puntual en vez de debilitar esto.
  ssl: { rejectUnauthorized: true },
  // Explícito (el default de `pg` es max:10 sin timeouts) para no agotar el
  // límite de conexiones del plan gratuito de Neon si el host de producción
  // llega a correr más de una instancia del backend.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Neon puede cortar una conexión ociosa desde su lado (ECONNRESET) en
// cualquier momento; sin este handler ese error no tiene listener y Node
// lo re-lanza como excepción no capturada, tumbando todo el proceso.
pool.on("error", (err) => {
  logger.error({ err }, "Error en una conexión ociosa del pool de Postgres");
});

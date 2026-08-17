import pg from "pg";
import dotenv from "dotenv";

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
});

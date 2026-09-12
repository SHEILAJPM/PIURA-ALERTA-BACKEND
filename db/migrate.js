import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

async function migrate() {
  const sql = readFileSync(schemaPath, "utf8");
  console.log(`Aplicando ${schemaPath}...`);
  await pool.query(sql);
  console.log("Esquema aplicado correctamente.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Error aplicando el esquema:", err.message);
  process.exitCode = 1;
});

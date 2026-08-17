import { pool } from "./pool.js";

// Sensor de prueba: Puente Bolognesi sobre el río Piura. Umbrales de ejemplo
// (10cm prealerta / 16cm alerta roja) tomados del mockup de UI del proyecto.
async function seed() {
  await pool.query(
    `INSERT INTO sensores (codigo, nombre, ubicacion, nivel_prealerta_cm, nivel_alerta_roja_cm)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
     ON CONFLICT (codigo) DO NOTHING`,
    ["RIO-PIURA-01", "Puente Bolognesi", -80.6328, -5.1945, 10, 16]
  );
  console.log("Sensor de prueba 'RIO-PIURA-01' listo.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Error insertando datos de prueba:", err.message);
  process.exitCode = 1;
});

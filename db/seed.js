import { pool } from "./pool.js";
import { hashearPassword } from "../src/services/auth.js";

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

  // Una cuenta de prueba por cada rol no público (el registro normal solo
  // crea 'ciudadano'): así se puede probar cada dashboard localmente sin
  // esperar a tener un panel de administrador que asigne roles.
  const cuentasDePrueba = [
    { nombre: "Operario Demo", correo: "operario@piuraalerta.pe", rol: "operario" },
    { nombre: "Defensa Civil Demo", correo: "defensacivil@piuraalerta.pe", rol: "defensa_civil" },
    { nombre: "Admin Demo", correo: "admin@piuraalerta.pe", rol: "administrador" },
  ];
  const passwordHash = await hashearPassword("demo1234");
  for (const { nombre, correo, rol } of cuentasDePrueba) {
    await pool.query(
      `INSERT INTO usuarios (nombre, correo, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (correo) DO UPDATE SET rol = EXCLUDED.rol`,
      [nombre, correo, passwordHash, rol]
    );
  }
  console.log("Cuentas de prueba listas (contraseña: demo1234).");

  await pool.end();
}

seed().catch((err) => {
  console.error("Error insertando datos de prueba:", err.message);
  process.exitCode = 1;
});

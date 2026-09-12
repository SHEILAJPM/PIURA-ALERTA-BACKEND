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

  // Albergues y zonas de riesgo: sin datos acá, el Mapa y el panel de
  // Albergues quedan siempre vacíos en cualquier demo. No tienen una columna
  // única para usar ON CONFLICT, así que en vez de eso se comprueba que la
  // tabla esté vacía antes de insertar (para poder correr `npm run db:seed`
  // de nuevo sin duplicar filas).
  const { rows: albergueCount } = await pool.query("SELECT count(*)::int FROM albergues");
  if (albergueCount[0].count === 0) {
    const albergues = [
      {
        nombre: "Coliseo Gerónimo Seminario",
        direccion: "Av. Grau s/n",
        capacidad: 500,
        ocupacion: 40,
        lon: -80.629,
        lat: -5.192,
      },
      {
        nombre: "I.E. San Miguel",
        direccion: "Jr. Ayacucho 400",
        capacidad: 200,
        ocupacion: 0,
        lon: -80.636,
        lat: -5.197,
      },
      {
        nombre: "Estadio Miguel Grau",
        direccion: "Av. Sánchez Cerro s/n",
        capacidad: 800,
        ocupacion: 120,
        lon: -80.625,
        lat: -5.188,
      },
      {
        nombre: "Complejo Deportivo Norte",
        direccion: "Urb. Piura Norte",
        capacidad: 300,
        ocupacion: 0,
        lon: -80.633,
        lat: -5.185,
      },
    ];
    for (const a of albergues) {
      await pool.query(
        `INSERT INTO albergues (nombre, direccion, capacidad, ocupacion_actual, ubicacion)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
        [a.nombre, a.direccion, a.capacidad, a.ocupacion, a.lon, a.lat]
      );
    }
    console.log(`${albergues.length} albergues de prueba listos.`);
  }

  const { rows: zonaCount } = await pool.query("SELECT count(*)::int FROM zonas_riesgo");
  if (zonaCount[0].count === 0) {
    const zonas = [
      {
        nombre: "Ribera del río - Puente Bolognesi",
        nivel: "alto",
        wkt: "MULTIPOLYGON(((-80.6345 -5.1925, -80.6310 -5.1925, -80.6310 -5.1965, -80.6345 -5.1965, -80.6345 -5.1925)))",
      },
      {
        nombre: "Piura Norte",
        nivel: "medio",
        wkt: "MULTIPOLYGON(((-80.6400 -5.1850, -80.6350 -5.1850, -80.6350 -5.1900, -80.6400 -5.1900, -80.6400 -5.1850)))",
      },
      {
        nombre: "Piura Sur",
        nivel: "bajo",
        wkt: "MULTIPOLYGON(((-80.6280 -5.2000, -80.6200 -5.2000, -80.6200 -5.2060, -80.6280 -5.2060, -80.6280 -5.2000)))",
      },
    ];
    for (const z of zonas) {
      await pool.query(
        `INSERT INTO zonas_riesgo (nombre, nivel_riesgo, geom)
         VALUES ($1, $2, ST_SetSRID(ST_GeomFromText($3), 4326))`,
        [z.nombre, z.nivel, z.wkt]
      );
    }
    console.log(`${zonas.length} zonas de riesgo de prueba listas.`);
  }

  await pool.end();
}

seed().catch((err) => {
  console.error("Error insertando datos de prueba:", err.message);
  process.exitCode = 1;
});

import "dotenv/config";
import autocannon from "autocannon";

// Prueba de carga manual (no corre en CI): apunta a una instancia YA
// corriendo del backend (`npm run dev` en otra terminal) y golpea los
// endpoints de lectura más frecuentes con tráfico concurrente, para tener una
// idea de cuántas requests/seg aguanta antes de tocar producción.
//
// Uso:
//   npm run dev            (en una terminal)
//   npm run loadtest        (en otra)
//
// Variables opcionales: LOADTEST_URL (default http://localhost:4000),
// LOADTEST_CONEXIONES (default 20), LOADTEST_DURACION_S (default 10).

const BASE_URL = process.env.LOADTEST_URL ?? "http://localhost:4000";
const CONEXIONES = Number(process.env.LOADTEST_CONEXIONES ?? 20);
const DURACION_S = Number(process.env.LOADTEST_DURACION_S ?? 10);

const ESCENARIOS = [
  { nombre: "GET /health", path: "/health" },
  { nombre: "GET /api/sensores", path: "/api/sensores" },
  { nombre: "GET /api/reportes-ciudadanos", path: "/api/reportes-ciudadanos?limite=30" },
  {
    nombre: "GET /api/lecturas/ultima",
    path: `/api/lecturas/ultima?sensor=${process.env.SIM_SENSOR_CODIGO ?? "RIO-PIURA-01"}`,
  },
];

async function verificarServidorArriba() {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`respondió ${res.status}`);
  } catch (err) {
    console.error(
      `\nNo se pudo conectar a ${BASE_URL}/health (${err.message}).\n` +
        `Levantá el backend primero en otra terminal con "npm run dev".\n`
    );
    process.exit(1);
  }
}

function resumen(resultado) {
  const { requests, latency, errors, timeouts, non2xx } = resultado;
  return {
    "req/seg (prom)": requests.average,
    "latencia p50 (ms)": latency.p50,
    "latencia p99 (ms)": latency.p99,
    errores: errors,
    timeouts,
    "no-2xx": non2xx,
  };
}

async function correrEscenario({ nombre, path }) {
  console.log(`\n▶ ${nombre} — ${CONEXIONES} conexiones concurrentes, ${DURACION_S}s`);
  const resultado = await autocannon({
    url: `${BASE_URL}${path}`,
    connections: CONEXIONES,
    duration: DURACION_S,
  });
  console.table(resumen(resultado));
  return resultado;
}

await verificarServidorArriba();
console.log(`Pruebas de carga contra ${BASE_URL} (${CONEXIONES} conexiones, ${DURACION_S}s por escenario)`);

for (const escenario of ESCENARIOS) {
  await correrEscenario(escenario);
}

console.log(
  "\nListo. Si algún escenario muestra errores/timeouts/no-2xx > 0, o la latencia p99 se dispara, " +
    "es la señal para revisar el pool de Postgres (db/pool.js), los rate limiters " +
    "(src/middleware/rateLimit.js) o el tamaño de instancia antes de desplegar a producción."
);

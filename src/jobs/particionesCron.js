import cron from "node-cron";
import { pool } from "../../db/pool.js";

// El esquema (db/schema.sql) crea particiones mensuales de `lecturas` para el
// mes actual + 2 siguientes al aplicar el schema, pero necesita que alguien
// siga llamando crear_particion_lecturas cada mes para que la partición del
// mes siguiente siempre exista. Antes había que hacerlo a mano; esto lo
// automatiza: corre una vez al iniciar el servidor y luego el día 1 de cada
// mes a las 00:05.
export function iniciarCronParticiones() {
  crearParticionFutura();
  cron.schedule("5 0 1 * *", crearParticionFutura);
}

async function crearParticionFutura() {
  try {
    await pool.query("SELECT crear_particion_lecturas((CURRENT_DATE + INTERVAL '2 months')::date)");
    console.log("[cron] partición de lecturas verificada/creada para dentro de 2 meses.");
  } catch (err) {
    console.error("[cron] error creando partición de lecturas:", err.message);
  }
}

import { pool } from "../../bd/pool.js";
import { obtenerEstadoSensores } from "./sensorEstado.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELO = "openai/gpt-oss-20b";
const TIMEOUT_MS = 10_000;

const ESTADO_LEGIBLE = { normal: "normal", prealerta: "prealerta", alerta_roja: "alerta roja" };

async function describirContextoEnVivo() {
  const [sensores, { rows: albergues }] = await Promise.all([
    obtenerEstadoSensores(),
    pool.query(
      `SELECT nombre, direccion, capacidad, ocupacion_actual
       FROM albergues WHERE activo = true ORDER BY nombre`
    ),
  ]);

  const lineasSensores = sensores.map((s) => {
    if (!s.ultima_lectura) return `- ${s.nombre}: sin lecturas todavía`;
    const estado = ESTADO_LEGIBLE[s.ultima_lectura.estado] ?? s.ultima_lectura.estado;
    const señal = s.en_linea ? "en línea" : "sin señal reciente";
    return `- ${s.nombre}: ${s.ultima_lectura.nivel_cm}cm, estado ${estado} (${señal})`;
  });

  const lineasAlbergues = albergues.map(
    (a) => `- ${a.nombre} (${a.direccion ?? "sin dirección registrada"}): ${a.ocupacion_actual}/${a.capacidad} ocupado`
  );

  return [
    "Estado actual de los sensores del río:",
    lineasSensores.length ? lineasSensores.join("\n") : "- No hay sensores registrados.",
    "",
    "Albergues disponibles:",
    lineasAlbergues.length ? lineasAlbergues.join("\n") : "- No hay albergues registrados.",
  ].join("\n");
}

function construirPromptSistema(contexto) {
  return `Eres el asistente virtual de Piura Alerta, un sistema ciudadano de monitoreo y alerta de inundaciones
del río Piura, Perú. Respondes en español, de forma breve, clara y cálida.

Ayudas con: qué hacer antes/durante/después de una crecida del río, cómo usar la app (reportar una
situación en /reportes, ver el mapa de riesgo en /mapa, contratar el seguro contra inundaciones en
/seguro, activar notificaciones), y con el estado real del río y los albergues usando el contexto de
abajo.

${contexto}

Reglas importantes:
- Si te preguntan algo fuera de este tema, dilo con amabilidad y redirige a lo que sí puedes ayudar.
- Nunca inventes datos de sensores/albergues que no estén en el contexto de arriba -- si no está ahí,
  di que no tienes ese dato en este momento.
- No das diagnósticos médicos ni asesoría legal. Ante una emergencia real en curso, indica llamar de
  inmediato al 116 (Bomberos) o 105 (Policía), no esperar a que la app confirme nada.
- Respuestas cortas (2-4 oraciones), sin markdown ni listas largas -- esto se muestra en un chat chico.`;
}

// A diferencia de moderacionIA.js (best-effort, nunca lanza), acá SÍ hay que
// avisarle a quien pregunta si algo falla -- un chat que responde "null" en
// silencio es peor experiencia que un error claro.
export async function responderPregunta({ pregunta, historial = [] }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const error = new Error("El asistente no está disponible en este momento");
    error.status = 503;
    throw error;
  }

  const contexto = await describirContextoEnVivo();
  const mensajes = [
    { role: "system", content: construirPromptSistema(contexto) },
    ...historial.flatMap((turno) => [
      { role: "user", content: turno.pregunta },
      { role: "assistant", content: turno.respuesta },
    ]),
    { role: "user", content: pregunta },
  ];

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.4,
        max_tokens: 400,
        messages: mensajes,
      }),
      signal: controlador.signal,
    });

    if (!respuesta.ok) {
      const error = new Error("El asistente no pudo responder, intenta de nuevo en un momento");
      error.status = 502;
      throw error;
    }

    const data = await respuesta.json();
    const texto = data.choices?.[0]?.message?.content?.trim();
    if (!texto) {
      const error = new Error("El asistente no pudo responder, intenta de nuevo en un momento");
      error.status = 502;
      throw error;
    }

    return texto;
  } catch (err) {
    if (err.status) throw err;
    const error = new Error("El asistente no pudo responder, intenta de nuevo en un momento");
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

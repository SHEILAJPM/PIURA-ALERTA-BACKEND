const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Modelo con visión (no solo texto): necesario para poder mirar la foto del
// reporte, no solo leer la descripción. Mismo modelo que asistente.js, para
// no depender de dos nombres distintos. Si Groq lo retira o renombra, esta
// función sigue fallando abierto (null) igual que cualquier otro error de
// red — nunca bloquea el reporte por una falla acá.
const MODELO = "openai/gpt-oss-20b";
const TIMEOUT_MS = 6000;

const PROMPT_SISTEMA = `Eres un filtro de contenido para un sistema ciudadano de alertas de inundaciones en Piura, Perú.
Vas a recibir la descripción de un reporte enviado por un vecino, y casi siempre también la foto que adjuntó.
Responde SOLO con JSON, sin texto adicional, con este formato exacto:
{"es_sospechoso": boolean, "fuera_de_tema": boolean, "motivo": string}.

fuera_de_tema=true SOLO cuando estés seguro de que la foto y/o el texto no tienen nada que ver con
inundaciones, el río, lluvias, daños de una crecida, u otro riesgo/emergencia urbana — por ejemplo una
selfie, comida, una mascota, un meme, publicidad, o cualquier foto claramente ajena al tema. Esto hace
que el reporte se archive automáticamente sin pasar por revisión humana, así que usalo solo cuando no
haya ninguna duda razonable.

es_sospechoso=true (con fuera_de_tema=false) para casos ambiguos: texto sin sentido, la foto no
coincide claramente con la descripción, calidad muy mala para distinguir algo, o dudas menores. Esto
NO oculta el reporte, solo lo marca para que un operador humano lo revise con prioridad más baja.

Si hay cualquier duda razonable de que podría ser un reporte real de inundación (aunque esté mal
escrito, la foto sea de mala calidad, o sea breve/informal), marca fuera_de_tema=false. Ante la duda,
NUNCA marques fuera_de_tema=true: es preferible que un operador humano revise un reporte de más a que
se oculte una emergencia real.`;

// Best-effort: nunca lanza ni bloquea al llamador. Si falta la API key, se
// agota el tiempo, o la respuesta no es el JSON esperado, devuelve null (=
// "no se pudo analizar"). La decisión de moderar sigue siendo humana salvo
// el caso fuera_de_tema=true, que archiva solo (ver POST /api/reportes-ciudadanos).
export async function analizarReporte({ descripcion, fotoUrl }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const contenido = [{ type: "text", text: descripcion.slice(0, 2000) }];
    if (fotoUrl) {
      contenido.push({ type: "image_url", image_url: { url: fotoUrl } });
    }

    const respuesta = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT_SISTEMA },
          { role: "user", content: contenido },
        ],
      }),
      signal: controlador.signal,
    });

    if (!respuesta.ok) return null;

    const data = await respuesta.json();
    const texto = data.choices?.[0]?.message?.content;
    if (!texto) return null;

    const parseado = JSON.parse(texto);
    if (typeof parseado.es_sospechoso !== "boolean" || typeof parseado.fuera_de_tema !== "boolean") {
      return null;
    }

    return {
      es_sospechoso: parseado.es_sospechoso,
      fuera_de_tema: parseado.fuera_de_tema,
      motivo: typeof parseado.motivo === "string" ? parseado.motivo.slice(0, 200) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

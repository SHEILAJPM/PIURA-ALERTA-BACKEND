const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELO = "openai/gpt-oss-20b";
const TIMEOUT_MS = 4000;

const PROMPT_SISTEMA = `Eres un filtro de spam para un sistema ciudadano de alertas de inundaciones en Piura, Perú.
Vas a recibir la descripción de un reporte enviado por un vecino. Responde SOLO con JSON, sin texto
adicional, con este formato exacto: {"es_sospechoso": boolean, "motivo": string}.

Marca es_sospechoso=true SOLO si el texto es claramente basura: caracteres aleatorios sin sentido
(ej. "asdf", "kjhgfd"), una palabra suelta sin contexto, spam publicitario, o contenido totalmente
ajeno a inundaciones/emergencias/riesgos urbanos.

Si hay cualquier duda razonable de que podría ser un reporte real (aunque esté mal escrito, sea breve
o informal), marca es_sospechoso=false. Ante la duda, NUNCA marques como sospechoso: es preferible que
un operador humano revise un reporte de más a que se oculte una emergencia real.`;

// Best-effort: nunca lanza ni bloquea al llamador. Si falta la API key, se
// agota el tiempo, o la respuesta no es el JSON esperado, devuelve null (=
// "no se pudo analizar"), NUNCA marca como sospechoso por error de la propia
// función. La decisión de moderar sigue siendo humana (ver panel de admin).
export async function analizarReporte(descripcion) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

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
        temperature: 0,
        max_tokens: 400,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT_SISTEMA },
          { role: "user", content: descripcion.slice(0, 2000) },
        ],
      }),
      signal: controlador.signal,
    });

    if (!respuesta.ok) return null;

    const data = await respuesta.json();
    const contenido = data.choices?.[0]?.message?.content;
    if (!contenido) return null;

    const parseado = JSON.parse(contenido);
    if (typeof parseado.es_sospechoso !== "boolean") return null;

    return {
      es_sospechoso: parseado.es_sospechoso,
      motivo: typeof parseado.motivo === "string" ? parseado.motivo.slice(0, 200) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

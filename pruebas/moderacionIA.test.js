import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarReporte } from "../src/servicios/moderacionIA.js";

function mockFetch(implementacion) {
  const original = global.fetch;
  global.fetch = implementacion;
  return () => {
    global.fetch = original;
  };
}

function respuestaGroq(contenidoJson, ok = true) {
  return async () => ({
    ok,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(contenidoJson) } }] }),
  });
}

test("analizarReporte: sin GROQ_API_KEY, no llama a fetch y devuelve null", async (t) => {
  const original = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  let llamado = false;
  const restaurar = mockFetch(async () => {
    llamado = true;
    throw new Error("no debería llamarse");
  });

  t.after(() => {
    restaurar();
    if (original !== undefined) process.env.GROQ_API_KEY = original;
  });

  const resultado = await analizarReporte({ descripcion: "cualquier cosa" });
  assert.equal(resultado, null);
  assert.equal(llamado, false);
});

test("analizarReporte: respuesta válida marca es_sospechoso, fuera_de_tema y motivo", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(
    respuestaGroq({ es_sospechoso: true, fuera_de_tema: false, motivo: "texto sin sentido" })
  );
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "asdf asdf" });
  assert.deepEqual(resultado, { es_sospechoso: true, fuera_de_tema: false, motivo: "texto sin sentido" });
});

test("analizarReporte: reporte legítimo devuelve fuera_de_tema=false", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(
    respuestaGroq({ es_sospechoso: false, fuera_de_tema: false, motivo: "reporte coherente" })
  );
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "Se inundó la calle Grau a la altura del mercado" });
  assert.equal(resultado.fuera_de_tema, false);
});

test("analizarReporte: foto de otro tema devuelve fuera_de_tema=true", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(
    respuestaGroq({ es_sospechoso: true, fuera_de_tema: true, motivo: "la foto es de comida, no del río" })
  );
  t.after(restaurar);

  const resultado = await analizarReporte({
    descripcion: "rico ceviche",
    fotoUrl: "https://example.com/foto.jpg",
  });
  assert.equal(resultado.fuera_de_tema, true);
});

test("analizarReporte: cuando hay fotoUrl, la manda como image_url en el mensaje a Groq", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  let cuerpoEnviado = null;
  const restaurar = mockFetch(async (_url, opciones) => {
    cuerpoEnviado = JSON.parse(opciones.body);
    return respuestaGroq({ es_sospechoso: false, fuera_de_tema: false, motivo: null })();
  });
  t.after(restaurar);

  await analizarReporte({ descripcion: "se inundó mi calle", fotoUrl: "https://example.com/foto.jpg" });

  const contenido = cuerpoEnviado.messages[1].content;
  assert.ok(Array.isArray(contenido));
  assert.ok(contenido.some((parte) => parte.type === "image_url" && parte.image_url.url === "https://example.com/foto.jpg"));
});

test("analizarReporte: si la API responde con error HTTP, falla abierto (null)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(respuestaGroq({}, false));
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "algo" });
  assert.equal(resultado, null);
});

test("analizarReporte: si la red falla (timeout/caída), falla abierto (null) sin lanzar", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => {
    throw new Error("network error");
  });
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "algo" });
  assert.equal(resultado, null);
});

test("analizarReporte: si el contenido no es JSON con el shape esperado, falla abierto (null)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "esto no es json" } }] }),
  }));
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "algo" });
  assert.equal(resultado, null);
});

test("analizarReporte: si falta fuera_de_tema en la respuesta, falla abierto (null)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(respuestaGroq({ es_sospechoso: false, motivo: "sin el campo nuevo" }));
  t.after(restaurar);

  const resultado = await analizarReporte({ descripcion: "algo" });
  assert.equal(resultado, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarReporte } from "../src/services/moderacionIA.js";

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

  const resultado = await analizarReporte("cualquier cosa");
  assert.equal(resultado, null);
  assert.equal(llamado, false);
});

test("analizarReporte: respuesta válida marca es_sospechoso y motivo", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(respuestaGroq({ es_sospechoso: true, motivo: "texto sin sentido" }));
  t.after(restaurar);

  const resultado = await analizarReporte("asdf asdf");
  assert.deepEqual(resultado, { es_sospechoso: true, motivo: "texto sin sentido" });
});

test("analizarReporte: reporte legítimo devuelve es_sospechoso=false", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(respuestaGroq({ es_sospechoso: false, motivo: "reporte coherente" }));
  t.after(restaurar);

  const resultado = await analizarReporte("Se inundó la calle Grau a la altura del mercado");
  assert.equal(resultado.es_sospechoso, false);
});

test("analizarReporte: si la API responde con error HTTP, falla abierto (null)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(respuestaGroq({}, false));
  t.after(restaurar);

  const resultado = await analizarReporte("algo");
  assert.equal(resultado, null);
});

test("analizarReporte: si la red falla (timeout/caída), falla abierto (null) sin lanzar", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => {
    throw new Error("network error");
  });
  t.after(restaurar);

  const resultado = await analizarReporte("algo");
  assert.equal(resultado, null);
});

test("analizarReporte: si el contenido no es JSON con el shape esperado, falla abierto (null)", async (t) => {
  process.env.GROQ_API_KEY = "clave-de-prueba";
  const restaurar = mockFetch(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "esto no es json" } }] }),
  }));
  t.after(restaurar);

  const resultado = await analizarReporte("algo");
  assert.equal(resultado, null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { enviarATodos } from "../src/services/webpush.js";

function suscripcion(endpoint) {
  return { endpoint, p256dh: "clave", auth: "secreto" };
}

test("enviarATodos: manda a todas las suscripciones si entran en una sola tanda", async () => {
  const llamados = [];
  const enviados = await enviarATodos([suscripcion("a"), suscripcion("b"), suscripcion("c")], "payload", {
    enviar: async (sub) => llamados.push(sub.endpoint),
    tamañoTanda: 25,
  });

  assert.equal(enviados, 3);
  assert.deepEqual(llamados.sort(), ["a", "b", "c"]);
});

test("enviarATodos: divide en varias tandas cuando hay más suscripciones que el tamaño de tanda", async () => {
  const suscripciones = Array.from({ length: 7 }, (_, i) => suscripcion(String(i)));
  const llamados = [];

  await enviarATodos(suscripciones, "payload", {
    enviar: async (sub) => llamados.push(sub.endpoint),
    tamañoTanda: 3,
  });

  assert.deepEqual(
    llamados.sort(),
    suscripciones.map((s) => s.endpoint)
  );
});

test("enviarATodos: un envío que falla con un error genérico no interrumpe el resto ni se cuenta como enviado", async () => {
  const enviados = await enviarATodos([suscripcion("a"), suscripcion("b"), suscripcion("c")], "payload", {
    enviar: async (sub) => {
      if (sub.endpoint === "b") throw new Error("push service no disponible");
    },
    tamañoTanda: 25,
  });

  assert.equal(enviados, 2);
});

test("enviarATodos: lista vacía no llama a enviar ni falla", async () => {
  let llamado = false;
  const enviados = await enviarATodos([], "payload", {
    enviar: async () => {
      llamado = true;
    },
  });

  assert.equal(enviados, 0);
  assert.equal(llamado, false);
});

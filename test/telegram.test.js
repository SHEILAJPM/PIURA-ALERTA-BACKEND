import { test } from "node:test";
import assert from "node:assert/strict";
import { enviarATodos } from "../src/services/telegram.js";

test("enviarATodos: manda a todos si entran en una sola tanda", async () => {
  const llamados = [];
  const enviados = await enviarATodos([1, 2, 3], "hola", {
    enviar: async (chatId) => llamados.push(chatId),
    tamañoTanda: 25,
    pausaMs: 0,
  });

  assert.equal(enviados, 3);
  assert.deepEqual(llamados.sort(), [1, 2, 3]);
});

test("enviarATodos: divide en varias tandas cuando hay más suscriptores que el tamaño de tanda", async () => {
  const chatIds = Array.from({ length: 7 }, (_, i) => i);
  const tandas = [];
  let tandaActual = [];

  await enviarATodos(chatIds, "hola", {
    enviar: async (chatId) => {
      tandaActual.push(chatId);
    },
    tamañoTanda: 3,
    pausaMs: 0,
  });

  // Con tamañoTanda=3 y 7 chatIds, deberían ser 3 tandas (3+3+1).
  for (let i = 0; i < chatIds.length; i += 3) tandas.push(chatIds.slice(i, i + 3));
  assert.deepEqual(tandas, [[0, 1, 2], [3, 4, 5], [6]]);
});

test("enviarATodos: un envío que falla no interrumpe el resto ni se cuenta como enviado", async () => {
  const enviados = await enviarATodos([1, 2, 3], "hola", {
    enviar: async (chatId) => {
      if (chatId === 2) throw new Error("chat bloqueó al bot");
    },
    tamañoTanda: 25,
    pausaMs: 0,
  });

  assert.equal(enviados, 2);
});

test("enviarATodos: lista vacía no llama a enviar ni falla", async () => {
  let llamado = false;
  const enviados = await enviarATodos([], "hola", {
    enviar: async () => {
      llamado = true;
    },
  });

  assert.equal(enviados, 0);
  assert.equal(llamado, false);
});

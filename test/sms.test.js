import { test } from "node:test";
import assert from "node:assert/strict";
import { enviarATodos, normalizarNumeroPeru } from "../src/services/sms.js";

test("normalizarNumeroPeru: acepta un celular peruano de 9 dígitos y le agrega +51", () => {
  assert.equal(normalizarNumeroPeru("987654321"), "+51987654321");
});

test("normalizarNumeroPeru: acepta un número ya en formato internacional", () => {
  assert.equal(normalizarNumeroPeru("+51987654321"), "+51987654321");
});

test("normalizarNumeroPeru: limpia espacios y guiones antes de validar", () => {
  assert.equal(normalizarNumeroPeru("987 654 321"), "+51987654321");
  assert.equal(normalizarNumeroPeru("987-654-321"), "+51987654321");
});

test("normalizarNumeroPeru: rechaza texto que no es un número de teléfono", () => {
  assert.equal(normalizarNumeroPeru("no tengo celular"), null);
  assert.equal(normalizarNumeroPeru("12345"), null);
});

test("enviarATodos: manda a todos si entran en una sola tanda", async () => {
  const llamados = [];
  const enviados = await enviarATodos(["+51987654321", "+51987654322"], "hola", {
    enviar: async (numero) => llamados.push(numero),
    tamañoTanda: 20,
  });

  assert.equal(enviados, 2);
  assert.deepEqual(llamados.sort(), ["+51987654321", "+51987654322"]);
});

test("enviarATodos: divide en varias tandas cuando hay más números que el tamaño de tanda", async () => {
  const numeros = Array.from({ length: 5 }, (_, i) => `+5198765432${i}`);
  const llamados = [];

  await enviarATodos(numeros, "hola", {
    enviar: async (numero) => llamados.push(numero),
    tamañoTanda: 2,
  });

  assert.deepEqual(llamados.sort(), [...numeros].sort());
});

test("enviarATodos: un envío que falla no interrumpe el resto ni se cuenta como enviado", async () => {
  const enviados = await enviarATodos(["+51987654321", "+51987654322", "+51987654323"], "hola", {
    enviar: async (numero) => {
      if (numero === "+51987654322") throw new Error("número inválido");
    },
    tamañoTanda: 20,
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

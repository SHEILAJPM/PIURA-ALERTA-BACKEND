import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEnLinea } from "../src/services/sensorEstado.js";

test("calcularEnLinea: sin lecturas nunca, no está en línea", () => {
  assert.equal(calcularEnLinea(null), false);
});

test("calcularEnLinea: última lectura hace 2 minutos, está en línea", () => {
  const ahora = new Date("2026-01-01T00:05:00Z");
  const ultimaLectura = new Date("2026-01-01T00:03:00Z");
  assert.equal(calcularEnLinea(ultimaLectura, ahora), true);
});

test("calcularEnLinea: última lectura hace 10 minutos, sin señal", () => {
  const ahora = new Date("2026-01-01T00:10:00Z");
  const ultimaLectura = new Date("2026-01-01T00:00:00Z");
  assert.equal(calcularEnLinea(ultimaLectura, ahora), false);
});

test("calcularEnLinea: justo en el umbral de 5 minutos, todavía en línea", () => {
  const ahora = new Date("2026-01-01T00:05:00Z");
  const ultimaLectura = new Date("2026-01-01T00:00:00Z");
  assert.equal(calcularEnLinea(ultimaLectura, ahora), true);
});

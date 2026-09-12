import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularEstado } from "../src/services/alertEngine.js";

test("calcularEstado: normal por debajo de prealerta", () => {
  assert.equal(calcularEstado(5, 10, 16), "normal");
});

test("calcularEstado: prealerta en el límite inferior", () => {
  assert.equal(calcularEstado(10, 10, 16), "prealerta");
});

test("calcularEstado: alerta_roja en el límite superior", () => {
  assert.equal(calcularEstado(16, 10, 16), "alerta_roja");
});

test("calcularEstado: alerta_roja por encima del umbral", () => {
  assert.equal(calcularEstado(25, 10, 16), "alerta_roja");
});

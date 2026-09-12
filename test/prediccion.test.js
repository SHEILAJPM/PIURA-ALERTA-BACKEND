import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularTendencia } from "../src/services/prediccion.js";

test("calcularTendencia: sin suficientes puntos no está disponible", () => {
  const resultado = calcularTendencia([{ x: 0, y: 5 }], 16);
  assert.equal(resultado.disponible, false);
});

test("calcularTendencia: nivel estable no está disponible", () => {
  const puntos = [
    { x: 0, y: 5 },
    { x: 1, y: 5 },
    { x: 2, y: 5 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, false);
  assert.equal(resultado.motivo, "El nivel no muestra tendencia de subida");
});

test("calcularTendencia: sube 1cm/min, calcula minutos hasta alerta roja", () => {
  const puntos = [
    { x: 0, y: 6 },
    { x: 1, y: 7 },
    { x: 2, y: 8 },
    { x: 3, y: 9 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.pendienteCmPorMin, 1);
  // nivel actual 9cm, umbral 16cm, pendiente 1cm/min -> 7 minutos
  assert.equal(resultado.minutosParaAlerta, 7);
});

test("calcularTendencia: si ya superó el umbral, minutos es 0 (no negativo)", () => {
  const puntos = [
    { x: 0, y: 10 },
    { x: 1, y: 20 },
  ];
  const resultado = calcularTendencia(puntos, 16);
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.minutosParaAlerta, 0);
});

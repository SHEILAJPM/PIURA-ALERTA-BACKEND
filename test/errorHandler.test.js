import { test } from "node:test";
import assert from "node:assert/strict";
import { manejadorErrores } from "../src/middleware/errorHandler.js";

function crearResFalso() {
  const res = { statusCode: null, body: null };
  res.status = (codigo) => {
    res.statusCode = codigo;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

test("manejadorErrores: preserva status y mensaje de errores operacionales", () => {
  const res = crearResFalso();
  const error = Object.assign(new Error("Sensor no existe"), { status: 404 });
  manejadorErrores(error, {}, res, () => {});
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Sensor no existe" });
});

test("manejadorErrores: enmascara errores inesperados con mensaje genérico", () => {
  const res = crearResFalso();
  const error = new Error("relation lecturas does not exist (detalle interno de SQL)");
  manejadorErrores(error, {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "Error interno del servidor" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashearPassword, verificarPassword, generarToken, verificarToken } from "../src/services/auth.js";

test("hashearPassword/verificarPassword: acepta la contraseña correcta", async () => {
  const hash = await hashearPassword("claveSegura123");
  assert.equal(await verificarPassword("claveSegura123", hash), true);
});

test("hashearPassword/verificarPassword: rechaza una contraseña incorrecta", async () => {
  const hash = await hashearPassword("claveSegura123");
  assert.equal(await verificarPassword("otraClave", hash), false);
});

test("generarToken/verificarToken: recupera el id, nombre y rol originales", () => {
  const token = generarToken({ id: "abc-123", nombre: "Sheila", rol: "administrador" });
  const payload = verificarToken(token);
  assert.equal(payload.id, "abc-123");
  assert.equal(payload.nombre, "Sheila");
  assert.equal(payload.rol, "administrador");
});

test("generarToken: sin rol explícito, usa 'ciudadano' por defecto", () => {
  const token = generarToken({ id: "abc-123", nombre: "Sheila" });
  const payload = verificarToken(token);
  assert.equal(payload.rol, "ciudadano");
});

test("verificarToken: rechaza un token adulterado", () => {
  const token = generarToken({ id: "abc-123", nombre: "Sheila" });
  const adulterado = token.slice(0, -2) + "xx";
  assert.throws(() => verificarToken(adulterado));
});

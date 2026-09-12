import { test } from "node:test";
import assert from "node:assert/strict";
import { requerirSesion, requerirRol, autenticacionOpcional } from "../src/middleware/auth.js";
import { generarToken } from "../src/services/auth.js";

function crearReqFalso(header) {
  return { get: (nombre) => (nombre.toLowerCase() === "authorization" ? header : undefined) };
}

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

test("requerirSesion: sin header Authorization responde 401", () => {
  const req = crearReqFalso(undefined);
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirSesion(req, res, () => (siguienteLlamado = true));
  assert.equal(res.statusCode, 401);
  assert.equal(siguienteLlamado, false);
});

test("requerirSesion: con token inválido responde 401", () => {
  const req = crearReqFalso("Bearer token-invalido");
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirSesion(req, res, () => (siguienteLlamado = true));
  assert.equal(res.statusCode, 401);
  assert.equal(siguienteLlamado, false);
});

test("requerirSesion: con token válido llama a next() y setea req.usuario", () => {
  const token = generarToken({ id: "u1", nombre: "Sheila" });
  const req = crearReqFalso(`Bearer ${token}`);
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirSesion(req, res, () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, true);
  assert.equal(req.usuario.id, "u1");
});

test("autenticacionOpcional: sin token sigue sin req.usuario", () => {
  const req = crearReqFalso(undefined);
  let siguienteLlamado = false;
  autenticacionOpcional(req, crearResFalso(), () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, true);
  assert.equal(req.usuario, undefined);
});

test("autenticacionOpcional: con token válido setea req.usuario", () => {
  const token = generarToken({ id: "u2", nombre: "Adrian" });
  const req = crearReqFalso(`Bearer ${token}`);
  let siguienteLlamado = false;
  autenticacionOpcional(req, crearResFalso(), () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, true);
  assert.equal(req.usuario.id, "u2");
});

test("requerirRol: usuario con el rol permitido llama a next()", () => {
  const req = { usuario: { id: "u1", rol: "administrador" } };
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirRol("administrador", "defensa_civil")(req, res, () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, true);
});

test("requerirRol: usuario con otro rol responde 403", () => {
  const req = { usuario: { id: "u1", rol: "ciudadano" } };
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirRol("administrador")(req, res, () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, false);
  assert.equal(res.statusCode, 403);
});

test("requerirRol: sin req.usuario (no pasó por requerirSesion) responde 403", () => {
  const req = {};
  const res = crearResFalso();
  let siguienteLlamado = false;
  requerirRol("administrador")(req, res, () => (siguienteLlamado = true));
  assert.equal(siguienteLlamado, false);
  assert.equal(res.statusCode, 403);
});

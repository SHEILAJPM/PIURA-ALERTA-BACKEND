import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lecturaSchema,
  albergueSchema,
  ocupacionSchema,
  reporteSchema,
  registroSchema,
  loginSchema,
  estadoReporteSchema,
  perfilSchema,
  olvidePasswordSchema,
  restablecerPasswordSchema,
} from "../src/validation/schemas.js";

test("lecturaSchema: acepta nivel_cm válido", () => {
  const resultado = lecturaSchema.safeParse({ nivel_cm: 12.5 });
  assert.equal(resultado.success, true);
});

test("lecturaSchema: rechaza nivel_cm negativo", () => {
  const resultado = lecturaSchema.safeParse({ nivel_cm: -1 });
  assert.equal(resultado.success, false);
});

test("lecturaSchema: rechaza nivel_cm absurdamente alto", () => {
  const resultado = lecturaSchema.safeParse({ nivel_cm: 999999 });
  assert.equal(resultado.success, false);
});

test("lecturaSchema: rechaza nivel_cm no numérico", () => {
  const resultado = lecturaSchema.safeParse({ nivel_cm: "12.5" });
  assert.equal(resultado.success, false);
});

test("albergueSchema: rechaza coordenadas fuera de rango", () => {
  const resultado = albergueSchema.safeParse({
    nombre: "Refugio X",
    capacidad: 50,
    lon: 200,
    lat: -5.19,
  });
  assert.equal(resultado.success, false);
});

test("albergueSchema: rechaza capacidad no positiva", () => {
  const resultado = albergueSchema.safeParse({
    nombre: "Refugio X",
    capacidad: 0,
    lon: -80.6,
    lat: -5.19,
  });
  assert.equal(resultado.success, false);
});

test("ocupacionSchema: rechaza valores negativos", () => {
  const resultado = ocupacionSchema.safeParse({ ocupacion_actual: -3 });
  assert.equal(resultado.success, false);
});

test("reporteSchema: requiere descripcion", () => {
  const resultado = reporteSchema.safeParse({ descripcion: "" });
  assert.equal(resultado.success, false);
});

test("reporteSchema: lon y lat deben ir juntos", () => {
  const resultado = reporteSchema.safeParse({ descripcion: "Calle inundada", lon: -80.6 });
  assert.equal(resultado.success, false);
});

test("reporteSchema: acepta reporte mínimo válido", () => {
  const resultado = reporteSchema.safeParse({ descripcion: "Calle inundada" });
  assert.equal(resultado.success, true);
});

test("reporteSchema: acepta autor_nombre para reportes anónimos (sin sesión)", () => {
  const resultado = reporteSchema.safeParse({ descripcion: "Calle inundada", autor_nombre: "Alguien" });
  assert.equal(resultado.success, true);
  assert.equal(resultado.data.autor_nombre, "Alguien");
});

const registroValido = {
  nombre: "Sheila Principe",
  dni: "12345678",
  correo: "sheila@example.com",
  password: "claveSegura123",
};

test("registroSchema: acepta un registro mínimo válido", () => {
  assert.equal(registroSchema.safeParse(registroValido).success, true);
});

test("registroSchema: dni es opcional (cuenta sin fricción)", () => {
  const { dni: _dni, ...sinDni } = registroValido;
  assert.equal(registroSchema.safeParse(sinDni).success, true);
});

test("registroSchema: rechaza dni con menos de 8 dígitos", () => {
  const resultado = registroSchema.safeParse({ ...registroValido, dni: "123" });
  assert.equal(resultado.success, false);
});

test("registroSchema: rechaza dni con letras", () => {
  const resultado = registroSchema.safeParse({ ...registroValido, dni: "1234abc8" });
  assert.equal(resultado.success, false);
});

test("registroSchema: rechaza correo inválido", () => {
  const resultado = registroSchema.safeParse({ ...registroValido, correo: "no-es-un-correo" });
  assert.equal(resultado.success, false);
});

test("registroSchema: rechaza contraseña muy corta", () => {
  const resultado = registroSchema.safeParse({ ...registroValido, password: "1234567" });
  assert.equal(resultado.success, false);
});

test("registroSchema: rechaza recibir_alertas_sms sin teléfono", () => {
  const resultado = registroSchema.safeParse({ ...registroValido, recibir_alertas_sms: true });
  assert.equal(resultado.success, false);
});

test("registroSchema: acepta recibir_alertas_sms cuando hay teléfono", () => {
  const resultado = registroSchema.safeParse({
    ...registroValido,
    telefono: "987654321",
    recibir_alertas_sms: true,
  });
  assert.equal(resultado.success, true);
});

test("loginSchema: acepta correo y password", () => {
  const resultado = loginSchema.safeParse({ correo: "sheila@example.com", password: "cualquiera" });
  assert.equal(resultado.success, true);
});

test("loginSchema: rechaza sin password", () => {
  const resultado = loginSchema.safeParse({ correo: "sheila@example.com", password: "" });
  assert.equal(resultado.success, false);
});

test("estadoReporteSchema: acepta los 3 estados válidos", () => {
  for (const estado of ["pendiente", "verificado", "descartado"]) {
    assert.equal(estadoReporteSchema.safeParse({ estado }).success, true);
  }
});

test("estadoReporteSchema: rechaza un estado fuera del enum", () => {
  const resultado = estadoReporteSchema.safeParse({ estado: "aprobado" });
  assert.equal(resultado.success, false);
});

test("perfilSchema: acepta sensor_interes_id como null (volver a 'todos los sensores')", () => {
  const resultado = perfilSchema.safeParse({ sensor_interes_id: null });
  assert.equal(resultado.success, true);
});

test("perfilSchema: acepta sensor_interes_id como un uuid válido", () => {
  const resultado = perfilSchema.safeParse({ sensor_interes_id: "8247e090-5971-4d57-b168-4a2b88e6aa04" });
  assert.equal(resultado.success, true);
});

test("perfilSchema: rechaza sensor_interes_id que no es un uuid", () => {
  const resultado = perfilSchema.safeParse({ sensor_interes_id: "no-es-un-uuid" });
  assert.equal(resultado.success, false);
});

test("olvidePasswordSchema: acepta un correo válido", () => {
  assert.equal(olvidePasswordSchema.safeParse({ correo: "sheila@example.com" }).success, true);
});

test("olvidePasswordSchema: rechaza un correo inválido", () => {
  assert.equal(olvidePasswordSchema.safeParse({ correo: "no-es-un-correo" }).success, false);
});

test("restablecerPasswordSchema: acepta token y contraseña nueva válidos", () => {
  const resultado = restablecerPasswordSchema.safeParse({ token: "abc123", passwordNueva: "claveSegura123" });
  assert.equal(resultado.success, true);
});

test("restablecerPasswordSchema: rechaza contraseña nueva muy corta", () => {
  const resultado = restablecerPasswordSchema.safeParse({ token: "abc123", passwordNueva: "1234567" });
  assert.equal(resultado.success, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { construirResumenImpacto } from "../src/servicios/resumenImpacto.js";

function entradaBase(cambios = {}) {
  return {
    usuariosPorRol: [
      { rol: "ciudadano", cantidad: 10 },
      { rol: "administrador", cantidad: 1 },
    ],
    suscriptoresTelegram: 5,
    suscriptoresPush: 3,
    alertasEnviadas: 7,
    reportesPorEstado: [
      { estado: "pendiente", cantidad: 4 },
      { estado: "verificado", cantidad: 2 },
    ],
    polizasVigentes: 6,
    chequeosUltimas24h: 8,
    ...cambios,
  };
}

test("construirResumenImpacto: suma usuarios_totales de todos los roles", () => {
  const resumen = construirResumenImpacto(entradaBase());
  assert.equal(resumen.usuarios_totales, 11);
});

test("construirResumenImpacto: agrupa usuarios_por_rol como objeto rol -> cantidad", () => {
  const resumen = construirResumenImpacto(entradaBase());
  assert.deepEqual(resumen.usuarios_por_rol, { ciudadano: 10, administrador: 1 });
});

test("construirResumenImpacto: suma reportes_totales de todos los estados", () => {
  const resumen = construirResumenImpacto(entradaBase());
  assert.equal(resumen.reportes_totales, 6);
});

test("construirResumenImpacto: agrupa reportes_por_estado como objeto estado -> cantidad", () => {
  const resumen = construirResumenImpacto(entradaBase());
  assert.deepEqual(resumen.reportes_por_estado, { pendiente: 4, verificado: 2 });
});

test("construirResumenImpacto: pasa de largo los contadores simples sin transformarlos", () => {
  const resumen = construirResumenImpacto(entradaBase());
  assert.equal(resumen.suscriptores_telegram, 5);
  assert.equal(resumen.suscriptores_push, 3);
  assert.equal(resumen.alertas_automaticas_enviadas, 7);
  assert.equal(resumen.polizas_vigentes, 6);
  assert.equal(resumen.chequeos_seguridad_ultimas_24h, 8);
});

test("construirResumenImpacto: sin usuarios ni reportes, los totales son 0 y los objetos vacíos", () => {
  const resumen = construirResumenImpacto(entradaBase({ usuariosPorRol: [], reportesPorEstado: [] }));
  assert.equal(resumen.usuarios_totales, 0);
  assert.deepEqual(resumen.usuarios_por_rol, {});
  assert.equal(resumen.reportes_totales, 0);
  assert.deepEqual(resumen.reportes_por_estado, {});
});

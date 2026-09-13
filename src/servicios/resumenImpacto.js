// Arma el JSON del panel de impacto (ver rutas/impacto.routes.js) a partir de
// las filas ya traídas de cada consulta -- separado del route handler para
// poder probar la agregación sin necesitar una base de datos real.
export function construirResumenImpacto({
  usuariosPorRol,
  suscriptoresTelegram,
  suscriptoresPush,
  alertasEnviadas,
  reportesPorEstado,
  polizasVigentes,
  chequeosUltimas24h,
}) {
  const usuariosPorRolObj = Object.fromEntries(usuariosPorRol.map((r) => [r.rol, r.cantidad]));
  const reportesPorEstadoObj = Object.fromEntries(reportesPorEstado.map((r) => [r.estado, r.cantidad]));

  return {
    usuarios_totales: usuariosPorRol.reduce((acc, r) => acc + r.cantidad, 0),
    usuarios_por_rol: usuariosPorRolObj,
    suscriptores_telegram: suscriptoresTelegram,
    suscriptores_push: suscriptoresPush,
    alertas_automaticas_enviadas: alertasEnviadas,
    reportes_totales: reportesPorEstado.reduce((acc, r) => acc + r.cantidad, 0),
    reportes_por_estado: reportesPorEstadoObj,
    polizas_vigentes: polizasVigentes,
    chequeos_seguridad_ultimas_24h: chequeosUltimas24h,
  };
}

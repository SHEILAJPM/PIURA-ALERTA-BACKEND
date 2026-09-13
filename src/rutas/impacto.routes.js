import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";

const router = Router();

// Resumen ejecutivo para mostrarle a Defensa Civil/la municipalidad: cuánta
// gente está cubierta por el sistema y cuánto se usó, en una sola pantalla.
// Todo son COUNT/MAX de tablas que ya existen -- no se agrega nada nuevo acá,
// solo se junta lo que ya se registra en cada función por separado.
router.get("/", requerirSesion, requerirRol("administrador"), async (_req, res, next) => {
  try {
    const [
      usuarios,
      telegram,
      push,
      alertasEnviadas,
      reportes,
      polizasVigentes,
      chequeosRecientes,
    ] = await Promise.all([
      pool.query("SELECT rol, count(*)::int AS cantidad FROM usuarios GROUP BY rol"),
      pool.query("SELECT count(*)::int AS cantidad FROM suscriptores_telegram WHERE activo = true"),
      pool.query("SELECT count(*)::int AS cantidad FROM push_subscriptions"),
      pool.query("SELECT count(*)::int AS cantidad FROM eventos_alerta WHERE notificado_telegram = true"),
      pool.query(
        `SELECT estado, count(*)::int AS cantidad FROM reportes_ciudadanos GROUP BY estado`
      ),
      pool.query("SELECT count(*)::int AS cantidad FROM polizas_seguro WHERE fecha_fin > now()"),
      pool.query(
        "SELECT count(DISTINCT usuario_id)::int AS cantidad FROM chequeos_seguridad WHERE creado_en > now() - interval '24 hours'"
      ),
    ]);

    const usuariosPorRol = Object.fromEntries(usuarios.rows.map((r) => [r.rol, r.cantidad]));
    const reportesPorEstado = Object.fromEntries(reportes.rows.map((r) => [r.estado, r.cantidad]));
    const totalUsuarios = usuarios.rows.reduce((acc, r) => acc + r.cantidad, 0);
    const totalReportes = reportes.rows.reduce((acc, r) => acc + r.cantidad, 0);

    res.json({
      usuarios_totales: totalUsuarios,
      usuarios_por_rol: usuariosPorRol,
      suscriptores_telegram: telegram.rows[0].cantidad,
      suscriptores_push: push.rows[0].cantidad,
      alertas_automaticas_enviadas: alertasEnviadas.rows[0].cantidad,
      reportes_totales: totalReportes,
      reportes_por_estado: reportesPorEstado,
      polizas_vigentes: polizasVigentes.rows[0].cantidad,
      chequeos_seguridad_ultimas_24h: chequeosRecientes.rows[0].cantidad,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

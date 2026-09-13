import { Router } from "express";
import { pool } from "../../bd/pool.js";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { construirResumenImpacto } from "../servicios/resumenImpacto.js";

const router = Router();

// Resumen ejecutivo para mostrarle a Defensa Civil/la municipalidad: cuánta
// gente está cubierta por el sistema y cuánto se usó, en una sola pantalla.
// Todo son COUNT/MAX de tablas que ya existen -- no se agrega nada nuevo acá,
// solo se junta lo que ya se registra en cada función por separado.
router.get("/", requerirSesion, requerirRol("administrador", "defensa_civil"), async (_req, res, next) => {
  try {
    const [usuarios, telegram, push, alertasEnviadas, reportes, polizasVigentes, chequeosRecientes] =
      await Promise.all([
        pool.query("SELECT rol, count(*)::int AS cantidad FROM usuarios GROUP BY rol"),
        pool.query("SELECT count(*)::int AS cantidad FROM suscriptores_telegram WHERE activo = true"),
        pool.query("SELECT count(*)::int AS cantidad FROM push_subscriptions"),
        pool.query("SELECT count(*)::int AS cantidad FROM eventos_alerta WHERE notificado_telegram = true"),
        pool.query(`SELECT estado, count(*)::int AS cantidad FROM reportes_ciudadanos GROUP BY estado`),
        pool.query("SELECT count(*)::int AS cantidad FROM polizas_seguro WHERE fecha_fin > now()"),
        pool.query(
          "SELECT count(DISTINCT usuario_id)::int AS cantidad FROM chequeos_seguridad WHERE creado_en > now() - interval '24 hours'"
        ),
      ]);

    res.json(
      construirResumenImpacto({
        usuariosPorRol: usuarios.rows,
        suscriptoresTelegram: telegram.rows[0].cantidad,
        suscriptoresPush: push.rows[0].cantidad,
        alertasEnviadas: alertasEnviadas.rows[0].cantidad,
        reportesPorEstado: reportes.rows,
        polizasVigentes: polizasVigentes.rows[0].cantidad,
        chequeosUltimas24h: chequeosRecientes.rows[0].cantidad,
      })
    );
  } catch (err) {
    next(err);
  }
});

export default router;

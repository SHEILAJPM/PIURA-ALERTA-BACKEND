import { Router } from "express";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { validarBody } from "../intermediarios/validate.js";
import { configuracionSchema } from "../validacion/schemas.js";
import { obtenerConfiguracion, actualizarConfiguracion } from "../servicios/configuracion.js";
import { registrarAccion } from "../servicios/auditoria.js";

const router = Router();

// Cualquier rol del panel operativo puede ver qué canales están prendidos
// (le sirve a Defensa Civil/operario saber si un aviso realmente pudo salir
// por SMS/email), pero solo administrador puede tocar el interruptor.
router.get(
  "/",
  requerirSesion,
  requerirRol("administrador", "operario", "defensa_civil"),
  async (_req, res, next) => {
    try {
      res.json(await obtenerConfiguracion());
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/",
  requerirSesion,
  requerirRol("administrador"),
  validarBody(configuracionSchema),
  async (req, res, next) => {
    try {
      const actualizada = await actualizarConfiguracion(req.body, req.usuario.id);
      await registrarAccion({
        usuario: req.usuario,
        accion: "configuracion_actualizada",
        detalle: Object.keys(req.body).join(", "),
      });
      res.json(actualizada);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

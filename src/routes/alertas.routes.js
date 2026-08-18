import { Router } from "express";
import { validarBody } from "../middleware/validate.js";
import { difusionSchema } from "../validation/schemas.js";
import { requerirSesion, requerirRol } from "../middleware/auth.js";
import { limitadorEscrituraPublica } from "../middleware/rateLimit.js";
import { enviarMensajeATodos } from "../services/telegram.js";
import { registrarAccion } from "../services/auditoria.js";

const router = Router();

// Difusión manual (a diferencia del aviso automático de alertEngine.js, que
// solo se dispara en un cambio de estado del río): exclusiva de Defensa
// Civil/COER y administrador -- operario no redacta avisos a la población.
router.post(
  "/difundir",
  requerirSesion,
  requerirRol("defensa_civil", "administrador"),
  limitadorEscrituraPublica,
  validarBody(difusionSchema),
  async (req, res, next) => {
    try {
      const { mensaje } = req.body;
      const resultado = await enviarMensajeATodos(`📣 AVISO DE DEFENSA CIVIL\n\n${mensaje}`);
      await registrarAccion({ usuario: req.usuario, accion: "difusion_manual", detalle: mensaje.slice(0, 200) });
      res.json({ enviado_a: resultado.enviados });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

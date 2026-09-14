import { Router } from "express";
import { requerirSesion, requerirRol } from "../intermediarios/auth.js";
import { validarBody } from "../intermediarios/validate.js";
import { limitadorEscrituraPublica } from "../intermediarios/rateLimit.js";
import { crearReclamoSeguroSchema, revisarReclamoSeguroSchema } from "../validacion/schemas.js";
import { TOPES_INDEMNIZACION_CENTAVOS } from "../servicios/pagos.js";
import { crearReclamo, listarReclamosUsuario, listarReclamosAdmin, revisarReclamo } from "../servicios/reclamosSeguro.js";

const router = Router();

router.get("/topes", (_req, res) => {
  res.json(TOPES_INDEMNIZACION_CENTAVOS);
});

router.post(
  "/",
  requerirSesion,
  limitadorEscrituraPublica,
  validarBody(crearReclamoSeguroSchema),
  async (req, res, next) => {
    try {
      const reclamo = await crearReclamo({ usuarioId: req.usuario.id, ...req.body });
      res.status(201).json(reclamo);
    } catch (err) {
      next(err);
    }
  }
);

router.get("/mios", requerirSesion, async (req, res, next) => {
  try {
    res.json(await listarReclamosUsuario(req.usuario.id));
  } catch (err) {
    next(err);
  }
});

// Panel admin: quién reclamó, por qué, y con qué monto se resolvió cada caso.
router.get("/", requerirSesion, requerirRol("administrador"), async (_req, res, next) => {
  try {
    res.json(await listarReclamosAdmin());
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/:id/estado",
  requerirSesion,
  requerirRol("administrador"),
  validarBody(revisarReclamoSeguroSchema),
  async (req, res, next) => {
    try {
      const reclamo = await revisarReclamo({ id: req.params.id, revisorId: req.usuario.id, ...req.body });
      res.json(reclamo);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

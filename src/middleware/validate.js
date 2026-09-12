// Valida req.body contra un schema de zod. Si pasa, reemplaza req.body por
// los datos ya parseados/limpiados (trim, coerción de tipos) para que las
// rutas no tengan que repetir esa lógica. Si falla, responde 400 con el
// primer problema encontrado (mensaje ya seguro para mostrar al cliente).
export function validarBody(schema) {
  return (req, res, next) => {
    const resultado = schema.safeParse(req.body);
    if (!resultado.success) {
      const primerProblema = resultado.error.issues[0];
      const campo = primerProblema.path.join(".");
      return res.status(400).json({
        error: campo ? `${campo}: ${primerProblema.message}` : primerProblema.message,
      });
    }
    req.body = resultado.data;
    next();
  };
}

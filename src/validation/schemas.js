import { z } from "zod";

// Coordenadas WGS84 válidas en cualquier parte del planeta (no se restringe a
// Piura para no acoplar la validación a una región fija).
const lon = z.number().finite().gte(-180).lte(180);
const lat = z.number().finite().gte(-90).lte(90);

export const lecturaSchema = z.object({
  sensor_codigo: z.string().trim().min(1).max(50).optional(),
  // 2000cm (20m) es un techo generoso para descartar valores absurdos/erróneos
  // sin acoplarse a los umbrales de un sensor en particular.
  nivel_cm: z.number().finite().gte(0).lte(2000),
});

export const albergueSchema = z.object({
  nombre: z.string().trim().min(1).max(150),
  direccion: z.string().trim().max(200).optional(),
  capacidad: z.number().int().positive(),
  lon,
  lat,
});

export const ocupacionSchema = z.object({
  ocupacion_actual: z.number().int().gte(0),
});

export const reporteSchema = z
  .object({
    // Solo se usa cuando el reporte es anónimo (sin sesión); si hay sesión, el
    // nombre sale de la cuenta y esto se ignora. Ver POST /api/reportes-ciudadanos.
    autor_nombre: z.string().trim().min(1).max(100).optional(),
    descripcion: z.string().trim().min(1).max(2000),
    foto_url: z.string().trim().url().max(2000).optional(),
    lon: lon.optional(),
    lat: lat.optional(),
  })
  .refine((datos) => (datos.lon === undefined) === (datos.lat === undefined), {
    message: "lon y lat deben enviarse juntos",
  });

// DNI peruano: 8 dígitos. Se valida como string (no número) para no perder
// ceros a la izquierda.
const dni = z
  .string()
  .trim()
  .regex(/^\d{8}$/, "debe tener 8 dígitos");

export const registroSchema = z.object({
  nombre: z.string().trim().min(1).max(100),
  dni: dni.optional(),
  telefono: z.string().trim().max(20).optional(),
  direccion: z.string().trim().max(200).optional(),
  correo: z.string().trim().toLowerCase().email().max(150),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  correo: z.string().trim().toLowerCase().email().max(150),
  password: z.string().min(1).max(200),
});

export const estadoReporteSchema = z.object({
  estado: z.enum(["pendiente", "verificado", "descartado"]),
});

export const rolSchema = z.object({
  rol: z.enum(["ciudadano", "operario", "defensa_civil", "administrador"]),
});

export const ticketSchema = z.object({
  sensor_id: z.string().uuid().optional(),
  titulo: z.string().trim().min(1).max(150),
  descripcion: z.string().trim().max(2000).optional(),
  prioridad: z.enum(["baja", "media", "alta"]).default("media"),
});

export const ticketEstadoSchema = z.object({
  estado: z.enum(["abierto", "en_progreso", "cerrado"]),
});

export const calibracionSchema = z
  .object({
    nivel_prealerta_cm: z.number().finite().gt(0).lte(2000),
    nivel_alerta_roja_cm: z.number().finite().gt(0).lte(2000),
  })
  .refine((datos) => datos.nivel_alerta_roja_cm > datos.nivel_prealerta_cm, {
    message: "debe ser mayor que nivel_prealerta_cm",
    path: ["nivel_alerta_roja_cm"],
  });

// codigo identifica al ESP32 físico (ej. "RIO-PIURA-02"): lo trae la placa al
// enviar sus lecturas (ver POST /api/lecturas), por eso debe ser único.
export const sensorSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[A-Za-z0-9._-]+$/, "solo letras, números, guiones y puntos"),
    nombre: z.string().trim().min(1).max(150),
    lon,
    lat,
    nivel_prealerta_cm: z.number().finite().gt(0).lte(2000),
    nivel_alerta_roja_cm: z.number().finite().gt(0).lte(2000),
  })
  .refine((datos) => datos.nivel_alerta_roja_cm > datos.nivel_prealerta_cm, {
    message: "debe ser mayor que nivel_prealerta_cm",
    path: ["nivel_alerta_roja_cm"],
  });

export const difusionSchema = z.object({
  mensaje: z.string().trim().min(1).max(1000),
});

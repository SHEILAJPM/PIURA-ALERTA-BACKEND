-- PIURA ALERTA — esquema de base de datos (PostgreSQL + PostGIS)
-- Aplicar con: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. NÚCLEO IoT: sensor -> lecturas -> eventos_alerta -> Telegram
-- ============================================================

CREATE TABLE IF NOT EXISTS sensores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) UNIQUE NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  ubicacion GEOMETRY(Point, 4326) NOT NULL,
  nivel_prealerta_cm NUMERIC(6,2) NOT NULL,
  nivel_alerta_roja_cm NUMERIC(6,2) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (nivel_alerta_roja_cm > nivel_prealerta_cm)
);

-- Lecturas del sensor: llegan cada pocos segundos -> tabla particionada
-- por mes sobre medido_en, para mantener las consultas rápidas y poder
-- archivar/borrar meses viejos sin bloquear la tabla completa.
CREATE TABLE IF NOT EXISTS lecturas (
  id BIGSERIAL,
  sensor_id UUID NOT NULL REFERENCES sensores(id),
  nivel_cm NUMERIC(6,2) NOT NULL,
  porcentaje NUMERIC(5,2) NOT NULL,
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('normal', 'prealerta', 'alerta_roja')),
  medido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, medido_en)
) PARTITION BY RANGE (medido_en);

-- Partición de respaldo: recibe cualquier fila fuera de los rangos
-- mensuales creados (evita que un insert falle si falta crear el mes).
CREATE TABLE IF NOT EXISTS lecturas_default PARTITION OF lecturas DEFAULT;

CREATE INDEX IF NOT EXISTS idx_lecturas_sensor_tiempo
  ON lecturas (sensor_id, medido_en DESC);

-- Crea (si no existe) la partición mensual de `lecturas` que contiene la fecha dada.
CREATE OR REPLACE FUNCTION crear_particion_lecturas(mes DATE)
RETURNS void AS $$
DECLARE
  inicio DATE := date_trunc('month', mes);
  fin DATE := inicio + INTERVAL '1 month';
  nombre_particion TEXT := 'lecturas_' || to_char(inicio, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF lecturas FOR VALUES FROM (%L) TO (%L)',
    nombre_particion, inicio, fin
  );
END;
$$ LANGUAGE plpgsql;

-- Bootstrap: partición del mes actual + 2 meses siguientes.
-- Ejecutar crear_particion_lecturas() de nuevo (ej. vía cron mensual)
-- para que siempre exista la partición del próximo mes.
SELECT crear_particion_lecturas(CURRENT_DATE);
SELECT crear_particion_lecturas((CURRENT_DATE + INTERVAL '1 month')::date);
SELECT crear_particion_lecturas((CURRENT_DATE + INTERVAL '2 month')::date);

-- Registra cada CAMBIO de estado (normal->prealerta->alerta_roja), no cada
-- lectura. Evita reenviar el mismo aviso de Telegram y da el historial de
-- episodios de crecida para el dashboard.
CREATE TABLE IF NOT EXISTS eventos_alerta (
  id BIGSERIAL PRIMARY KEY,
  sensor_id UUID NOT NULL REFERENCES sensores(id),
  estado_anterior VARCHAR(20),
  estado_nuevo VARCHAR(20) NOT NULL CHECK (estado_nuevo IN ('normal', 'prealerta', 'alerta_roja')),
  nivel_cm NUMERIC(6,2) NOT NULL,
  iniciado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  notificado_telegram BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_eventos_alerta_sensor_tiempo
  ON eventos_alerta (sensor_id, iniciado_en DESC);

CREATE TABLE IF NOT EXISTS suscriptores_telegram (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  nombre_usuario VARCHAR(100),
  activo BOOLEAN NOT NULL DEFAULT true,
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Suscripciones a notificaciones push del navegador (Web Push estándar, sin
-- cuenta: igual que Telegram, cualquier visitante puede suscribirse). endpoint
-- es único por dispositivo/navegador: lo asigna el push service del navegador
-- (FCM, Mozilla, etc.), p256dh/auth son las claves de cifrado de esa
-- suscripción particular. Ver src/services/webpush.js.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. USUARIOS: cuentas para publicar reportes y dar like
-- ============================================================

-- dni es opcional: la cuenta sirve para tener nombre fijo, historial y poder
-- dar like, no es obligatoria para participar (ver reportes_ciudadanos más
-- abajo, que admite reportes sin cuenta).
-- rol gobierna qué dashboard y qué endpoints puede usar cada cuenta (ver
-- requerirRol en src/middleware/auth.js). El registro público (POST
-- /api/auth/registro) siempre crea 'ciudadano'; los otros roles se asignan
-- a mano (ver db/seed.js) o, más adelante, desde el panel de administrador.
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  dni VARCHAR(15) UNIQUE,
  telefono VARCHAR(20),
  direccion VARCHAR(200),
  correo VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'ciudadano'
    CHECK (rol IN ('ciudadano', 'operario', 'defensa_civil', 'administrador')),
  -- Tener teléfono guardado no implica consentimiento para recibir SMS: es
  -- un opt-in aparte (ver PATCH /api/auth/yo), no una consecuencia automática
  -- de completar el campo. Ver src/services/sms.js.
  recibir_alertas_sms BOOLEAN NOT NULL DEFAULT false,
  -- NULL = le interesan las alertas de todos los sensores (default). Si se
  -- setea, el SMS solo se manda cuando cambia de estado ese sensor puntual.
  -- Ver notificarCambioEstadoSMS en src/services/sms.js.
  sensor_interes_id UUID REFERENCES sensores(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si esta tabla ya existía con dni NOT NULL de una revisión anterior.
ALTER TABLE usuarios ALTER COLUMN dni DROP NOT NULL;

-- Por si esta tabla ya existía de una revisión anterior sin la columna rol.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(20) NOT NULL DEFAULT 'ciudadano';
DO $$ BEGIN
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
    CHECK (rol IN ('ciudadano', 'operario', 'defensa_civil', 'administrador'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Por si esta tabla ya existía de una revisión anterior sin estas columnas.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS recibir_alertas_sms BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sensor_interes_id UUID REFERENCES sensores(id);

-- Token de un solo uso para restablecer contraseña (ver POST
-- /api/auth/olvide-password y /api/auth/restablecer-password). Se guarda el
-- hash del token, nunca el token en claro, igual que password_hash — si se
-- filtrara la tabla, no alcanzaría para restablecer ninguna cuenta.
CREATE TABLE IF NOT EXISTS restablecimientos_password (
  id BIGSERIAL PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restablecimientos_usuario ON restablecimientos_password (usuario_id);

-- ============================================================
-- 3. MÓDULOS CIUDADANOS: mapa GIS y reportes comunitarios
-- ============================================================

CREATE TABLE IF NOT EXISTS albergues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(150) NOT NULL,
  direccion VARCHAR(200),
  capacidad INT NOT NULL CHECK (capacidad > 0),
  ocupacion_actual INT NOT NULL DEFAULT 0 CHECK (ocupacion_actual >= 0),
  ubicacion GEOMETRY(Point, 4326) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_albergues_ubicacion
  ON albergues USING GIST (ubicacion);

CREATE TABLE IF NOT EXISTS zonas_riesgo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(150) NOT NULL,
  nivel_riesgo VARCHAR(20) NOT NULL CHECK (nivel_riesgo IN ('bajo', 'medio', 'alto')),
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zonas_riesgo_geom
  ON zonas_riesgo USING GIST (geom);

-- usuario_id es opcional: si el reporte lo publicó una cuenta, sale de ahí
-- (autor_nombre se ignora); si es anónimo, autor_nombre trae el nombre libre
-- (ver POST /api/reportes-ciudadanos en src/routes/reportes.routes.js).
CREATE TABLE IF NOT EXISTS reportes_ciudadanos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES usuarios(id),
  autor_nombre VARCHAR(100),
  descripcion TEXT NOT NULL,
  foto_url TEXT,
  ubicacion GEOMETRY(Point, 4326),
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'verificado', 'descartado')),
  likes_count INT NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si esta tabla ya existía de una revisión anterior donde usuario_id era
-- obligatorio y no existía autor_nombre.
ALTER TABLE reportes_ciudadanos ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE reportes_ciudadanos ADD COLUMN IF NOT EXISTS autor_nombre VARCHAR(100);

-- Clasificación best-effort (IA, ver src/services/moderacionIA.js): NULL =
-- todavía no se pudo analizar (sin API key, timeout, error), true/false =
-- resultado. Es solo una señal para priorizar en el panel de admin -- nunca
-- bloquea ni descarta un reporte por sí sola, la decisión la sigue tomando
-- una persona.
ALTER TABLE reportes_ciudadanos ADD COLUMN IF NOT EXISTS posible_spam BOOLEAN;
ALTER TABLE reportes_ciudadanos ADD COLUMN IF NOT EXISTS motivo_ia VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_reportes_ciudadanos_ubicacion
  ON reportes_ciudadanos USING GIST (ubicacion);

CREATE INDEX IF NOT EXISTS idx_reportes_ciudadanos_creado_en
  ON reportes_ciudadanos (creado_en DESC);

-- Likes: clave primaria compuesta evita que un mismo usuario le dé like dos
-- veces al mismo reporte. likes_count en reportes_ciudadanos queda como
-- contador denormalizado (se actualiza junto con el insert/delete acá, en la
-- misma transacción, ver src/routes/reportes.routes.js) para no tener que
-- hacer COUNT(*) sobre esta tabla en cada carga del feed.
CREATE TABLE IF NOT EXISTS reportes_likes (
  reporte_id UUID NOT NULL REFERENCES reportes_ciudadanos(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporte_id, usuario_id)
);

-- ============================================================
-- 4. PANEL OPERATIVO: auditoría y mantenimiento
-- ============================================================

-- Registro best-effort de acciones de escritura del panel (cambiar rol,
-- moderar un reporte, actualizar aforo, calibrar un sensor, difundir una
-- alerta manual). Ver src/services/auditoria.js -- nunca bloquea la acción
-- que audita si el insert falla.
CREATE TABLE IF NOT EXISTS auditoria_acciones (
  id BIGSERIAL PRIMARY KEY,
  usuario_id UUID REFERENCES usuarios(id),
  usuario_nombre VARCHAR(100) NOT NULL,
  accion VARCHAR(50) NOT NULL,
  detalle VARCHAR(300),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_acciones_creado_en
  ON auditoria_acciones (creado_en DESC);

CREATE TABLE IF NOT EXISTS tickets_mantenimiento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID REFERENCES sensores(id),
  titulo VARCHAR(150) NOT NULL,
  descripcion TEXT,
  prioridad VARCHAR(20) NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta')),
  estado VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_progreso', 'cerrado')),
  creado_por UUID REFERENCES usuarios(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_mantenimiento_estado
  ON tickets_mantenimiento (estado, creado_en DESC);

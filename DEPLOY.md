# Despliegue de PIURA ALERTA — Backend

Guía paso a paso para pasar de "corre en mi máquina" a producción. No la ejecuta
Claude Code por vos — necesita cuentas externas que solo el dueño del proyecto
puede crear (hosting, bot de Telegram, Cloudinary). Esto deja todo listo
(Dockerfile, health check, apagado ordenado, config de Render) para que el
`git push` final sea lo único que falte.

## 0. Cuentas externas necesarias

| Servicio                                                      | Para qué                                                                              | Costo                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------- |
| [Neon](https://neon.tech)                                     | Postgres + PostGIS (ya en uso, `DATABASE_URL` en `.env`)                              | Gratis               |
| [Render](https://render.com) o [Railway](https://railway.app) | Hostear este backend (API + WebSocket)                                                | Gratis (con límites) |
| [BotFather](https://t.me/BotFather) en Telegram               | `TELEGRAM_BOT_TOKEN` — mandale `/newbot`, elegí nombre y usuario, te da el token      | Gratis               |
| [Cloudinary](https://cloudinary.com)                          | Subida de fotos en reportes ciudadanos (lo usa el **frontend**, ver su propio DEPLOY) | Gratis               |
| [console.groq.com](https://console.groq.com)                  | `GROQ_API_KEY` — clasificación de spam en reportes (opcional, ya configurado)         | Gratis               |
| [Sentry](https://sentry.io)                                   | `SENTRY_DSN` — reporte de errores 500 en producción (opcional)                        | Gratis (con límites) |

## 1. Preparar la base de datos de producción

Si vas a usar la misma base de Neon que en desarrollo, no hay nada que hacer.
Si preferís una base separada para producción (recomendado si la de desarrollo
tiene datos de prueba):

1. Crear un proyecto nuevo en Neon, copiar su `DATABASE_URL`.
2. Aplicar el esquema y sembrar el sensor de prueba **apuntando a esa URL**:
   ```bash
   DATABASE_URL="postgresql://...prod..." npm run db:migrate
   DATABASE_URL="postgresql://...prod..." npm run db:seed
   ```
   Ambos scripts son idempotentes (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`),
   así que correrlos de nuevo en cada deploy no rompe nada ni duplica datos.

## 2. Desplegar en Render (recomendado — usa `render.yaml` ya incluido)

1. Subir este repo a GitHub (si no lo está ya).
2. En Render: **New > Blueprint**, conectar el repo. Render detecta [`render.yaml`](render.yaml)
   automáticamente y crea el servicio (`piura-alerta-backend`, Docker, plan free, health check en `/health`).
3. Completar en el dashboard de Render las env vars marcadas como secretas en `render.yaml`
   (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `CORS_ORIGIN`) — `JWT_SECRET` y
   `SENSOR_API_KEY` Render los genera solos (`generateValue: true`).
   - `CORS_ORIGIN` conviene dejarlo vacío en el primer deploy (acepta cualquier origen)
     y completarlo con la URL real del frontend una vez que esa también esté desplegada
     (ver paso 4).
4. Deploy. Render construye la imagen con el [`Dockerfile`](Dockerfile) incluido — no
   necesita ningún build command adicional.

### Alternativa manual (sin Blueprint / en Railway)

Si preferís crear el servicio a mano o usar Railway en vez de Render:

- **Build**: usa el `Dockerfile` del repo (ambas plataformas lo detectan solas).
- **Start command**: no hace falta, ya está en el `CMD` del Dockerfile (`node src/server.js`).
- **Puerto**: el proceso escucha en `process.env.PORT` — Render/Railway lo inyectan solos.
  No hace falta configurar nada aparte para el WebSocket: va sobre el mismo puerto/proceso
  (ver `src/services/websocket.js`), no hay un segundo puerto que exponer.
- **Health check path**: `/health`.
- Cargar a mano las mismas env vars que en `render.yaml`.

## 3. Verificar que quedó bien

```bash
curl https://<tu-servicio>.onrender.com/health
# {"estado":"ok","db":"conectada"}
```

Con `wscat` (`npm i -g wscat`) o el propio frontend ya desplegado, confirmar que el
WebSocket conecta: `wscat -c wss://<tu-servicio>.onrender.com`.

Probar el rate limit de login (debería devolver 429 después del intento 10 en 15 min):

```bash
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<tu-servicio>.onrender.com/api/auth/login \
  -H "Content-Type: application/json" -d '{"correo":"x@x.com","password":"incorrecta"}'; done
```

## 4. Conectar el frontend

Una vez desplegado, actualizar en el hosting del frontend (ver su propio `DEPLOY.md`
o `README`):

- `VITE_API_URL=https://<tu-servicio>.onrender.com`
- `VITE_WS_URL=wss://<tu-servicio>.onrender.com` (mismo host, esquema `wss` en vez de `ws`)

Y volver acá a completar `CORS_ORIGIN` con el dominio real del frontend (ej.
`https://piura-alerta.vercel.app`) — sin esto, el navegador bloquea las requests
del frontend en producción aunque el backend responda bien.

## 5. Reporte de errores con Sentry (opcional)

Sin esto, los errores 500 siguen quedando en los logs (`src/lib/logger.js`, JSON
estructurado), pero nadie se entera hasta que alguien los revisa a mano.

1. Crear una cuenta gratis en [sentry.io](https://sentry.io).
2. Crear un proyecto nuevo, plataforma **Node.js** (o Express).
3. Copiar el **DSN** que te muestra (algo como `https://xxxx@xxxx.ingest.sentry.io/xxxx`).
4. Completarlo como `SENTRY_DSN` en Render (o en tu `.env` local si querés probarlo antes).

Con eso activado, cualquier error 500 no controlado llega a Sentry con el stack
trace completo — ver `src/lib/sentry.js` y `src/middleware/errorHandler.js`.

## 6. Notas sobre el plan gratuito de Render

- Los servicios free "duermen" tras ~15 min sin tráfico y tardan unos segundos en
  despertar en la siguiente request — normal, no es un bug. Si el proyecto necesita
  estar siempre activo (demo en vivo), considerar el plan pago o un keep-alive externo.
- `db/pool.js` limita el pool a `max: 5` conexiones — a propósito, para no agotar el
  límite de conexiones simultáneas del plan gratuito de Neon si Render llega a correr
  más de una instancia.
- El apagado (`SIGTERM`) que Render manda en cada redeploy ya está manejado
  (`src/server.js`): cierra el WebSocket, detiene el cron y el bot de Telegram, y
  cierra el pool de Postgres antes de salir — no debería cortar requests a medias.

## 7. Pruebas de carga (antes de anunciar la URL pública)

```bash
npm run dev        # en una terminal
npm run loadtest    # en otra — ver scripts/loadtest.js
```

Corre tráfico concurrente contra `/health`, `/api/sensores`, `/api/reportes-ciudadanos`
y `/api/lecturas/ultima`. Si aparecen errores/timeouts o la latencia p99 se dispara,
revisar el pool de Postgres o el tamaño de instancia antes de desplegar.

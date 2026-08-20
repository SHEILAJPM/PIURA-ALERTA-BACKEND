# ⚙️ PIURA ALERTA — Backend API REST, WebSockets & Event Engine

## 👥 Integrantes

- **Sheila Jacqueline Principe Merino** — Lead Hardware IoT & Backend Engineer
- **Adrian Steven Juarez Panta** — Lead Frontend UI/UX & Structural Engineer

## 📝 Descripción

El **Backend de PIURA ALERTA** es el núcleo de procesamiento de eventos y orquestación del sistema.

Está desarrollado con **Node.js** y **Express.js** e integra comunicación serial con una placa **ESP32** para recibir las mediciones de los sensores.

El servidor permite:

- Recibir datos desde el ESP32.
- Procesar las mediciones.
- Guardar información histórica.
- Utilizar PostgreSQL + PostGIS.
- Ejecutar el algoritmo predictivo hidrológico.
- Transmitir datos mediante WebSockets.
- Enviar alertas mediante Telegram.

## 🏗️ Flujo de datos

```text
ESP32
  │
  ▼
Puerto Serial
  │
  ▼
SerialPort
  │
  ├──► PostgreSQL + PostGIS
  │
  ├──► Algoritmo Predictivo Hidrológico
  │
  ├──► WebSocket (mismo puerto que la API REST, vía upgrade)
  │       │
  │       ▼
  │    Frontend React
  │
  └──► Telegram API
          │
          ▼
      Alertas a usuarios
```

## 🛠️ Tecnologías

- **Node.js** — Entorno de ejecución.
- **Express.js** — API REST.
- **SerialPort** — Comunicación con ESP32.
- **PostgreSQL + PostGIS** — Base de datos y geolocalización.
- **WS (WebSocket)** — Comunicación en tiempo real.
- **Telegram Bot API** — Sistema de notificaciones.

## ⚙️ Configuración

Crear un archivo `.env`:

```env
PORT=4000
SERIAL_PORT=COM3
BAUD_RATE=115200

DATABASE_URL=postgresql://usuario:password@host/basededatos?sslmode=require

TELEGRAM_BOT_TOKEN=tu_token_de_botfather

CORS_ORIGIN=
SENSOR_API_KEY=
JWT_SECRET=
```

- `SERIAL_PORT` vacío desactiva la ingesta por puerto serie (útil mientras se prueba solo con `npm run simulate`).
- `CORS_ORIGIN` vacío acepta cualquier origen (cómodo en desarrollo). En producción, poner el dominio del frontend desplegado, separando varios con comas.
- `SENSOR_API_KEY` vacío deja `POST /api/lecturas` sin autenticar (solo recomendable en desarrollo local). Si se define, el ESP32/simulador debe mandarla en el header `x-api-key`.
- `JWT_SECRET` es **obligatorio**: el servidor no arranca sin él (falla rápido al iniciar, en vez de recién al primer login). Generar uno con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## 🗄️ Base de datos

El proyecto utiliza **PostgreSQL + PostGIS** (hosteado en [Neon](https://neon.tech)).
El esquema completo vive en [`db/schema.sql`](db/schema.sql) y se aplica con `npm run db:migrate`
(usa `pg` con SQL crudo — sin ORM — para tener control total sobre las consultas espaciales de PostGIS).

### Tablas

**Núcleo IoT** (sensor → lecturas → alertas → Telegram):

- `sensores` — un registro por ESP32 físico, con `ubicacion GEOMETRY(Point,4326)` y los umbrales `nivel_prealerta_cm` / `nivel_alerta_roja_cm`. Soporta múltiples sensores aunque hoy solo haya uno activo.
- `lecturas` — mediciones del sensor, **particionada por mes** sobre `medido_en` (llegan cada pocos segundos, así que en volumen se vuelve una tabla grande). La función `crear_particion_lecturas(mes)` crea la partición de un mes dado; `src/jobs/particionesCron.js` la llama automáticamente al iniciar el servidor y luego el día 1 de cada mes, para que siempre exista la partición siguiente. Incluye `lecturas_default` como respaldo si falta una partición.
- `eventos_alerta` — historial de _cambios_ de estado (normal → prealerta → alerta_roja), para no reenviar el mismo aviso de Telegram en cada lectura.
- `suscriptores_telegram` — chats suscritos a las alertas.

**Módulos ciudadanos** (mapa GIS y reportes):

- `albergues` — refugios con capacidad, ocupación actual y ubicación.
- `zonas_riesgo` — polígonos de riesgo de inundación (`GEOMETRY(MultiPolygon,4326)`).
- `usuarios` — cuentas opcionales (nombre, correo y contraseña obligatorios; DNI/teléfono/dirección opcionales, completables después). Sirven para tener nombre fijo, historial y poder dar like sin duplicarlo — **no** son necesarias para publicar un reporte. DNI/teléfono/dirección nunca se exponen en respuestas públicas, solo en `GET /api/auth/yo`.
- `reportes_ciudadanos` — feed comunitario con descripción, foto (subida a Cloudinary desde el frontend) y ubicación geolocalizada. Si lo publicó una cuenta, `usuario_id` la referencia; si es anónimo, el nombre queda en `autor_nombre` (texto libre, como antes de tener cuentas).
- `reportes_likes` — un like por `(reporte, usuario)`; `reportes_ciudadanos.likes_count` es un contador denormalizado que se actualiza en la misma transacción.

Las rutas de evacuación **no se almacenan**: se calculan en tiempo real combinando `sensores`, `albergues` y `zonas_riesgo` con un motor de ruteo externo.

## 📦 Instalación

Instalar las dependencias:

```bash
npm install
```

Copiar `.env.example` a `.env` y completar `DATABASE_URL` con la cadena de conexión de Neon (u otro Postgres con PostGIS habilitado).

Aplicar el esquema a la base de datos:

```bash
npm run db:migrate
```

Sembrar datos de prueba (necesario para poder probar la API y el frontend con
algo más que pantallas vacías): sensor `RIO-PIURA-01`, 4 albergues, 3 zonas de
riesgo, y una cuenta de cada rol operativo:

```bash
npm run db:seed
```

| Correo                        | Rol                  | Contraseña |
| ----------------------------- | -------------------- | ---------- |
| `operario@piuraalerta.pe`     | Operador técnico     | `demo1234` |
| `defensacivil@piuraalerta.pe` | Defensa Civil / COER | `demo1234` |
| `admin@piuraalerta.pe`        | Administrador        | `demo1234` |

(El registro público solo crea cuentas `ciudadano` — estas son para poder
entrar directo a cada dashboard del panel admin sin tener que asignar roles a mano.)

## 🚀 Ejecución

Ejecutar el servidor (API REST + WebSocket, ambos en `:4000` + bot de Telegram si hay token):

```bash
npm run dev      # con recarga automática (node --watch)
npm run start    # sin recarga
```

Mientras el **ESP32 no esté conectado por SerialPort**, se puede simular el flujo de
mediciones en otra terminal — envía lecturas por HTTP al mismo endpoint que usará el
hardware real, así se puede probar todo el pipeline (alertas, WebSocket, Telegram)
sin el sensor físico:

```bash
npm run simulate
```

Cuando el ESP32 sí está conectado (con `SERIAL_PORT` configurado en `.env`), el
servidor lee su puerto serie directamente (`src/services/serialIngest.js`) y no hace
falta el simulador. El firmware debe escribir **una línea por lectura**, ya sea un
número plano (`12.4\n`) o JSON (`{"nivel_cm":12.4}\n`).

## 🧪 Tests

```bash
npm test
```

Corre con el test runner nativo de Node (`node --test`, sin dependencias extra) sobre
la lógica pura: cálculo de estado del sensor, regresión de tendencia y validación de
inputs. No requiere base de datos.

## 📡 API REST

| Método | Ruta                                               | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                                          | Estado del servidor y conexión a la base de datos                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/api/sensores`                                    | Lista de sensores registrados                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/api/lecturas?sensor=&minutos=`                   | Histórico de lecturas (por defecto, últimos 180 min)                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/api/lecturas/ultima?sensor=`                     | Última lectura + predicción de tiempo estimado de crecida                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/api/lecturas` 🔒⏱                                | Registra una medición (`{ sensor_codigo, nivel_cm }`). La usa el simulador y la ingesta SerialPort del ESP32                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/albergues`                                   | Lista de albergues activos                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/api/albergues` ⏱                                 | Crea un albergue (`{ nombre, direccion, capacidad, lon, lat }`)                                                                                                                                                                                                                                                                                                                                                                                              |
| PATCH  | `/api/albergues/:id/ocupacion` ⏱                   | Actualiza la ocupación actual de un albergue                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/zonas-riesgo`                                | Polígonos de zonas de riesgo                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/reportes-ciudadanos?limite=&conFoto=&antes=` | Feed de reportes, más recientes primero (paginado por cursor: `antes=<creado_en del último recibido>` trae la página siguiente). `conFoto=true` filtra solo los que tienen foto (fila de "historias" del frontend). Si hay sesión, cada reporte incluye `te_gusta`. Con sesión de **operario** o **defensa_civil**, solo devuelve `pendiente` (lo verificado/descartado ya no es su responsabilidad); **administrador** y el feed público siguen viendo todo |
| POST   | `/api/reportes-ciudadanos` ⏱                       | Crea un reporte (`{ autor_nombre, descripcion, foto_url, lon, lat }`). No requiere sesión: si hay token, el autor sale de la cuenta y se ignora `autor_nombre`; si no, usa `autor_nombre` (o "Anónimo")                                                                                                                                                                                                                                                      |
| POST   | `/api/reportes-ciudadanos/:id/like` 🔑⏱            | Da/quita like (toggle) al reporte — esta sí requiere cuenta, para que no se pueda duplicar                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/api/auth/registro`                               | Crea una cuenta (`{ nombre, correo, password, dni?, telefono?, direccion?, recibir_alertas_sms? }`) -> `{ token, usuario }`. `recibir_alertas_sms` requiere `telefono`                                                                                                                                                                                                                                                                                       |
| POST   | `/api/auth/login` ⏱                                | `{ correo, password }` -> `{ token, usuario }` (máx. 10 intentos/15min por IP)                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/api/auth/yo` 🔑                                  | Perfil completo del usuario autenticado (único lugar que devuelve DNI/teléfono/dirección)                                                                                                                                                                                                                                                                                                                                                                    |
| PATCH  | `/api/auth/yo` 🔑                                  | Actualiza `{ nombre?, telefono?, direccion?, recibir_alertas_sms? }` del usuario autenticado (correo y DNI no se pueden cambiar; activar `recibir_alertas_sms` sin un teléfono guardado devuelve 400)                                                                                                                                                                                                                                                        |
| PATCH  | `/api/auth/contrasena` 🔑                          | Cambia la contraseña: `{ passwordActual, passwordNueva }` -> `204`                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/api/auth/olvide-password` ⏱                      | `{ correo }` -> manda un enlace de recuperación por correo (Resend) si la cuenta existe. Mismo mensaje siempre, para no revelar qué correos están registrados                                                                                                                                                                                                                                                                                                |
| POST   | `/api/auth/restablecer-password` ⏱                 | `{ token, passwordNueva }` -> `204`. El token sale del enlace del correo, expira en 1h y es de un solo uso                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/api/push/clave-publica`                          | Clave pública VAPID para suscribirse a notificaciones push (`null` si no está configurado)                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/api/push/suscribir` ⏱                            | Guarda una suscripción push del navegador (`{ endpoint, keys: { p256dh, auth } }`), sin sesión                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/api/push/desuscribir` ⏱                          | Borra una suscripción push (`{ endpoint }`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/api/alertas/historial?limite=`                   | Historial público de cambios de estado del río (más recientes primero), con sensor y nivel de cada cambio                                                                                                                                                                                                                                                                                                                                                    |

🔒 = requiere header `x-api-key` si `SENSOR_API_KEY` está configurado.
🔑 = requiere sesión (`Authorization: Bearer <token>` obtenido en `/api/auth/login` o `/api/auth/registro`).
⏱ = con rate limiting (además del límite general de 300 req/5min por IP en todo `/api`).

Todos los POST/PATCH validan el body con `zod` (`src/validation/schemas.js`) antes de tocar
la base de datos — rechazan tipos incorrectos, coordenadas fuera de rango, niveles
negativos o absurdamente altos, etc.

Cada `POST /api/lecturas` pasa por el **motor de alertas** (`src/services/alertEngine.js`):
inserta la lectura, calcula el `estado` según los umbrales del sensor y, si cambió respecto
al último `eventos_alerta`, transmite el cambio por WebSocket y notifica a los suscriptores
de Telegram activos.

## 🔌 Puertos

```text
API REST + WebSocket → 4000
Puerto ESP32         → COM3
Baud Rate            → 115200
```

## 🔗 Integración

```text
ESP32
  ↓
Backend Node.js
  ↓
PostgreSQL / PostGIS
  ↓
WebSocket
  ↓
Frontend React
```

El Backend funciona como intermediario entre el **hardware IoT**, la **base de datos**, el **Frontend** y el sistema de **alertas Telegram**.

## 🚢 Despliegue

Ver [`DEPLOY.md`](DEPLOY.md) para la guía completa (Docker, Render, variables de entorno y checklist de producción).

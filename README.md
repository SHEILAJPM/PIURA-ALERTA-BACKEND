# PIURA ALERTA — Backend

## Integrantes

- **Sheila Jacqueline Principe Merino** — Hardware IoT y Backend
- **Adrian Steven Juarez Panta** — Frontend UI/UX

## Qué es esto

Este es el backend de PIURA ALERTA, un sistema para avisar a la gente cuando el río puede desbordarse.

Está hecho con Node.js y Express. Recibe los datos de un sensor conectado a una placa ESP32, los guarda, calcula si hay riesgo de crecida y avisa por Telegram y por la web en tiempo real.

En resumen, el servidor se encarga de:

- Recibir los datos que manda el ESP32.
- Guardar el historial de mediciones.
- Calcular si el nivel del río está subiendo y qué tan rápido.
- Avisar por WebSocket a la página web cuando algo cambia.
- Mandar alertas por Telegram.

## Cómo viajan los datos

```text
ESP32
  │
  ▼
Puerto serial de la compu
  │
  ▼
El backend recibe el dato
  │
  ├──► Se guarda en la base de datos (PostgreSQL + PostGIS)
  │
  ├──► Se calcula si hay riesgo de crecida
  │
  ├──► Se manda por WebSocket a la página web
  │
  └──► Se manda una alerta por Telegram si hace falta
```

## Con qué está hecho

- **Node.js** — para correr el servidor.
- **Express.js** — para armar la API.
- **SerialPort** — para hablar con el ESP32 por cable.
- **PostgreSQL + PostGIS** — para guardar los datos y las ubicaciones en el mapa.
- **WebSocket (ws)** — para mandar avisos en tiempo real.
- **Telegram Bot API** — para las alertas por chat.

## Cómo configurarlo

Crear un archivo `.env` con esto adentro:

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

Algunas notas sobre esas variables:

- Si dejas `SERIAL_PORT` vacío, el servidor no intenta leer el puerto serial. Sirve para probar solo con `npm run simulate`, sin tener el sensor conectado.
- Si dejas `CORS_ORIGIN` vacío, acepta pedidos de cualquier lado (cómodo para probar en tu compu). En producción hay que poner el dominio del frontend.
- Si dejas `SENSOR_API_KEY` vacío, cualquiera puede mandar datos a `POST /api/lecturas` sin identificarse. Solo se recomienda dejarlo vacío mientras pruebas en tu compu.
- `JWT_SECRET` sí o sí tiene que tener un valor, porque el servidor no arranca sin él. Para generar uno, corres esto en la terminal:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## La base de datos

Usamos PostgreSQL con la extensión PostGIS (el servicio que usamos para hostearla es [Neon](https://neon.tech)).

Todo el esquema está en [`db/schema.sql`](db/schema.sql) y se aplica corriendo `npm run db:migrate`. No usamos ningún ORM, escribimos el SQL a mano para tener control total sobre las consultas de mapas.

### Las tablas principales

**Lo del sensor** (sensor → lecturas → alertas → Telegram):

- `sensores` — un registro por cada ESP32 físico, con su ubicación y los niveles que disparan cada alerta.
- `lecturas` — cada medición que manda el sensor. Como llegan cada pocos segundos, esta tabla crece rápido, así que está dividida por mes. Un script (`src/jobs/particionesCron.js`) se encarga de crear la partición del mes siguiente automáticamente.
- `eventos_alerta` — guarda cada vez que el estado del río cambia (normal → prealerta → alerta roja), para no mandar el mismo aviso de Telegram varias veces seguidas.
- `suscriptores_telegram` — la lista de chats que reciben las alertas.

**Lo de la parte ciudadana** (mapa y reportes):

- `albergues` — refugios, con su capacidad, cuánta gente tienen ahora y dónde quedan.
- `zonas_riesgo` — las zonas del mapa que pueden inundarse.
- `usuarios` — cuentas opcionales. Solo hacen falta nombre, correo y contraseña; el DNI, teléfono y dirección se pueden completar después. No hace falta tener cuenta para publicar un reporte, pero si quieres dar like sí.
- `reportes_ciudadanos` — el feed donde la gente cuenta lo que ve, con foto y ubicación.
- `reportes_likes` — quién le dio like a qué reporte.

Las rutas de evacuación no se guardan en ninguna tabla: se calculan al momento combinando sensores, albergues y zonas de riesgo.

## Instalación

Instalar las dependencias:

```bash
npm install
```

Copiar `.env.example` como `.env` y poner tu `DATABASE_URL` (la de Neon o cualquier Postgres con PostGIS).

Aplicar el esquema a la base de datos:

```bash
npm run db:migrate
```

Cargar datos de prueba, para no tener todo vacío mientras pruebas:

```bash
npm run db:seed
```

Esto crea un sensor, 4 albergues, 3 zonas de riesgo y una cuenta por cada rol:

| Correo                        | Rol                  | Contraseña |
| ------------------------------ | -------------------- | ---------- |
| `operario@piuraalerta.pe`     | Operador técnico     | `demo1234` |
| `defensacivil@piuraalerta.pe` | Defensa Civil / COER | `demo1234` |
| `admin@piuraalerta.pe`        | Administrador        | `demo1234` |

(El registro público solo crea cuentas de ciudadano. Estas otras cuentas son para poder entrar directo a cada panel sin tener que andar cambiando roles a mano.)

## Cómo correrlo

```bash
npm run dev      # se reinicia solo cuando cambias algo
npm run start    # sin reinicio automático
```

Esto levanta la API, el WebSocket (los dos en el puerto 4000) y el bot de Telegram si pusiste el token.

Si todavía no tienes el ESP32 conectado, puedes simular las mediciones desde otra terminal:

```bash
npm run simulate
```

Así puedes probar todo (alertas, WebSocket, Telegram) sin necesidad del sensor físico.

Cuando el ESP32 sí está conectado y configuraste `SERIAL_PORT`, el servidor lee directo del puerto serial y ya no hace falta el simulador. El ESP32 debe mandar una lectura por línea, ya sea un número (`12.4`) o un JSON (`{"nivel_cm":12.4}`).

## Pruebas

```bash
npm test
```

Corre con el test runner que ya trae Node, sin librerías extra. Prueba la lógica del cálculo de estado del sensor, la tendencia y las validaciones. No necesita base de datos para correr.

## La API

| Método | Ruta                                               | Qué hace                                                                                                          |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                                           | Dice si el servidor y la base de datos están funcionando                                                          |
| GET    | `/api/sensores`                                     | Lista de sensores registrados                                                                                     |
| GET    | `/api/lecturas?sensor=&minutos=`                    | Historial de mediciones (por defecto, últimos 180 minutos)                                                        |
| GET    | `/api/lecturas/ultima?sensor=`                      | Última medición y una predicción de cuánto puede tardar en crecer el río                                          |
| POST   | `/api/lecturas` 🔒⏱                                 | Registra una medición nueva. La usan el simulador y el ESP32                                                      |
| GET    | `/api/albergues`                                    | Lista de albergues activos                                                                                        |
| POST   | `/api/albergues` ⏱                                  | Crea un albergue nuevo                                                                                            |
| PATCH  | `/api/albergues/:id/ocupacion` ⏱                    | Actualiza cuánta gente hay en un albergue                                                                         |
| GET    | `/api/zonas-riesgo`                                 | Las zonas de riesgo para dibujar en el mapa                                                                       |
| GET    | `/api/reportes-ciudadanos?limite=&conFoto=&antes=`  | El feed de reportes, del más nuevo al más viejo                                                                   |
| POST   | `/api/reportes-ciudadanos` ⏱                        | Crea un reporte nuevo. No hace falta tener cuenta                                                                 |
| POST   | `/api/reportes-ciudadanos/:id/like` 🔑⏱             | Le da o le quita like a un reporte (sí necesita cuenta)                                                           |
| POST   | `/api/auth/registro`                                | Crea una cuenta nueva                                                                                              |
| POST   | `/api/auth/login` ⏱                                 | Inicia sesión (máximo 10 intentos cada 15 minutos por IP)                                                         |
| GET    | `/api/auth/yo` 🔑                                   | El perfil completo del usuario que inició sesión                                                                  |
| PATCH  | `/api/auth/yo` 🔑                                   | Actualiza los datos del usuario que inició sesión                                                                 |
| PATCH  | `/api/auth/contrasena` 🔑                           | Cambia la contraseña                                                                                               |
| POST   | `/api/auth/olvide-password` ⏱                       | Manda un correo para recuperar la contraseña, si la cuenta existe                                                 |
| POST   | `/api/auth/restablecer-password` ⏱                  | Cambia la contraseña usando el link del correo (dura 1 hora y se usa una sola vez)                                |
| GET    | `/api/push/clave-publica`                           | La clave para poder suscribirse a notificaciones push                                                             |
| POST   | `/api/push/suscribir` ⏱                             | Guarda una suscripción a notificaciones push                                                                      |
| POST   | `/api/push/desuscribir` ⏱                           | Borra una suscripción a notificaciones push                                                                       |
| GET    | `/api/alertas/historial?limite=`                    | El historial público de cambios de estado del río                                                                 |

- 🔒 = necesita el header `x-api-key` si configuraste `SENSOR_API_KEY`.
- 🔑 = necesita haber iniciado sesión.
- ⏱ = tiene límite de cuántas veces se puede llamar seguido.

Todos los POST y PATCH revisan que los datos vengan bien antes de tocar la base de datos (tipos correctos, coordenadas válidas, niveles que tengan sentido, etc).

Cada vez que llega una medición nueva, el servidor calcula el estado del río y, si cambió desde la última vez, avisa por WebSocket y por Telegram.

## Puertos que usa

```text
API + WebSocket → 4000
Puerto del ESP32 → COM3
Velocidad (baud rate) → 115200
```

## Cómo se conecta todo

```text
ESP32
  ↓
Backend (Node.js)
  ↓
Base de datos (PostgreSQL + PostGIS)
  ↓
WebSocket
  ↓
Frontend (React)
```

El backend es el que conecta el sensor, la base de datos, la página web y las alertas de Telegram.

## Cómo desplegarlo

La guía completa (Docker, Render, variables de entorno y checklist) está en [`DEPLOY.md`](DEPLOY.md).

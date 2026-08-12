# ⚙️ PIURA ALERTA — Backend API REST, WebSockets & Event Engine

## 👥 Integrantes

* **Sheila Jacqueline Principe Merino** — Lead Hardware IoT & Backend Engineer
* **Adrian Steven Juarez Panta** — Lead Frontend UI/UX & Structural Engineer

## 📝 Descripción

El **Backend de PIURA ALERTA** es el núcleo de procesamiento de eventos y orquestación del sistema.

Está desarrollado con **Node.js** y **Express.js** e integra comunicación serial con una placa **ESP32** para recibir las mediciones de los sensores.

El servidor permite:

* Recibir datos desde el ESP32.
* Procesar las mediciones.
* Guardar información histórica.
* Utilizar PostgreSQL + PostGIS.
* Ejecutar el algoritmo predictivo hidrológico.
* Transmitir datos mediante WebSockets.
* Enviar alertas mediante Telegram.

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
  ├──► WebSocket :8080
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

* **Node.js** — Entorno de ejecución.
* **Express.js** — API REST.
* **SerialPort** — Comunicación con ESP32.
* **PostgreSQL + PostGIS** — Base de datos y geolocalización.
* **WS (WebSocket)** — Comunicación en tiempo real.
* **Telegram Bot API** — Sistema de notificaciones.

## ⚙️ Configuración

Crear un archivo `.env`:

```env
PORT=4000
WS_PORT=8080
SERIAL_PORT=COM3
BAUD_RATE=115200

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=tu_password
DB_NAME=piura_alerta

TELEGRAM_BOT_TOKEN=tu_token_de_botfather
```

## 🗄️ Base de datos

El proyecto utiliza **PostgreSQL + PostGIS**.

### Tabla de suscriptores

```sql
CREATE TABLE suscriptores_telegram (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  nombre_usuario VARCHAR(100),
  fecha_registro TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabla de lecturas

```sql
CREATE TABLE lecturas (
  id BIGSERIAL PRIMARY KEY,
  sensor_id_code VARCHAR(50) NOT NULL,
  nivel_cm NUMERIC(5,2) NOT NULL,
  porcentaje NUMERIC(5,2) NOT NULL,
  estado VARCHAR(20) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
```

### Tabla de albergues

```sql
CREATE TABLE albergues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(150) NOT NULL,
  direccion VARCHAR(200),
  capacidad INT NOT NULL,
  ocupacion_actual INT DEFAULT 0,
  ubicacion GEOMETRY(Point, 4326)
);
```

## 📦 Instalación

Instalar las dependencias:

```bash
npm install
```

## 🚀 Ejecución

Ejecutar el servidor en modo desarrollo:

```bash
npm run dev
```

## 🔌 Puertos

```text
API REST       → 4000
WebSocket      → 8080
Puerto ESP32   → COM3
Baud Rate      → 115200
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

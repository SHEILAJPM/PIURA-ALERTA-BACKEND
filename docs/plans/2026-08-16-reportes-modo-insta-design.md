# Reportes ciudadanos "modo Insta" — diseño

Fecha: 2026-08-16
Estado: validado con el usuario, pendiente de implementar

## Objetivo

Convertir el reporte ciudadano anónimo actual (nombre libre + link de foto pegado)
en un flujo con cuentas de usuario reales, subida real de fotos, likes que no se
puedan duplicar, y una fila de "historias" tipo Instagram arriba del feed —
sin llegar a la paridad completa con Instagram (no hay comentarios, no hay
historias que expiren a las 24h, no hay carrusel de fotos por publicación).

## Decisiones tomadas

- **Login obligatorio para publicar o dar like.** Ver el feed sigue siendo público,
  sin necesidad de cuenta.
- **DNI obligatorio en el registro** (junto con nombre, teléfono, dirección,
  correo y contraseña), a pesar de que se advirtió que es un dato sensible bajo
  la Ley de Protección de Datos Personales de Perú. Por eso, DNI/teléfono/dirección
  **nunca** se exponen en respuestas públicas de la API — solo en `GET /api/auth/yo`
  (el propio usuario consultando su perfil).
- **Fotos en Cloudinary**, subidas directo desde el navegador (unsigned upload
  preset) — el backend nunca recibe el archivo, solo la URL resultante.
- **"Historias" no es una entidad nueva**: es una vista sobre los mismos
  `reportes_ciudadanos` (los últimos N que tengan foto), no una tabla con
  expiración a las 24h. Evita un job de limpieza y una tabla extra.

## 1. Modelo de datos

```sql
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(100) NOT NULL,
  dni VARCHAR(15) UNIQUE NOT NULL,
  telefono VARCHAR(20),
  direccion VARCHAR(200),
  correo VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- reportes_ciudadanos: se reemplaza autor_nombre (texto libre) por FK a usuarios.
ALTER TABLE reportes_ciudadanos DROP COLUMN autor_nombre;
ALTER TABLE reportes_ciudadanos ADD COLUMN usuario_id UUID NOT NULL REFERENCES usuarios(id);

CREATE TABLE reportes_likes (
  reporte_id UUID NOT NULL REFERENCES reportes_ciudadanos(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reporte_id, usuario_id)
);
```

`likes_count` en `reportes_ciudadanos` se mantiene como contador denormalizado
(se actualiza con un trigger o dentro de la misma transacción del like/unlike),
para no tener que hacer `COUNT(*)` sobre `reportes_likes` en cada carga del feed.

**Migración de datos existentes:** los reportes que ya existen (anónimos, sin
`usuario_id`) no tienen un usuario real al que asignarse. Como es una tabla de
demo/desarrollo sin usuarios reales todavía, la migración los **elimina** en vez
de inventar un usuario "sistema" — se documenta explícitamente en el script de
migración para que no sea una sorpresa.

## 2. Autenticación

- `bcrypt` para hashear `password_hash` (costo 10, estándar).
- `jsonwebtoken` para firmar un JWT en login/registro (`sub: usuario.id`,
  expira en 7 días). Se manda como `Authorization: Bearer <token>`.
- Middleware `requerirSesion` (nuevo, en `src/middleware/`) que valida el JWT,
  adjunta `req.usuario = { id, nombre }` y responde 401 si falta o es inválido.
  Se aplica a `POST /reportes-ciudadanos`, `POST /reportes-ciudadanos/:id/like`,
  `GET /auth/yo`.
- Validación con `zod` de `registroSchema` (nombre, dni, telefono opcional,
  direccion opcional, correo, password mín. 8 caracteres) y `loginSchema`
  (correo, password), siguiendo el mismo patrón que ya existe en
  `src/validation/schemas.js`.

### Endpoints nuevos

```
POST   /api/auth/registro       { nombre, dni, telefono?, direccion?, correo, password }
POST   /api/auth/login          { correo, password } -> { token, usuario }
GET    /api/auth/yo             (requiere sesión) -> perfil propio completo
POST   /api/reportes-ciudadanos/:id/like    (requiere sesión, toggle like/unlike)
```

### Endpoints que cambian

```
POST   /api/reportes-ciudadanos            ahora requiere sesión; usuario_id sale del token,
                                            ya no se acepta autor_nombre en el body
GET    /api/reportes-ciudadanos?conFoto=&limite=   nuevo query param conFoto=true
                                            para alimentar la fila de historias
```

Las respuestas de `GET /api/reportes-ciudadanos` incluyen `{ id, nombre }` del
autor (join contra `usuarios`), nunca DNI/teléfono/dirección/correo.

## 3. Frontend

- `AuthContext.jsx` (mismo patrón que `ThemeContext`/`WebSocketContext`):
  `usuario`, `token` en estado + `localStorage`, expone `login()`, `registro()`,
  `logout()`. Se monta en `App.jsx`.
- `lib/api.js`: `apiFetch` gana modo autenticado (header `Authorization` cuando
  hay token). Nuevas funciones `registrarUsuario`, `iniciarSesion`,
  `obtenerPerfil`, `darLike`.
- Páginas nuevas `Login.jsx` y `Registro.jsx` (rutas `/login`, `/registro`),
  mismo estilo visual que `ReportForm`.
- `Header.jsx`: "Iniciar sesión" si no hay sesión; nombre + "Cerrar sesión" si la hay.
- `Reportes.jsx`: `<StoriesBar />` nuevo arriba del feed (usa `useResource` +
  `conFoto=true&limite=15`, sin lógica nueva). Si no hay sesión, `<ReportForm>`
  se reemplaza por un aviso con link a `/login`; el feed en sí sigue visible sin
  sesión.
- `ReportCard.jsx`: botón de like (❤) que llama a `darLike`, refleja si el
  usuario actual ya dio like.
- `ReportForm.jsx`: el input de texto para pegar la URL de la foto se reemplaza
  por `<input type="file">` que sube directo a Cloudinary (unsigned upload
  preset) con preview y barra de progreso simple; el resto no cambia.

## 4. Manejo de errores

- Correo o DNI duplicado al registrar → 409 con mensaje claro (violación de
  `UNIQUE` capturada y traducida, no el error crudo de Postgres — sigue el
  mismo patrón que ya existe en `errorHandler.js`).
- Login con credenciales inválidas → 401 genérico ("correo o contraseña
  incorrectos"), sin decir cuál de los dos falló (evita enumeración de correos
  registrados).
- Token expirado o inválido en `requerirSesion` → 401, el frontend limpia la
  sesión local y redirige a `/login`.
- Subida a Cloudinary falla en el navegador → el formulario muestra el error
  y no permite enviar el reporte sin foto si el usuario ya intentó adjuntarla
  (evita perder la foto silenciosamente).

## 5. Testing

- Backend (`node --test`, sin DB): validación de `registroSchema`/`loginSchema`,
  lógica de hasheo/verificación de contraseña, generación/verificación de JWT
  con `jsonwebtoken` (mockeable sin DB), middleware `requerirSesion` con un
  token falso vs. uno válido (usando un `res`/`req` fake, mismo patrón que
  `test/errorHandler.test.js`).
- Frontend (`vitest`): `AuthContext` (login/logout actualiza el estado y
  `localStorage`), `StatusBadge`/`ReportCard` con distintos props de like,
  formularios de Login/Registro (validación de campos requeridos antes de
  enviar).

## Fuera de alcance (explícitamente descartado)

- Comentarios en publicaciones.
- Historias con expiración real a las 24h.
- Carrusel de varias fotos por publicación.
- Feed personalizado / "seguir" a otros usuarios.
- Recuperación de contraseña por correo (se puede agregar después; por ahora
  no hay envío de correos configurado en el proyecto).

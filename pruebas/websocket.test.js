import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { iniciarWebSocket, cerrarWebSocket, transmitir, transmitirRestringido } from "../src/servicios/websocket.js";
import { generarToken } from "../src/servicios/auth.js";

function levantarServidor() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Adjunta el listener de "message" desde la creación del socket (no después
// de esperar a "open") y encola lo que llegue, para no perder el saludo del
// servidor si llega antes de que el test pida leerlo con siguienteMensaje().
function conectar(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const cola = [];
    const pendientes = [];

    socket.on("message", (data) => {
      const mensaje = JSON.parse(data.toString());
      if (pendientes.length) pendientes.shift()(mensaje);
      else cola.push(mensaje);
    });

    socket.siguienteMensaje = () => {
      if (cola.length) return Promise.resolve(cola.shift());
      return new Promise((r) => pendientes.push(r));
    };

    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function esperarCierre(socket) {
  return new Promise((resolve) =>
    socket.once("close", (codigo, razon) => resolve({ codigo, razon: razon.toString() }))
  );
}

async function cerrarYEsperar(sockets) {
  await Promise.all(
    sockets.map((socket) => {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      const cerrado = new Promise((resolve) => socket.once("close", resolve));
      socket.close();
      return cerrado;
    })
  );
}

test("WebSocket: saluda, transmite, y corta la conexión 21 desde la misma IP (tope de 20)", async (t) => {
  const server = await levantarServidor();
  iniciarWebSocket(server);
  const { port } = server.address();

  const sockets = [];
  t.after(async () => {
    await cerrarYEsperar(sockets);
    await cerrarWebSocket();
    server.close();
  });

  const primero = await conectar(port);
  sockets.push(primero);

  const saludo = await primero.siguienteMensaje();
  assert.equal(saludo.tipo, "conectado");

  const recibido = primero.siguienteMensaje();
  transmitir("lectura", { nivel_cm: 12.3 });
  assert.deepEqual(await recibido, { tipo: "lectura", payload: { nivel_cm: 12.3 } });

  for (let i = sockets.length; i < 20; i++) {
    sockets.push(await conectar(port));
  }
  assert.equal(sockets.length, 20);

  const conexion21 = await conectar(port);
  const cierre = await esperarCierre(conexion21);
  assert.equal(cierre.codigo, 1013);
});

const SIN_MENSAJE = Symbol("sin-mensaje");
function esperarSinMensaje(socket, ms = 150) {
  return Promise.race([
    socket.siguienteMensaje(),
    new Promise((resolve) => setTimeout(() => resolve(SIN_MENSAJE), ms)),
  ]);
}

test("transmitirRestringido: solo llega a sockets autenticados con un rol permitido", async (t) => {
  const server = await levantarServidor();
  iniciarWebSocket(server);
  const { port } = server.address();

  const sockets = [];
  t.after(async () => {
    await cerrarYEsperar(sockets);
    await cerrarWebSocket();
    server.close();
  });

  const anonimo = await conectar(port);
  sockets.push(anonimo);
  await anonimo.siguienteMensaje(); // saludo "conectado"

  const ciudadano = await conectar(port);
  sockets.push(ciudadano);
  await ciudadano.siguienteMensaje();
  ciudadano.send(
    JSON.stringify({ tipo: "autenticar", payload: { token: generarToken({ id: "u1", rol: "ciudadano" }) } })
  );

  const admin = await conectar(port);
  sockets.push(admin);
  await admin.siguienteMensaje();
  admin.send(
    JSON.stringify({
      tipo: "autenticar",
      payload: { token: generarToken({ id: "u2", rol: "administrador" }) },
    })
  );

  const tokenInvalido = await conectar(port);
  sockets.push(tokenInvalido);
  await tokenInvalido.siguienteMensaje();
  tokenInvalido.send(JSON.stringify({ tipo: "autenticar", payload: { token: "no-es-un-jwt" } }));

  // Da tiempo a que el servidor procese los 3 mensajes "autenticar" antes de
  // transmitir, si no la aserción podría correr contra un rol todavía sin
  // setear del lado del servidor.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const recibidoAdmin = admin.siguienteMensaje();
  transmitirRestringido("alerta_sos", { id: "s1" }, ["administrador", "defensa_civil"]);

  assert.deepEqual(await recibidoAdmin, { tipo: "alerta_sos", payload: { id: "s1" } });
  assert.equal(await esperarSinMensaje(anonimo), SIN_MENSAJE);
  assert.equal(await esperarSinMensaje(ciudadano), SIN_MENSAJE);
  assert.equal(await esperarSinMensaje(tokenInvalido), SIN_MENSAJE);
});

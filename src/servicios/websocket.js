import { WebSocketServer } from "ws";
import { verificarToken } from "./auth.js";

let wss = null;

// Máximo de conexiones simultáneas por IP. El feed es de solo lectura (push
// de eventos, sin autenticación), así que la única defensa práctica contra
// agotar el servidor con miles de sockets abiertos es un tope por origen.
const MAX_CONEXIONES_POR_IP = 20;
const conexionesPorIp = new Map();

function ipDe(request) {
  return request.socket.remoteAddress ?? "desconocida";
}

// Recibe el servidor HTTP ya escuchando (server.js) y adjunta el WebSocket
// sobre el mismo puerto vía upgrade, en vez de abrir un puerto aparte: así el
// backend expone un solo puerto público, requisito de la mayoría de hosts
// (Render, Railway, Docker con un solo puerto mapeado).
// El único mensaje real que un cliente manda es {tipo:"autenticar", payload:
// {token}} (ver más abajo) y un JWT de esta app pesa unos cientos de bytes --
// 4KB deja margen de sobra sin dejar la puerta abierta a que una de las 20
// conexiones permitidas por IP mande frames gigantes para forzar JSON.parse
// sobre payloads enormes (antes de este mensaje "autenticar", nada leía los
// datos que mandaba un cliente, así que esta superficie no existía).
const TAMAÑO_MAXIMO_MENSAJE_BYTES = 4096;

export function iniciarWebSocket(server) {
  wss = new WebSocketServer({ server, maxPayload: TAMAÑO_MAXIMO_MENSAJE_BYTES });
  wss.on("connection", (socket, request) => {
    const ip = ipDe(request);
    const actuales = conexionesPorIp.get(ip) ?? 0;
    if (actuales >= MAX_CONEXIONES_POR_IP) {
      socket.close(1013, "Demasiadas conexiones desde este origen");
      return;
    }
    conexionesPorIp.set(ip, actuales + 1);
    socket.on("close", () => {
      const restantes = (conexionesPorIp.get(ip) ?? 1) - 1;
      if (restantes <= 0) conexionesPorIp.delete(ip);
      else conexionesPorIp.set(ip, restantes);
    });

    socket.send(JSON.stringify({ tipo: "conectado", payload: { mensaje: "Conectado a PIURA ALERTA" } }));

    // El feed en general es público y sin autenticación a propósito (nivel
    // del río, albergues, reportes) -- pero algunos eventos (ver
    // transmitirRestringido) traen datos sensibles y necesitan saber el rol
    // de quien está del otro lado. El cliente manda su token cada vez que
    // inicia sesión o cambia de cuenta (ver WebSocketContext.jsx); acá solo
    // se guarda el rol, nunca se responde nada que confirme si el token era
    // válido, para no convertir esto en un oráculo de tokens.
    socket.on("message", (data) => {
      try {
        const { tipo, payload } = JSON.parse(data);
        if (tipo !== "autenticar") return;
        socket.rol = payload?.token ? (verificarToken(payload.token).rol ?? null) : null;
      } catch {
        socket.rol = null;
      }
    });
  });
  return wss;
}

// rolesPermitidos = null/undefined => a todos los conectados (feed público:
// nivel del río, albergues, reportes). Un array => solo a sockets que se
// autenticaron con uno de esos roles (ver mensaje "autenticar" arriba) --
// para eventos con datos sensibles (ej. alerta_sos: ubicación exacta, nombre
// y teléfono de alguien en peligro) que no deberían salir por el mismo canal
// que el nivel del río. transmitir/transmitirRestringido comparten este loop
// para que un cambio en cómo se manda (manejo de errores, métricas, etc.) no
// tenga que hacerse dos veces.
function difundir(tipo, payload, rolesPermitidos) {
  if (!wss) return;
  const mensaje = JSON.stringify({ tipo, payload });
  wss.clients.forEach((cliente) => {
    if (cliente.readyState !== cliente.OPEN) return;
    if (rolesPermitidos && !rolesPermitidos.includes(cliente.rol)) return;
    cliente.send(mensaje);
  });
}

export function transmitir(tipo, payload) {
  difundir(tipo, payload, null);
}

export function transmitirRestringido(tipo, payload, rolesPermitidos) {
  difundir(tipo, payload, rolesPermitidos);
}

// Para el apagado ordenado (server.js): cierra todos los sockets y libera el puerto.
export function cerrarWebSocket() {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    wss.clients.forEach((cliente) => cliente.close(1001, "Servidor reiniciando"));
    wss.close(() => resolve());
  });
}

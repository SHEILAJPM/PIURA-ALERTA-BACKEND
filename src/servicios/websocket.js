import { WebSocketServer } from "ws";

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
export function iniciarWebSocket(server) {
  wss = new WebSocketServer({ server });
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
  });
  return wss;
}

export function transmitir(tipo, payload) {
  if (!wss) return;
  const mensaje = JSON.stringify({ tipo, payload });
  wss.clients.forEach((cliente) => {
    if (cliente.readyState === cliente.OPEN) {
      cliente.send(mensaje);
    }
  });
}

// Para el apagado ordenado (server.js): cierra todos los sockets y libera el puerto.
export function cerrarWebSocket() {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    wss.clients.forEach((cliente) => cliente.close(1001, "Servidor reiniciando"));
    wss.close(() => resolve());
  });
}

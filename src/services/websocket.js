import { WebSocketServer } from "ws";

let wss = null;

export function iniciarWebSocket(port) {
  wss = new WebSocketServer({ port });
  wss.on("connection", (socket) => {
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

FROM node:20-slim

WORKDIR /app

# Copiar solo los manifiestos primero para aprovechar la cache de Docker: si
# el código cambia pero las dependencias no, este paso no se repite.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# El host asigna PORT en runtime (Render/Railway); 4000 es el default local
# de src/server.js si no está definido. El WebSocket va sobre el mismo puerto
# (ver src/services/websocket.js), así que un solo EXPOSE alcanza.
EXPOSE 4000

# Usa /health (src/app.js) — ya valida la conexión a Postgres, no solo que el
# proceso esté vivo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 4000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]

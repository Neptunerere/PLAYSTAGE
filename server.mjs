import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

const dev = !process.argv.includes("--production");
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => handle(request, response));
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();

function roomClients(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
}

function broadcast(roomId, payload, exceptId) {
  for (const [id, client] of roomClients(roomId)) {
    if (id !== exceptId) send(client.socket, payload);
  }
}

wss.on("connection", (socket, request, clientInfo) => {
  const { id, roomId, role } = clientInfo;
  const clients = roomClients(roomId);
  clients.set(id, { socket, role });
  send(socket, { type: "welcome", id, roomId });

  if (role === "broadcaster")
    broadcast(roomId, { type: "broadcast-started", from: id }, id);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (["offer", "answer", "ice"].includes(message.type) && message.target) {
      const target = clients.get(message.target);
      if (target)
        send(target.socket, { ...message, from: id, target: undefined });
      return;
    }

    if (message.type === "viewer-ready") {
      const currentBroadcaster = [...clients].find(
        ([, client]) => client.role === "broadcaster",
      );
      if (currentBroadcaster)
        send(currentBroadcaster[1].socket, { type: "viewer-ready", from: id });
      return;
    }

    if (message.type === "chat") {
      const text = String(message.text || "")
        .trim()
        .slice(0, 300);
      if (!text) return;
      const name = String(
        message.name || (role === "broadcaster" ? "방송자" : "시청자"),
      )
        .trim()
        .slice(0, 24);
      const chat = {
        type: "chat",
        id: randomUUID(),
        name,
        text,
        sentAt: Date.now(),
      };
      broadcast(roomId, chat);
      return;
    }

    if (message.type === "mission-create") {
      const title = String(message.title || "")
        .trim()
        .slice(0, 80);
      if (!title) return;
      const mission = {
        id: randomUUID(),
        title,
        creator: String(message.name || "친구").slice(0, 24),
        status: "active",
        success: 0,
        fail: 0,
      };
      broadcast(roomId, { type: "mission", mission });
      return;
    }

    if (message.type === "mission-vote") {
      const vote =
        message.vote === "success"
          ? "success"
          : message.vote === "fail"
            ? "fail"
            : null;
      if (!vote || !message.missionId) return;
      broadcast(roomId, {
        type: "mission-vote",
        missionId: String(message.missionId),
        vote,
      });
      return;
    }

    if (message.type === "overlay") {
      const item = message.item || {};
      if (!["stroke", "ping", "emoji", "clear"].includes(item.kind)) return;
      const safeItem = { ...item, id: randomUUID(), createdAt: Date.now() };
      if (Array.isArray(safeItem.points))
        safeItem.points = safeItem.points
          .slice(0, 300)
          .map(([x, y]) => [
            Math.max(0, Math.min(1, Number(x))),
            Math.max(0, Math.min(1, Number(y))),
          ]);
      broadcast(roomId, { type: "overlay", item: safeItem });
    }
  });

  socket.on("close", () => {
    clients.delete(id);
    broadcast(roomId, { type: "peer-left", from: id, role });
    if (role === "broadcaster") broadcast(roomId, { type: "broadcast-ended" });
    if (clients.size === 0) rooms.delete(roomId);
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") return;
  const roomId = (url.searchParams.get("room") || "main").slice(0, 64);
  const role =
    url.searchParams.get("role") === "broadcaster" ? "broadcaster" : "viewer";
  wss.handleUpgrade(request, socket, head, (ws) =>
    wss.emit("connection", ws, request, { id: randomUUID(), roomId, role }),
  );
});

server.listen(port, hostname, () =>
  console.log(`PLAYSTAGE ready on http://localhost:${port}`),
);

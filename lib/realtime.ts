import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { WebSocket } from "ws";
import { redis } from "./redis";

type Client = { id: string; role: "broadcaster" | "viewer"; socket: WebSocket };
type Payload = Record<string, unknown> & { type: string; target?: string };

const clients = new Map<string, Client>();
const roomClients = new Map<string, Set<string>>();
const subscriptions = new Map<
  string,
  ReturnType<NonNullable<typeof redis>["duplicate"]>
>();
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

const channel = (room: string) => `playstage:room:${room}`;
const hostKey = (room: string) => `playstage:host:${room}`;

function localBroadcast(room: string, payload: Payload) {
  for (const id of roomClients.get(room) ?? []) {
    const client = clients.get(id);
    if (!client || (payload.target && payload.target !== id)) continue;
    if (client.socket.readyState === client.socket.OPEN)
      client.socket.send(JSON.stringify(payload));
  }
}

async function ensureSubscription(room: string) {
  if (!redis || subscriptions.has(room)) return;
  const subscriber = redis.duplicate();
  subscriptions.set(room, subscriber);
  subscriber.on("message", (_channel, raw) => {
    try {
      localBroadcast(room, JSON.parse(raw) as Payload);
    } catch {}
  });
  await subscriber.subscribe(channel(room));
}

async function publish(room: string, payload: Payload) {
  if (redis) await redis.publish(channel(room), JSON.stringify(payload));
  else localBroadcast(room, payload);
}

async function getRoomMissions(room: string) {
  if (!sql) return [];
  return sql.query(
    `select m.id, m.title, m.creator, m.status, m.success, m.fail
     from missions m inner join rooms r on r.id = m.room_id
     where r.code = $1 and m.status = 'active' order by m.created_at asc`,
    [room],
  );
}

async function deleteRoom(room: string) {
  if (sql) await sql.query("delete from rooms where code = $1", [room]);
}

export function registerRealtimeClient(
  socket: WebSocket,
  room: string,
  role: "broadcaster" | "viewer",
) {
  const id = randomUUID();
  clients.set(id, { id, role, socket });
  if (!roomClients.has(room)) roomClients.set(room, new Set());
  roomClients.get(room)!.add(id);
  void ensureSubscription(room);

  socket.send(JSON.stringify({ type: "welcome", id, roomId: room }));
  if (role === "broadcaster") {
    void redis?.set(hostKey(room), id, "EX", 30);
    void publish(room, { type: "broadcast-started", from: id });
  }

  const heartbeat = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    socket.ping();
    if (role === "broadcaster") void redis?.expire(hostKey(room), 30);
  }, 10_000);

  socket.on("message", (raw) => {
    void handleMessage(room, id, role, socket, raw.toString());
  });
  socket.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(id);
    roomClients.get(room)?.delete(id);
    void publish(room, { type: "peer-left", from: id, role });
    if (role === "broadcaster") {
      void publish(room, { type: "broadcast-reconnecting", graceMs: 8000 });
      setTimeout(async () => {
        const currentHost = await redis?.get(hostKey(room));
        if (currentHost && currentHost !== id) return;
        if (currentHost === id) await redis?.del(hostKey(room));
        await deleteRoom(room).catch((error) =>
          console.error("Failed to delete disconnected room", error),
        );
        await publish(room, {
          type: "room-closed",
          reason: "host-disconnected",
        });
      }, 8_000);
    }
  });
}

async function handleMessage(
  room: string,
  id: string,
  role: "broadcaster" | "viewer",
  socket: WebSocket,
  raw: string,
) {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  const type = String(message.type || "");
  if (["offer", "answer", "ice"].includes(type) && message.target) {
    await publish(room, { ...message, type, from: id } as Payload);
    return;
  }
  if (type === "room-info" && role === "broadcaster") {
    const title = String(message.title || "")
      .trim()
      .slice(0, 50);
    if (title) await publish(room, { type, title });
    return;
  }
  if (type === "viewer-ready") {
    socket.send(
      JSON.stringify({
        type: "missions-sync",
        missions: await getRoomMissions(room),
      }),
    );
    await publish(room, { type, from: id });
    return;
  }
  if (type === "chat") {
    const text = String(message.text || "")
      .trim()
      .slice(0, 300);
    if (!text) return;
    await publish(room, {
      type,
      id: randomUUID(),
      name: String(message.name || "친구")
        .trim()
        .slice(0, 24),
      text,
      sentAt: Date.now(),
    });
    return;
  }
  if (type === "mission-create" && sql) {
    const title = String(message.title || "")
      .trim()
      .slice(0, 80);
    if (!title) return;
    const [mission] = await sql.query(
      `insert into missions (room_id, title, creator)
       select id, $2, $3 from rooms where code = $1
       returning id, title, creator, status, success, fail`,
      [room, title, String(message.name || "친구").slice(0, 24)],
    );
    if (mission) await publish(room, { type: "mission", mission });
    return;
  }
  if (type === "mission-vote" && sql) {
    const column =
      message.vote === "success"
        ? "success"
        : message.vote === "fail"
          ? "fail"
          : null;
    if (!column || !message.missionId) return;
    const [mission] = await sql.query(
      `update missions m set ${column} = ${column} + 1 from rooms r
       where m.room_id = r.id and r.code = $1 and m.id = $2
       returning m.id, m.title, m.creator, m.status, m.success, m.fail`,
      [room, String(message.missionId)],
    );
    if (mission) await publish(room, { type: "mission-updated", mission });
    return;
  }
  if (type === "quality-request" && role === "viewer") {
    const quality = ["auto", "1080", "720", "480"].includes(
      String(message.quality),
    )
      ? String(message.quality)
      : "auto";
    await publish(room, { type, quality });
    return;
  }
  if (type === "overlay") {
    const source = (message.item ?? {}) as Record<string, unknown>;
    if (!["stroke", "ping", "emoji", "clear"].includes(String(source.kind)))
      return;
    const item = { ...source, id: randomUUID(), createdAt: Date.now() };
    await publish(room, { type, item });
  }
}

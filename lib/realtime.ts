import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { WebSocket } from "ws";
import { redis } from "./redis";
import {
  postMissionToDiscord,
  updateDiscordMissionMessage,
} from "./discord-bot";

type Client = {
  id: string;
  room: string;
  role: "broadcaster" | "viewer";
  socket: WebSocket;
  clientKey?: string;
  name?: string;
};
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
const presenceKey = (room: string) => `playstage:viewers:${room}`;
const appOrigin =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

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
    `select m.id, m.title, m.creator, m.creator_client_id as "creatorClientId",
            m.type, m.duration_seconds as "durationSeconds", m.started_at as "startedAt",
            m.ends_at as "endsAt", m.end_requested_at as "endRequestedAt",
            m.end_required_count as "endRequiredCount", m.status, m.success, m.fail,
            (select count(*)::int from mission_end_votes mev
              where mev.mission_id = m.id and mev.approved_at is not null) as "endApprovalCount"
     from missions m inner join rooms r on r.id = m.room_id
     where r.code = $1 and m.status = 'active' order by m.created_at asc`,
    [room],
  );
}

async function deleteStaleRoom(room: string) {
  if (!sql) return false;
  const deleted = await sql.query(
    `delete from rooms
      where code = $1 and status = 'live'
        and (host_heartbeat_at is null or host_heartbeat_at < now() - interval '30 seconds')
      returning id`,
    [room],
  );
  return deleted.length > 0;
}

export function registerRealtimeClient(
  socket: WebSocket,
  room: string,
  role: "broadcaster" | "viewer",
) {
  const id = randomUUID();
  clients.set(id, { id, room, role, socket });
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
    const client = clients.get(id);
    if (role === "viewer" && client?.clientKey)
      void redis?.zadd(presenceKey(room), Date.now(), client.clientKey);
  }, 10_000);

  socket.on("message", (raw) => {
    void handleMessage(room, id, role, socket, raw.toString());
  });
  socket.on("close", () => {
    clearInterval(heartbeat);
    const clientKey = clients.get(id)?.clientKey;
    if (clientKey) void redis?.zrem(presenceKey(room), clientKey);
    clients.delete(id);
    roomClients.get(room)?.delete(id);
    void publish(room, { type: "peer-left", from: id, role });
    if (role === "broadcaster") {
      void publish(room, { type: "broadcast-reconnecting", graceMs: 8000 });
      setTimeout(async () => {
        const currentHost = await redis?.get(hostKey(room));
        if (currentHost && currentHost !== id) return;
        if (currentHost === id) await redis?.del(hostKey(room));
        const deleted = await deleteStaleRoom(room).catch((error) => {
          console.error("Failed to delete disconnected room", error);
          return false;
        });
        if (!deleted) return;
        await publish(room, {
          type: "room-closed",
          reason: "host-disconnected",
        });
      }, 40_000);
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
  if (type === "missions-request" && role === "broadcaster") {
    socket.send(
      JSON.stringify({
        type: "missions-sync",
        missions: await getRoomMissions(room),
      }),
    );
    return;
  }
  if (type === "viewer-profile" && role === "viewer") {
    const name = String(message.name || "친구")
      .trim()
      .slice(0, 24);
    const clientKey = String(message.clientKey || "")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 64);
    const client = clients.get(id);
    if (clientKey && client) {
      client.clientKey = clientKey;
      client.name = name;
      await redis?.zadd(presenceKey(room), Date.now(), clientKey);
    }
    await publish(room, { type, from: id, name });
    return;
  }
  if (
    role === "broadcaster" &&
    ["screen-changed", "broadcast-paused", "broadcast-resumed"].includes(type)
  ) {
    await publish(room, { type, from: id });
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
    const naturalMinutes = Number(
      title.match(/(\d{1,4})\s*분\s*(?:안|내)/)?.[1] || 0,
    );
    const missionType =
      message.missionType === "time_attack" || naturalMinutes > 0
        ? "time_attack"
        : "normal";
    const durationSeconds =
      missionType === "time_attack"
        ? Math.min(
            86_400,
            Math.max(
              60,
              Number(message.durationSeconds) || naturalMinutes * 60 || 600,
            ),
          )
        : null;
    const creatorClientId = String(message.clientKey || "")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 64);
    const [mission] = await sql.query(
      `insert into missions
         (room_id, title, creator, creator_client_id, type, duration_seconds, ends_at)
       select id, $2, $3, $4, $5, $6,
              case when $6::int is null then null
                   else now() + ($6 * interval '1 second') end
         from rooms where code = $1
       returning id, title, creator, creator_client_id as "creatorClientId", type,
                 duration_seconds as "durationSeconds", started_at as "startedAt",
                 ends_at as "endsAt", end_requested_at as "endRequestedAt",
                 end_required_count as "endRequiredCount", 0 as "endApprovalCount",
                 status, success, fail`,
      [
        room,
        title,
        String(message.name || "친구").slice(0, 24),
        creatorClientId || null,
        missionType,
        durationSeconds,
      ],
    );
    if (mission) {
      await publish(room, { type: "mission", mission });
      void postMissionToDiscord(room, String(mission.id), appOrigin).catch(
        (error) => console.error("Failed to post Discord mission", error),
      );
    }
    return;
  }
  if (type === "mission-end-request" && sql && role === "viewer") {
    const missionId = String(message.missionId || "");
    const clientKey = String(message.clientKey || "")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 64);
    const [owned] = await sql.query(
      `select m.id from missions m join rooms r on r.id = m.room_id
        where m.id = $1 and r.code = $2 and m.status = 'active'
          and m.creator_client_id = $3 and m.end_requested_at is null`,
      [missionId, room, clientKey],
    );
    if (!owned) return;

    let eligible: Array<{ key: string; name: string }> = [];
    if (redis) {
      await redis.zremrangebyscore(presenceKey(room), 0, Date.now() - 30_000);
      const keys = await redis.zrangebyscore(
        presenceKey(room),
        Date.now() - 30_000,
        "+inf",
      );
      eligible = [...new Set(keys)]
        .filter((key) => key !== clientKey)
        .map((key) => ({ key, name: "친구" }));
    } else {
      eligible = [...clients.values()]
        .filter(
          (client) =>
            client.room === room &&
            client.role === "viewer" &&
            client.clientKey &&
            client.clientKey !== clientKey,
        )
        .map((client) => ({
          key: client.clientKey!,
          name: client.name || "친구",
        }));
      eligible = [
        ...new Map(eligible.map((item) => [item.key, item])).values(),
      ];
    }

    await sql.query(`delete from mission_end_votes where mission_id = $1`, [
      missionId,
    ]);
    for (const voter of eligible)
      await sql.query(
        `insert into mission_end_votes
           (mission_id, voter_client_id, voter_name)
         values ($1, $2, $3) on conflict do nothing`,
        [missionId, voter.key, voter.name],
      );

    const [mission] = await sql.query(
      `update missions
          set end_requested_at = now(), end_required_count = $2,
              status = case when $2 = 0 then 'completed' else status end
        where id = $1
       returning id, title, creator, creator_client_id as "creatorClientId", type,
                 duration_seconds as "durationSeconds", started_at as "startedAt",
                 ends_at as "endsAt", end_requested_at as "endRequestedAt",
                 end_required_count as "endRequiredCount", 0 as "endApprovalCount",
                 status, success, fail`,
      [missionId, eligible.length],
    );
    if (mission) {
      await publish(room, { type: "mission-updated", mission });
      void updateDiscordMissionMessage(missionId, appOrigin).catch(
        console.error,
      );
    }
    return;
  }
  if (type === "mission-end-approve" && sql && role === "viewer") {
    const missionId = String(message.missionId || "");
    const clientKey = String(message.clientKey || "")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 64);
    const [approved] = await sql.query(
      `update mission_end_votes set approved_at = coalesce(approved_at, now())
        where mission_id = $1 and voter_client_id = $2 returning mission_id`,
      [missionId, clientKey],
    );
    if (!approved) return;
    const [mission] = await sql.query(
      `update missions m set status = case
          when (select count(*) from mission_end_votes v
                 where v.mission_id = m.id and v.approved_at is not null)
               >= m.end_required_count
          then 'completed' else m.status end
        where m.id = $1
       returning m.id, m.title, m.creator,
                 m.creator_client_id as "creatorClientId", m.type,
                 m.duration_seconds as "durationSeconds", m.started_at as "startedAt",
                 m.ends_at as "endsAt", m.end_requested_at as "endRequestedAt",
                 m.end_required_count as "endRequiredCount",
                 (select count(*)::int from mission_end_votes v
                   where v.mission_id = m.id and v.approved_at is not null) as "endApprovalCount",
                 m.status, m.success, m.fail`,
      [missionId],
    );
    if (mission) {
      await publish(room, { type: "mission-updated", mission });
      void updateDiscordMissionMessage(missionId, appOrigin).catch(
        console.error,
      );
    }
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

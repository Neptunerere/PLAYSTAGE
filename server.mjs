import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const dev = !process.argv.includes("--production");
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((request, response) => handle(request, response));
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();
const roomTitles = new Map();
const hostDisconnectTimers = new Map();
const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;
const HOST_RECONNECT_GRACE_MS = 40_000;
const appOrigin = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}`;

function discordMissionPayload(mission) {
  const finished = mission.status !== "active";
  return {
    embeds: [
      {
        title: `🎯 ${mission.title}`,
        description: `${mission.status === "success" ? "✅ 성공 확정" : mission.status === "fail" ? "❌ 실패 확정" : "투표 진행 중"}\n제안자 **${mission.creator}** · 성공 시 **${mission.reward || 100}P**`,
        color: mission.status === "success" ? 0x21d79f : mission.status === "fail" ? 0xff4967 : 0x5865f2,
        fields: [
          { name: "✅ 성공", value: `${mission.success}표`, inline: true },
          { name: "❌ 실패", value: `${mission.fail}표`, inline: true },
        ],
        footer: { text: "3표를 먼저 얻은 결과로 확정됩니다 · 투표 참여 +5P" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "성공", custom_id: `mission_vote:success:${mission.id}`, disabled: finished },
          { type: 2, style: 4, label: "실패", custom_id: `mission_vote:fail:${mission.id}`, disabled: finished },
          { type: 2, style: 5, label: "웹에서 보기", url: `${appOrigin}/live?room=${mission.roomCode}` },
        ],
      },
    ],
  };
}

async function postMissionToDiscord(roomCode, missionId) {
  if (!sql || !process.env.DISCORD_BOT_TOKEN) return;
  const [mission] = await sql.query(
    `select m.id, m.title, m.creator, m.reward, m.status, m.success, m.fail,
            r.code as "roomCode", rd.channel_id as "channelId"
       from missions m join rooms r on r.id = m.room_id
       join room_discord rd on rd.room_id = r.id
      where r.code = $1 and m.id = $2`,
    [roomCode, missionId],
  );
  if (!mission) return;
  const response = await fetch(
    `https://discord.com/api/v10/channels/${mission.channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(discordMissionPayload(mission)),
    },
  );
  if (!response.ok) return;
  const message = await response.json();
  await sql.query(
    `update missions set discord_message_id = $2, discord_channel_id = $3 where id = $1`,
    [missionId, message.id, message.channel_id],
  );
}

async function updateDiscordMission(missionId) {
  if (!sql || !process.env.DISCORD_BOT_TOKEN) return;
  const [mission] = await sql.query(
    `select m.id, m.title, m.creator, m.reward, m.status, m.success, m.fail,
            m.discord_message_id as "messageId", m.discord_channel_id as "channelId",
            r.code as "roomCode" from missions m join rooms r on r.id = m.room_id
      where m.id = $1`,
    [missionId],
  );
  if (!mission?.messageId || !mission?.channelId) return;
  await fetch(
    `https://discord.com/api/v10/channels/${mission.channelId}/messages/${mission.messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(discordMissionPayload(mission)),
    },
  );
}

async function deleteRoomRecord(roomCode) {
  if (!sql) return false;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const deleted = await sql.query(
        `delete from rooms
          where code = $1 and status = 'live'
            and (host_heartbeat_at is null or host_heartbeat_at < now() - interval '30 seconds')
          returning id`,
        [roomCode],
      );
      return deleted.length > 0;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function cancelRoomClose(roomId) {
  const timer = hostDisconnectTimers.get(roomId);
  if (timer) clearTimeout(timer);
  hostDisconnectTimers.delete(roomId);
}

function scheduleRoomClose(roomId) {
  cancelRoomClose(roomId);
  const timer = setTimeout(async () => {
    hostDisconnectTimers.delete(roomId);
    const clients = rooms.get(roomId);
    const hostReconnected =
      clients && [...clients.values()].some((client) => client.role === "broadcaster");
    if (hostReconnected) return;

    try {
      const deleted = await deleteRoomRecord(roomId);
      if (!deleted) return;
    } catch (error) {
      console.error("Failed to delete disconnected host room", error);
    }

    if (clients) {
      broadcast(roomId, { type: "room-closed", reason: "host-disconnected" });
      setTimeout(() => {
        for (const client of clients.values()) client.socket.close(1000, "room closed");
      }, 100);
    }
    rooms.delete(roomId);
    roomTitles.delete(roomId);
  }, HOST_RECONNECT_GRACE_MS);
  hostDisconnectTimers.set(roomId, timer);
}

async function getRoomMissions(roomCode) {
  if (!sql) return [];
  return sql.query(
    `select m.id, m.title, m.creator, m.status, m.success, m.fail
     from missions m
     inner join rooms r on r.id = m.room_id
     where r.code = $1 and m.status = 'active'
     order by m.created_at asc`,
    [roomCode],
  );
}

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
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });
  send(socket, { type: "welcome", id, roomId });

  if (role === "broadcaster") {
    cancelRoomClose(roomId);
    broadcast(roomId, { type: "broadcast-started", from: id }, id);
  }

  socket.on("message", async (raw) => {
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

    if (message.type === "room-info" && role === "broadcaster") {
      const title = String(message.title || "")
        .trim()
        .slice(0, 50);
      if (!title) return;
      roomTitles.set(roomId, title);
      broadcast(roomId, { type: "room-info", title });
      return;
    }

    if (message.type === "viewer-ready") {
      try {
        const missions = await getRoomMissions(roomId);
        send(socket, { type: "missions-sync", missions });
      } catch (error) {
        console.error("Failed to load missions", error);
        send(socket, { type: "mission-error" });
      }
      const title = roomTitles.get(roomId);
      if (title) send(socket, { type: "room-info", title });
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
      if (!sql) return;
      const creator = String(message.name || "친구").slice(0, 24);
      try {
        const [mission] = await sql.query(
          `insert into missions (room_id, title, creator)
           select id, $2, $3 from rooms where code = $1
           returning id, title, creator, status, success, fail`,
          [roomId, title, creator],
        );
        if (mission) {
          broadcast(roomId, { type: "mission", mission });
          void postMissionToDiscord(roomId, mission.id).catch((error) =>
            console.error("Failed to post Discord mission", error),
          );
        }
      } catch (error) {
        console.error("Failed to create mission", error);
        send(socket, { type: "mission-error" });
      }
      return;
    }

    if (message.type === "quality-request" && role === "viewer") {
      const quality = ["auto", "1080", "720", "480"].includes(message.quality)
        ? message.quality
        : "auto";
      for (const client of clients.values()) {
        if (client.role === "broadcaster")
          send(client.socket, { type: "quality-request", quality });
      }
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
    if (role === "broadcaster") {
      broadcast(roomId, {
        type: "broadcast-reconnecting",
        graceMs: HOST_RECONNECT_GRACE_MS,
      });
      scheduleRoomClose(roomId);
    }
    if (clients.size === 0) {
      rooms.delete(roomId);
      roomTitles.delete(roomId);
    }
  });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 15_000);

wss.on("close", () => clearInterval(heartbeat));

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") return;
  const roomId =
    (url.searchParams.get("room") || "main")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 20) || "main";
  const role =
    url.searchParams.get("role") === "broadcaster" ? "broadcaster" : "viewer";
  wss.handleUpgrade(request, socket, head, (ws) =>
    wss.emit("connection", ws, request, { id: randomUUID(), roomId, role }),
  );
});

server.listen(port, hostname, () =>
  console.log(`PLAYSTAGE ready on http://localhost:${port}`),
);

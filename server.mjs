import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const dev = !process.argv.includes("--production");
const hostname = "0.0.0.0";
const usedEffectReceipts = new Set();
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
        description: `${mission.status === "success" ? "✅ 성공 확정" : mission.status === "fail" ? "❌ 실패 확정" : mission.status === "completed" ? "🏁 친구들의 동의로 종료" : "투표 진행 중"}\n제안자 **${mission.creator}** · 성공 시 **${mission.reward || 100}P**${mission.type === "time_attack" && mission.durationSeconds ? ` · ⏱️ ${Math.ceil(mission.durationSeconds / 60)}분 타임어택` : ""}`,
        color:
          mission.status === "success"
            ? 0x21d79f
            : mission.status === "fail"
              ? 0xff4967
              : 0x5865f2,
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
          {
            type: 2,
            style: 3,
            label: "성공",
            custom_id: `mission_vote:success:${mission.id}`,
            disabled: finished,
          },
          {
            type: 2,
            style: 4,
            label: "실패",
            custom_id: `mission_vote:fail:${mission.id}`,
            disabled: finished,
          },
          {
            type: 2,
            style: 5,
            label: "웹에서 보기",
            url: `${appOrigin}/live?room=${mission.roomCode}`,
          },
        ],
      },
    ],
  };
}

async function postMissionToDiscord(roomCode, missionId) {
  if (!sql || !process.env.DISCORD_BOT_TOKEN) return;
  const [mission] = await sql.query(
    `select m.id, m.title, m.creator, m.reward, m.status, m.success, m.fail,
            m.type, m.duration_seconds as "durationSeconds",
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
            m.type, m.duration_seconds as "durationSeconds",
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
      clients &&
      [...clients.values()].some((client) => client.role === "broadcaster");
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
        for (const client of clients.values())
          client.socket.close(1000, "room closed");
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
    `select m.id, m.title, m.creator, m.creator_client_id as "creatorClientId",
            m.type, m.duration_seconds as "durationSeconds", m.started_at as "startedAt",
            m.ends_at as "endsAt", m.end_requested_at as "endRequestedAt",
            m.end_required_count as "endRequiredCount", m.status, m.success, m.fail,
            (select count(*)::int from mission_end_votes mev
              where mev.mission_id = m.id and mev.approved_at is not null) as "endApprovalCount"
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

    if (message.type === "missions-request" && role === "broadcaster") {
      try {
        send(socket, {
          type: "missions-sync",
          missions: await getRoomMissions(roomId),
        });
      } catch (error) {
        console.error("Failed to load host missions", error);
      }
      return;
    }

    if (message.type === "viewer-profile" && role === "viewer") {
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
      }
      broadcast(roomId, { type: "viewer-profile", from: id, name });
      return;
    }

    if (
      role === "broadcaster" &&
      ["screen-changed", "broadcast-paused", "broadcast-resumed"].includes(
        message.type,
      )
    ) {
      broadcast(roomId, { type: message.type, from: id }, id);
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

    if (message.type === "companion-ready") {
      try {
        send(socket, {
          type: "missions-sync",
          missions: await getRoomMissions(roomId),
        });
      } catch (error) {
        console.error("Failed to load companion missions", error);
      }
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
            roomId,
            title,
            creator,
            creatorClientId || null,
            missionType,
            durationSeconds,
          ],
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

    if (message.type === "mission-end-request" && role === "viewer") {
      if (!sql) return;
      const missionId = String(message.missionId || "");
      const clientKey = String(message.clientKey || "")
        .replace(/[^a-zA-Z0-9-]/g, "")
        .slice(0, 64);
      const [owned] = await sql.query(
        `select m.id from missions m join rooms r on r.id = m.room_id
          where m.id = $1 and r.code = $2 and m.status = 'active'
            and m.creator_client_id = $3 and m.end_requested_at is null`,
        [missionId, roomId, clientKey],
      );
      if (!owned) return;
      const eligible = [
        ...new Map(
          [...clients.values()]
            .filter(
              (client) =>
                client.role === "viewer" &&
                client.clientKey &&
                client.clientKey !== clientKey,
            )
            .map((client) => [
              client.clientKey,
              { key: client.clientKey, name: client.name || "친구" },
            ]),
        ).values(),
      ];
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
        broadcast(roomId, { type: "mission-updated", mission });
        void updateDiscordMission(missionId).catch(console.error);
      }
      return;
    }

    if (message.type === "mission-end-approve" && role === "viewer") {
      if (!sql) return;
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
        broadcast(roomId, { type: "mission-updated", mission });
        void updateDiscordMission(missionId).catch(console.error);
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
      return;
    }

    if (message.type === "party-effect" && role === "viewer") {
      if (
        !["shake", "blackout", "blur", "sticker_rain"].includes(message.effect)
      )
        return;
      const receipt = String(message.receipt || "");
      const signature = String(message.signature || "");
      const expected = createHmac(
        "sha256",
        process.env.DISCORD_CLIENT_SECRET || "playstage-local-effect",
      )
        .update(`${roomId}:${message.effect}:${receipt}`)
        .digest("hex");
      if (
        !receipt ||
        signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ||
        usedEffectReceipts.has(receipt)
      )
        return;
      usedEffectReceipts.add(receipt);
      setTimeout(() => usedEffectReceipts.delete(receipt), 3_600_000);
      broadcast(roomId, {
        type: "party-effect",
        effect: message.effect,
        name: String(message.name || "친구")
          .trim()
          .slice(0, 24),
        createdAt: Date.now(),
      });
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
  const requestedRole = url.searchParams.get("role");
  const role =
    requestedRole === "broadcaster"
      ? "broadcaster"
      : requestedRole === "companion"
        ? "companion"
        : "viewer";
  wss.handleUpgrade(request, socket, head, (ws) =>
    wss.emit("connection", ws, request, { id: randomUUID(), roomId, role }),
  );
});

server.listen(port, hostname, () =>
  console.log(`PLAYSTAGE ready on http://localhost:${port}`),
);

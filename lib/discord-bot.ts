import { neon } from "@neondatabase/serverless";
import { redis } from "./redis";

export type MissionCard = {
  id: string;
  title: string;
  creator: string;
  reward: number;
  status: string;
  success: number;
  fail: number;
  roomCode: string;
};

const api = "https://discord.com/api/v10";

export function discordRequest(path: string, init: RequestInit = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured");
  return fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

export function missionMessage(mission: MissionCard, origin: string) {
  const finished = mission.status !== "active";
  const result =
    mission.status === "success"
      ? "✅ 성공 확정"
      : mission.status === "fail"
        ? "❌ 실패 확정"
        : "투표 진행 중";
  return {
    embeds: [
      {
        title: `🎯 ${mission.title}`,
        description: `${result}\n제안자 **${mission.creator}** · 성공 시 **${mission.reward}P**`,
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
            emoji: { name: "✅" },
            custom_id: `mission_vote:success:${mission.id}`,
            disabled: finished,
          },
          {
            type: 2,
            style: 4,
            label: "실패",
            emoji: { name: "❌" },
            custom_id: `mission_vote:fail:${mission.id}`,
            disabled: finished,
          },
          {
            type: 2,
            style: 5,
            label: "웹에서 보기",
            url: `${origin}/live?room=${encodeURIComponent(mission.roomCode)}`,
          },
        ],
      },
    ],
  };
}

export async function publishRoomEvent(
  roomCode: string,
  payload: Record<string, unknown>,
) {
  if (redis)
    await redis.publish(`playstage:room:${roomCode}`, JSON.stringify(payload));
}

export async function postMissionToDiscord(
  roomCode: string,
  missionId: string,
  origin: string,
) {
  if (!process.env.DATABASE_URL || !process.env.DISCORD_BOT_TOKEN) return;
  const sql = neon(process.env.DATABASE_URL);
  const [row] = await sql.query(
    `select m.id, m.title, m.creator, m.reward, m.status, m.success, m.fail,
            r.code as "roomCode", rd.channel_id as "channelId"
       from missions m
       join rooms r on r.id = m.room_id
       join room_discord rd on rd.room_id = r.id
      where r.code = $1 and m.id = $2`,
    [roomCode, missionId],
  );
  if (!row) return;
  const response = await discordRequest(`/channels/${row.channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(missionMessage(row as MissionCard, origin)),
  });
  if (!response.ok) return;
  const message = (await response.json()) as { id: string; channel_id: string };
  await sql.query(
    `update missions set discord_message_id = $2, discord_channel_id = $3 where id = $1`,
    [missionId, message.id, message.channel_id],
  );
}

export async function updateDiscordMissionMessage(
  missionId: string,
  origin: string,
) {
  if (!process.env.DATABASE_URL || !process.env.DISCORD_BOT_TOKEN) return;
  const sql = neon(process.env.DATABASE_URL);
  const [row] = await sql.query(
    `select m.id, m.title, m.creator, m.reward, m.status, m.success, m.fail,
            m.discord_message_id as "messageId", m.discord_channel_id as "channelId",
            r.code as "roomCode"
       from missions m join rooms r on r.id = m.room_id where m.id = $1`,
    [missionId],
  );
  if (!row?.messageId || !row?.channelId) return;
  await discordRequest(`/channels/${row.channelId}/messages/${row.messageId}`, {
    method: "PATCH",
    body: JSON.stringify(missionMessage(row as MissionCard, origin)),
  });
}

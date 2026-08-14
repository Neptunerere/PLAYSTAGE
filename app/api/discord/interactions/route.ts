import { createPublicKey, randomBytes, verify } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import {
  discordRequest,
  missionMessage,
  publishRoomEvent,
  type MissionCard,
} from "@/lib/discord-bot";
import { requestOrigin } from "@/lib/request-origin";
import { castMissionVote, type MissionVote } from "@/lib/mission-votes";

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type Interaction = {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { name?: string };
  guild?: { name?: string };
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  message?: { id: string };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{
      name: string;
      value: string | number;
      user?: DiscordUser;
    }>;
    resolved?: { users?: Record<string, DiscordUser> };
  };
};

const ephemeral = 64;

function response(content: string, isEphemeral = true) {
  return NextResponse.json({
    type: 4,
    data: { content, flags: isEphemeral ? ephemeral : 0 },
  });
}

function isValidSignature(body: string, signature: string, timestamp: string) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(publicKey, "hex"),
    ]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(
      null,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

function option(interaction: Interaction, name: string) {
  const aliases: Record<string, string[]> = {
    title: ["title", "제목", "내용"],
    code: ["code", "방코드"],
    reward: ["reward", "보상"],
    user: ["user", "친구"],
    amount: ["amount", "포인트"],
  };
  return interaction.data?.options?.find((item) =>
    (aliases[name] || [name]).includes(item.name),
  )?.value;
}

function code(length = 20) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

function actor(interaction: Interaction) {
  return interaction.member?.user || interaction.user;
}

async function editDeferredResponse(
  interaction: Interaction,
  data: Record<string, unknown>,
) {
  const applicationId = process.env.DISCORD_CLIENT_ID;
  if (!applicationId) throw new Error("DISCORD_CLIENT_ID is not configured");
  const result = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!result.ok)
    throw new Error(`Discord deferred response failed: ${result.status}`);
}

async function createParty(
  interaction: Interaction,
  request: NextRequest,
  user: DiscordUser,
  guildId: string,
  channelId: string,
) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const title = String(option(interaction, "title") || "친구 게임 파티")
      .trim()
      .slice(0, 50);
    const roomCode = code();

    await sql.query(
      `insert into discord_profiles (discord_user_id, username, avatar, updated_at)
       values ($1, $2, $3, now())
       on conflict (discord_user_id) do update
         set username = excluded.username, avatar = excluded.avatar, updated_at = now()`,
      [user.id, user.global_name || user.username, user.avatar || null],
    );
    await sql.query(
      `insert into discord_guilds (guild_id, name) values ($1, $2)
       on conflict (guild_id) do update set name = excluded.name`,
      [guildId, interaction.guild?.name || null],
    );
    await sql.query(
      `insert into discord_channels (channel_id, guild_id, name) values ($1, $2, $3)
       on conflict (channel_id) do update set guild_id = excluded.guild_id, name = excluded.name`,
      [channelId, guildId, interaction.channel?.name || null],
    );
    const [room] = await sql.query(
      `insert into rooms (title, code) values ($1, $2) returning id`,
      [title, roomCode],
    );
    await sql.query(
      `insert into room_discord (room_id, guild_id, channel_id, host_discord_id)
       values ($1, $2, $3, $4)`,
      [room.id, guildId, channelId, user.id],
    );

    const origin = requestOrigin(request);
    const hostName = user.global_name || user.username;
    const publicMessage = await discordRequest(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        embeds: [
          {
            title: `🎮 ${title}`,
            description: `${hostName}님이 PLAYSTAGE 파티를 만들었어요. 친구들과 미션을 걸고 함께 즐겨보세요!`,
            color: 0x4f7cff,
            fields: [{ name: "방 코드", value: `\`${roomCode}\`` }],
            footer: { text: "화면 공유가 시작되면 이 채널로 알려드릴게요." },
          },
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "친구 파티 참가",
                url: `${origin}/live?room=${roomCode}`,
              },
            ],
          },
        ],
      }),
    });
    if (!publicMessage.ok)
      throw new Error(`Discord channel message failed: ${publicMessage.status}`);

    await editDeferredResponse(interaction, {
      content: "파티가 만들어졌어요. 아래 버튼은 호스트에게만 보여요.",
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "방송 시작",
              url: `${origin}/studio?room=${roomCode}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Discord party creation failed", error);
    await editDeferredResponse(interaction, {
      content: "파티를 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
      components: [],
    }).catch(console.error);
  }
}

async function connectParty(
  interaction: Interaction,
  request: NextRequest,
  user: DiscordUser,
  guildId: string,
  channelId: string,
) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const roomCode = String(option(interaction, "code") || "")
      .trim()
      .slice(0, 20);

    if (!/^[a-zA-Z0-9-]+$/.test(roomCode)) {
      await editDeferredResponse(interaction, {
        content: "방 코드는 영문, 숫자와 하이픈(-)만 입력할 수 있어요.",
        components: [],
      });
      return;
    }

    const [room] = await sql.query(
      `select id, title, code, status from rooms where code = $1 limit 1`,
      [roomCode],
    );
    if (!room) {
      await editDeferredResponse(interaction, {
        content: "해당 방 코드를 찾지 못했어요. 종료된 방송이거나 코드를 다시 확인해 주세요.",
        components: [],
      });
      return;
    }

    await sql.query(
      `insert into discord_guilds (guild_id, name) values ($1, $2)
       on conflict (guild_id) do update set name = excluded.name`,
      [guildId, interaction.guild?.name || null],
    );
    await sql.query(
      `insert into discord_channels (channel_id, guild_id, name) values ($1, $2, $3)
       on conflict (channel_id) do update set guild_id = excluded.guild_id, name = excluded.name`,
      [channelId, guildId, interaction.channel?.name || null],
    );
    await sql.query(`delete from room_discord where channel_id = $1`, [channelId]);
    await sql.query(
      `insert into room_discord (room_id, guild_id, channel_id, host_discord_id)
       values ($1, $2, $3, $4)
       on conflict (room_id) do update set
         guild_id = excluded.guild_id,
         channel_id = excluded.channel_id,
         host_discord_id = excluded.host_discord_id,
         created_at = now()`,
      [room.id, guildId, channelId, user.id],
    );

    const origin = requestOrigin(request);
    const isLive = room.status === "live";
    await editDeferredResponse(interaction, {
      content: `✅ **${room.title}** 방송을 이 채널에 연결했어요.`,
      embeds: [
        {
          title: `${isLive ? "🔴 LIVE" : "🎮 연결 완료"} · ${room.title}`,
          description: isLive
            ? "현재 화면 공유가 진행 중이에요. 이제 이 채널에서 미션과 투표를 함께할 수 있어요."
            : "호스트가 화면 공유를 시작하면 이 채널에 자동으로 알려드릴게요.",
          color: isLive ? 0xff4568 : 0x4f7cff,
          fields: [{ name: "방 코드", value: `\`${room.code}\`` }],
          footer: {
            text: `${user.global_name || user.username}님이 연결함`,
          },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "친구 파티 참가",
              url: `${origin}/live?room=${room.code}`,
            },
            {
              type: 2,
              style: 5,
              label: "호스트 화면 열기",
              url: `${origin}/studio?room=${room.code}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    console.error("Discord room connection failed", error);
    await editDeferredResponse(interaction, {
      content: "방송을 Discord 채널에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      components: [],
    }).catch(console.error);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-ed25519") || "";
  const timestamp = request.headers.get("x-signature-timestamp") || "";
  if (!isValidSignature(rawBody, signature, timestamp))
    return new NextResponse("invalid request signature", { status: 401 });

  const interaction = JSON.parse(rawBody) as Interaction;
  if (interaction.type === 1) return NextResponse.json({ type: 1 });
  if (!process.env.DATABASE_URL)
    return response("데이터베이스가 아직 연결되지 않았어요.");

  const sql = neon(process.env.DATABASE_URL);
  const user = actor(interaction);
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  if (
    user &&
    guildId &&
    channelId &&
    interaction.type === 2 &&
    ["party", "파티"].includes(interaction.data?.name || "")
  ) {
    waitUntil(createParty(interaction, request, user, guildId, channelId));
    return NextResponse.json({ type: 5, data: { flags: ephemeral } });
  }
  if (
    user &&
    guildId &&
    channelId &&
    interaction.type === 2 &&
    ["connect", "연결"].includes(interaction.data?.name || "")
  ) {
    waitUntil(connectParty(interaction, request, user, guildId, channelId));
    return NextResponse.json({ type: 5 });
  }
  if (!user || !guildId || !channelId)
    return response("Discord 서버 채널에서 사용해 주세요.");
  await sql.query(
    `insert into discord_profiles (discord_user_id, username, avatar, updated_at)
     values ($1, $2, $3, now())
     on conflict (discord_user_id) do update
       set username = excluded.username, avatar = excluded.avatar, updated_at = now()`,
    [user.id, user.global_name || user.username, user.avatar || null],
  );

  if (interaction.type === 2) {
    const commandAliases: Record<string, string> = {
      파티: "party",
      연결: "connect",
      미션: "mission",
      포인트: "points",
      선물: "gift",
      순위: "rank",
    };
    const name =
      commandAliases[interaction.data?.name || ""] || interaction.data?.name;

    if (name === "party") {
      const title = String(option(interaction, "title") || "친구 게임 파티")
        .trim()
        .slice(0, 50);
      const roomCode = code();
      await sql.query(
        `insert into discord_guilds (guild_id, name) values ($1, $2)
         on conflict (guild_id) do update set name = excluded.name`,
        [guildId, interaction.guild?.name || null],
      );
      await sql.query(
        `insert into discord_channels (channel_id, guild_id, name) values ($1, $2, $3)
         on conflict (channel_id) do update set guild_id = excluded.guild_id, name = excluded.name`,
        [channelId, guildId, interaction.channel?.name || null],
      );
      const [room] = await sql.query(
        `insert into rooms (title, code) values ($1, $2) returning id`,
        [title, roomCode],
      );
      await sql.query(
        `insert into room_discord (room_id, guild_id, channel_id, host_discord_id)
         values ($1, $2, $3, $4)`,
        [room.id, guildId, channelId, user.id],
      );
      const origin = requestOrigin(request);
      return NextResponse.json({
        type: 4,
        data: {
          embeds: [
            {
              title: `🎮 ${title}`,
              description:
                "Discord에서 대화하고, PLAYSTAGE에서 미션과 반응을 함께 즐겨요.",
              color: 0x5865f2,
              fields: [{ name: "방 코드", value: `\`${roomCode}\`` }],
              footer: {
                text: `${user.global_name || user.username}님이 만든 파티`,
              },
            },
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 5,
                  label: "방송 시작",
                  url: `${origin}/studio?room=${roomCode}`,
                },
                {
                  type: 2,
                  style: 5,
                  label: "파티 참가",
                  url: `${origin}/live?room=${roomCode}`,
                },
              ],
            },
          ],
        },
      });
    }

    if (name === "mission") {
      const title = String(option(interaction, "title") || "")
        .trim()
        .slice(0, 80);
      const reward = Math.max(
        0,
        Math.min(1000, Number(option(interaction, "reward") || 100)),
      );
      const [party] = await sql.query(
        `select r.id, r.code as "roomCode" from room_discord rd
         join rooms r on r.id = rd.room_id
         where rd.channel_id = $1 order by rd.created_at desc limit 1`,
        [channelId],
      );
      if (!party)
        return response(
          "이 채널에 열린 파티가 없어요. 먼저 `/party`를 실행해 주세요.",
        );
      const creator = user.global_name || user.username;
      const [mission] = await sql.query(
        `insert into missions (room_id, title, creator, creator_discord_id, reward, discord_channel_id)
         values ($1, $2, $3, $4, $5, $6)
         returning id, title, creator, reward, status, success, fail`,
        [party.id, title, creator, user.id, reward, channelId],
      );
      const card = { ...mission, roomCode: party.roomCode } as MissionCard;
      await publishRoomEvent(party.roomCode, { type: "mission", mission });
      return NextResponse.json({
        type: 4,
        data: missionMessage(card, requestOrigin(request)),
      });
    }

    if (name === "points" || name === "rank") {
      if (name === "rank") {
        const rows = await sql.query(
          `select p.username, coalesce(sum(l.amount), 0)::int as points
             from discord_profiles p join point_ledger l on l.discord_user_id = p.discord_user_id
            where l.guild_id = $1 group by p.discord_user_id, p.username
            order by points desc limit 10`,
          [guildId],
        );
        const list = rows.length
          ? rows
              .map(
                (row, index) =>
                  `${index + 1}. **${row.username}** · ${row.points}P`,
              )
              .join("\n")
          : "아직 포인트를 받은 친구가 없어요.";
        return response(`🏆 **PLAYSTAGE 포인트 순위**\n${list}`, false);
      }
      const targetId = String(option(interaction, "user") || user.id);
      const [balance] = await sql.query(
        `select coalesce(sum(amount), 0)::int as points from point_ledger
         where guild_id = $1 and discord_user_id = $2`,
        [guildId, targetId],
      );
      return response(`💎 현재 포인트는 **${balance?.points || 0}P**예요.`);
    }

    if (name === "gift") {
      const targetId = String(option(interaction, "user") || "");
      const amount = Math.max(
        1,
        Math.min(10000, Number(option(interaction, "amount") || 0)),
      );
      if (!targetId || targetId === user.id)
        return response("자기 자신에게는 포인트를 선물할 수 없어요.");
      const targetUser = interaction.data?.resolved?.users?.[targetId];
      if (targetUser) {
        await sql.query(
          `insert into discord_profiles (discord_user_id, username, avatar, updated_at)
           values ($1, $2, $3, now()) on conflict (discord_user_id) do update
           set username = excluded.username, avatar = excluded.avatar, updated_at = now()`,
          [
            targetUser.id,
            targetUser.global_name || targetUser.username,
            targetUser.avatar || null,
          ],
        );
      }
      const [result] = await sql.query(
        `with balance as (
           select coalesce(sum(amount), 0)::int as value from point_ledger
           where guild_id = $1 and discord_user_id = $2
         ), debit as (
           insert into point_ledger (guild_id, discord_user_id, amount, reason, reference_key)
           select $1, $2, -$4, 'gift_sent', $5 from balance where value >= $4
           on conflict (reference_key) do nothing returning id
         ), credit as (
           insert into point_ledger (guild_id, discord_user_id, amount, reason, reference_key)
           select $1, $3, $4, 'gift_received', $6 from debit
           on conflict (reference_key) do nothing returning id
         ) select exists(select 1 from credit) as sent`,
        [
          guildId,
          user.id,
          targetId,
          amount,
          `gift:${interaction.id}:out`,
          `gift:${interaction.id}:in`,
        ],
      );
      return response(
        result?.sent
          ? `🎁 <@${targetId}>님에게 **${amount}P**를 선물했어요!`
          : "포인트가 부족해요.",
        !result?.sent,
      );
    }
  }

  if (interaction.type === 3) {
    const [action, vote, missionId] =
      interaction.data?.custom_id?.split(":") || [];
    if (
      action !== "mission_vote" ||
      !["success", "fail"].includes(vote) ||
      !missionId
    )
      return response("처리할 수 없는 버튼이에요.");

    const result = await castMissionVote(
      missionId,
      user.id,
      vote as MissionVote,
    );
    const mission = result.mission;
    if (!mission)
      return response("이미 종료되었거나 존재하지 않는 미션이에요.");
    if (!result.accepted)
      return response("이미 이 미션에 투표했습니다.");
    if (interaction.message?.id)
      await sql.query(
        `update missions set discord_message_id = $2, discord_channel_id = $3 where id = $1`,
        [missionId, interaction.message.id, channelId],
      );
    await publishRoomEvent(mission.roomCode, {
      type: "mission-updated",
      mission,
    });
    return NextResponse.json({
      type: 7,
      data: missionMessage(mission as MissionCard, requestOrigin(request)),
    });
  }

  return response("지원하지 않는 요청이에요.");
}

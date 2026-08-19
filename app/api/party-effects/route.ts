import { createHmac, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { readDiscordSession } from "@/lib/discord-auth";

const EFFECTS = {
  shake: { cost: 20, label: "화면 흔들기" },
  blackout: { cost: 35, label: "암전" },
  blur: { cost: 30, label: "시야 흐리기" },
  sticker_rain: { cost: 15, label: "이모지 폭우" },
} as const;

async function context(room: string) {
  if (!process.env.DATABASE_URL) return null;
  const session = await readDiscordSession(
    (await cookies()).get("playstage_discord")?.value,
  );
  if (!session) return null;
  const sql = neon(process.env.DATABASE_URL);
  const [linked] = await sql.query(
    `select rd.guild_id as "guildId"
       from rooms r join room_discord rd on rd.room_id = r.id
      where r.code = $1 and r.status = 'live'`,
    [room],
  );
  if (!linked) return null;
  return { sql, session, guildId: String(linked.guildId) };
}

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get("room") || "";
  const current = await context(room);
  if (!current)
    return NextResponse.json({
      authenticated: false,
      balance: 0,
      effects: EFFECTS,
    });
  const [row] = await current.sql.query(
    `select coalesce(sum(amount), 0)::int as balance from point_ledger
      where guild_id = $1 and discord_user_id = $2`,
    [current.guildId, current.session.user.id],
  );
  return NextResponse.json({
    authenticated: true,
    balance: Number(row?.balance || 0),
    effects: EFFECTS,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    room?: string;
    effect?: keyof typeof EFFECTS;
  } | null;
  const room = String(body?.room || "").slice(0, 20);
  const effect = body?.effect;
  if (!effect || !EFFECTS[effect])
    return NextResponse.json(
      { error: "지원하지 않는 방해 효과입니다." },
      { status: 400 },
    );
  const current = await context(room);
  if (!current)
    return NextResponse.json(
      { error: "Discord 계정과 채널 연결이 필요합니다." },
      { status: 401 },
    );
  const definition = EFFECTS[effect];
  const [spent] = await current.sql.query(
    `with balance as (
       select coalesce(sum(amount), 0)::int as value from point_ledger
        where guild_id = $1 and discord_user_id = $2
     )
     insert into point_ledger
       (guild_id, discord_user_id, amount, reason, reference_key)
     select $1, $2, $3, 'party_effect', $4 from balance where value >= $5
     returning id`,
    [
      current.guildId,
      current.session.user.id,
      -definition.cost,
      `effect:${room}:${current.session.user.id}:${randomUUID()}`,
      definition.cost,
    ],
  );
  if (!spent)
    return NextResponse.json(
      { error: "포인트가 부족합니다." },
      { status: 409 },
    );
  const [balance] = await current.sql.query(
    `select coalesce(sum(amount), 0)::int as value from point_ledger
      where guild_id = $1 and discord_user_id = $2`,
    [current.guildId, current.session.user.id],
  );
  const receipt = String(spent.id);
  const signature = createHmac(
    "sha256",
    process.env.DISCORD_CLIENT_SECRET || "playstage-local-effect",
  )
    .update(`${room}:${effect}:${receipt}`)
    .digest("hex");
  return NextResponse.json({
    accepted: true,
    balance: Number(balance?.value || 0),
    event: {
      type: "party-effect",
      effect,
      name: current.session.user.globalName || current.session.user.username,
      createdAt: Date.now(),
      receipt,
      signature,
    },
  });
}

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { readDiscordSession } from "@/lib/discord-auth";
import { castMissionVote, type MissionVote } from "@/lib/mission-votes";
import { publishRoomEvent, updateDiscordMissionMessage } from "@/lib/discord-bot";
import { requestOrigin } from "@/lib/request-origin";

async function session() {
  const store = await cookies();
  return readDiscordSession(store.get("playstage_discord")?.value);
}

export async function GET(request: NextRequest) {
  const current = await session();
  if (!current || !process.env.DATABASE_URL)
    return NextResponse.json({ authenticated: false, votes: {} });
  const room = new URL(request.url).searchParams.get("room") || "";
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql.query(
    `select mv.mission_id as "missionId", mv.vote
       from mission_votes mv
       join missions m on m.id = mv.mission_id
       join rooms r on r.id = m.room_id
      where r.code = $1 and mv.discord_user_id = $2`,
    [room, current.user.id],
  );
  return NextResponse.json({
    authenticated: true,
    votes: Object.fromEntries(rows.map((row) => [row.missionId, row.vote])),
  });
}

export async function POST(request: NextRequest) {
  const current = await session();
  if (!current)
    return NextResponse.json({ error: "Discord 계정 연결이 필요합니다." }, { status: 401 });
  const body = (await request.json()) as { missionId?: string; vote?: MissionVote };
  if (!body.missionId || !["success", "fail"].includes(body.vote || ""))
    return NextResponse.json({ error: "잘못된 투표입니다." }, { status: 400 });

  const result = await castMissionVote(body.missionId, current.user.id, body.vote!);
  if (!result.mission)
    return NextResponse.json({ error: "미션을 찾을 수 없습니다." }, { status: 404 });
  if (!result.accepted)
    return NextResponse.json(
      { error: "이미 이 미션에 투표했습니다.", mission: result.mission },
      { status: 409 },
    );

  await publishRoomEvent(result.mission.roomCode, {
    type: "mission-updated",
    mission: result.mission,
  });
  void updateDiscordMissionMessage(body.missionId, requestOrigin(request)).catch(console.error);
  return NextResponse.json({ accepted: true, mission: result.mission });
}

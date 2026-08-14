import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { discordRequest } from "@/lib/discord-bot";
import { requestOrigin } from "@/lib/request-origin";

const roomCodePattern = /^[a-zA-Z0-9-]{1,20}$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!roomCodePattern.test(code) || !process.env.DATABASE_URL)
    return NextResponse.json({ connected: false });

  const sql = neon(process.env.DATABASE_URL);
  const [connection] = await sql.query(
    `select dc.name as "channelName"
       from rooms r
       join room_discord rd on rd.room_id = r.id
       join discord_channels dc on dc.channel_id = rd.channel_id
      where r.code = $1
      limit 1`,
    [code],
  );

  return NextResponse.json({
    connected: Boolean(connection),
    channelName: connection?.channelName || null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!roomCodePattern.test(code) || !process.env.DATABASE_URL)
    return NextResponse.json({ error: "방 정보가 올바르지 않습니다." }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL);
  const [room] = await sql.query(
    `select r.title, r.status, rd.channel_id as "channelId"
       from rooms r join room_discord rd on rd.room_id = r.id
      where r.code = $1`,
    [code],
  );
  if (!room?.channelId)
    return NextResponse.json(
      { error: "이 방에 연결된 Discord 채널이 없습니다." },
      { status: 404 },
    );

  const inviteUrl = `${requestOrigin(request)}/live?room=${encodeURIComponent(code)}`;
  const response = await discordRequest(`/channels/${room.channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [
        {
          title: `🔴 ${room.title}`,
          description: "화면 공유가 진행 중이에요. 친구 파티에 들어와 미션과 투표에 참여해 보세요!",
          color: 0xff4568,
          fields: [{ name: "방 코드", value: `\`${code}\`` }],
        },
      ],
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "방송 보러 가기", url: inviteUrl },
          ],
        },
      ],
    }),
  });
  if (!response.ok)
    return NextResponse.json(
      { error: "Discord 채널에 알림을 보내지 못했습니다." },
      { status: 502 },
    );
  return NextResponse.json({ ok: true });
}

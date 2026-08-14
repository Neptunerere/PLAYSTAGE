import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { readDiscordSession } from "@/lib/discord-auth";
import { requestOrigin } from "@/lib/request-origin";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await readDiscordSession(
    cookieStore.get("playstage_discord")?.value,
  );
  if (!session?.webhookUrl) {
    return NextResponse.json(
      { error: "Discord 채널을 먼저 연결해 주세요." },
      { status: 401 },
    );
  }

  const body = (await request.json()) as { room?: string; title?: string };
  const room = body.room?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
  const title = body.title?.trim().slice(0, 50);
  if (!room || !title) {
    return NextResponse.json(
      { error: "방 정보가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const inviteUrl = `${requestOrigin(request)}/live?room=${encodeURIComponent(room)}`;
  const discordResponse = await fetch(`${session.webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "PLAYSTAGE",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `🎮 ${title}`,
          description:
            "Discord로 이야기하면서 PLAYSTAGE에서 미션을 걸고 함께 판정해 보세요.",
          url: inviteUrl,
          color: 0x5865f2,
          fields: [{ name: "방 코드", value: `\`${room}\``, inline: true }],
          footer: {
            text: `${session.user.globalName || session.user.username}님의 파티`,
          },
        },
      ],
    }),
  });

  if (!discordResponse.ok) {
    return NextResponse.json(
      { error: "Discord 채널에 초대를 보내지 못했습니다." },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

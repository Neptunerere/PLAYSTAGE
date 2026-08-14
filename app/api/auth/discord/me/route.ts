import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { discordAvatarUrl, readDiscordSession } from "@/lib/discord-auth";

export async function GET() {
  const cookieStore = await cookies();
  const session = await readDiscordSession(
    cookieStore.get("playstage_discord")?.value,
  );
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      ...session.user,
      displayName: session.user.globalName || session.user.username,
      avatarUrl: discordAvatarUrl(session.user),
      channelConnected: Boolean(session.webhookUrl),
    },
  });
}

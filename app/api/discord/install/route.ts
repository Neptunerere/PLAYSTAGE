import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId)
    return NextResponse.json(
      { error: "DISCORD_CLIENT_ID가 설정되지 않았습니다." },
      { status: 503 },
    );
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("permissions", "18432");
  return NextResponse.redirect(url);
}

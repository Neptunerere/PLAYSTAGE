import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestOrigin } from "@/lib/request-origin";

export async function GET(request: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Discord OAuth가 아직 설정되지 않았습니다." },
      { status: 503 },
    );
  }

  const state = randomBytes(24).toString("base64url");
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/studio";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/studio";
  const redirectUri = `${requestOrigin(request)}/api/auth/discord/callback`;
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("scope", "webhook.incoming");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(authorize);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  };
  response.cookies.set("discord_oauth_state", state, options);
  response.cookies.set("discord_oauth_return", safeReturnTo, options);
  response.cookies.set("discord_oauth_flow", "channel", options);
  return response;
}

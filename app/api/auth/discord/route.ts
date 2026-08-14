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
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/";
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/";
  const redirectUri = `${requestOrigin(request)}/api/auth/discord/callback`;
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(authorize);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("discord_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("discord_oauth_return", safeReturnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("discord_oauth_flow", "login", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 600,
    path: "/",
  });
  return response;
}

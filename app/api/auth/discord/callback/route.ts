import { NextRequest, NextResponse } from "next/server";
import { readDiscordSession, sealDiscordSession } from "@/lib/discord-auth";
import { requestOrigin } from "@/lib/request-origin";

type TokenResponse = {
  access_token?: string;
  webhook?: { url?: string };
};

type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

function returnUrl(request: NextRequest, returnTo: string, error?: string) {
  const url = new URL(returnTo, requestOrigin(request));
  if (error) url.searchParams.set("discord", error);
  else url.searchParams.delete("discord");
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("discord_oauth_state")?.value;
  const flow = request.cookies.get("discord_oauth_flow")?.value || "login";
  const returnTo = request.cookies.get("discord_oauth_return")?.value || "/";
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret)
    return NextResponse.redirect(returnUrl(request, returnTo, "config"));
  if (!code)
    return NextResponse.redirect(returnUrl(request, returnTo, "denied"));
  if (!state || !savedState || state !== savedState)
    return NextResponse.redirect(returnUrl(request, returnTo, "state"));

  const redirectUri = `${requestOrigin(request)}/api/auth/discord/callback`;
  const tokenResponse = await fetch(
    "https://discord.com/api/v10/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    },
  );

  const token = (await tokenResponse.json()) as TokenResponse;
  if (!tokenResponse.ok || !token.access_token) {
    return NextResponse.redirect(returnUrl(request, returnTo, "token"));
  }

  let sessionData;
  if (flow === "channel") {
    const currentSession = await readDiscordSession(
      request.cookies.get("playstage_discord")?.value,
    );
    if (!currentSession || !token.webhook?.url) {
      return NextResponse.redirect(returnUrl(request, returnTo, "channel"));
    }
    sessionData = { ...currentSession, webhookUrl: token.webhook.url };
  } else {
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
    if (!userResponse.ok) {
      return NextResponse.redirect(returnUrl(request, returnTo, "profile"));
    }

    const user = (await userResponse.json()) as DiscordUser;
    sessionData = {
      user: {
        id: user.id,
        username: user.username,
        globalName: user.global_name,
        avatar: user.avatar,
      },
    };
  }
  const session = await sealDiscordSession(sessionData);
  const response = NextResponse.redirect(returnUrl(request, returnTo));
  response.cookies.set("playstage_discord", session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  response.cookies.delete("discord_oauth_state");
  response.cookies.delete("discord_oauth_return");
  response.cookies.delete("discord_oauth_flow");
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { requestOrigin } from "@/lib/request-origin";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("playstage_discord");
  return response;
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", requestOrigin(request)));
  response.cookies.delete("playstage_discord");
  return response;
}

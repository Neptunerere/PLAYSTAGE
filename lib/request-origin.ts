import type { NextRequest } from "next/server";

export function requestOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol || request.nextUrl.protocol.replace(":", "");

  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

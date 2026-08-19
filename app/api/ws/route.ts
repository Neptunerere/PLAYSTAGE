import { experimental_upgradeWebSocket } from "@vercel/functions";
import { registerRealtimeClient } from "@/lib/realtime";

export const runtime = "nodejs";
export const maxDuration = 300;

export function GET(request: Request) {
  const url = new URL(request.url);
  const room =
    (url.searchParams.get("room") || "main")
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 20) || "main";
  const requestedRole = url.searchParams.get("role");
  const role =
    requestedRole === "broadcaster"
      ? "broadcaster"
      : requestedRole === "companion"
        ? "companion"
        : "viewer";

  return experimental_upgradeWebSocket((socket) => {
    registerRealtimeClient(socket, room, role);
  });
}

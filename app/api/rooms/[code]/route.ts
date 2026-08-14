import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";

const roomCodePattern = /^[a-zA-Z0-9-]{1,20}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;

    if (!roomCodePattern.test(code)) {
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    const room = await getDb().query.rooms.findFirst({
      columns: {
        id: true,
        title: true,
        code: true,
        status: true,
        hostHeartbeatAt: true,
      },
      where: eq(rooms.code, code),
    });

    if (!room) {
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    if (
      room.status === "live" &&
      (!room.hostHeartbeatAt ||
        Date.now() - room.hostHeartbeatAt.getTime() > 60_000)
    ) {
      await getDb()
        .delete(rooms)
        .where(
          and(
            eq(rooms.code, code),
            eq(rooms.status, "live"),
            or(
              isNull(rooms.hostHeartbeatAt),
              lt(rooms.hostHeartbeatAt, new Date(Date.now() - 60_000)),
            ),
          ),
        );
      return NextResponse.json({ exists: false }, { status: 404 });
    }

    return NextResponse.json({ exists: true, room });
  } catch (error) {
    console.error("Failed to find room", error);
    return NextResponse.json(
      { error: "방 정보를 확인하지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    if (!roomCodePattern.test(code))
      return NextResponse.json({ updated: false }, { status: 400 });

    const updated = await getDb()
      .update(rooms)
      .set({ hostHeartbeatAt: new Date() })
      .where(and(eq(rooms.code, code), eq(rooms.status, "live")))
      .returning({ id: rooms.id });

    if (updated.length === 0)
      return NextResponse.json({ updated: false }, { status: 404 });
    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Failed to update room heartbeat", error);
    return NextResponse.json(
      { error: "방송 상태를 갱신하지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;

    if (!roomCodePattern.test(code)) {
      return NextResponse.json({ deleted: false }, { status: 400 });
    }

    const deleted = await getDb()
      .delete(rooms)
      .where(eq(rooms.code, code))
      .returning({ id: rooms.id });

    if (deleted.length === 0) {
      return NextResponse.json({ deleted: false }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete room", error);
    return NextResponse.json(
      { error: "방 정보를 삭제하지 못했습니다." },
      { status: 500 },
    );
  }
}

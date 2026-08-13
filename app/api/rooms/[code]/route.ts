import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
      columns: { id: true, title: true, code: true },
      where: eq(rooms.code, code),
    });

    if (!room) {
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

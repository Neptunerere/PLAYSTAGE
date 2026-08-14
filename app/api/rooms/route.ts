import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";

const roomCodePattern = /^[a-zA-Z0-9-]{1,20}$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { title?: unknown; code?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!title || title.length > 50) {
      return NextResponse.json(
        { error: "방 제목은 1자 이상 50자 이하로 입력해 주세요." },
        { status: 400 },
      );
    }

    if (!roomCodePattern.test(code)) {
      return NextResponse.json(
        { error: "방 코드는 영문, 숫자, 하이픈으로 20자 이내여야 합니다." },
        { status: 400 },
      );
    }

    const [room] = await getDb()
      .insert(rooms)
      .values({ title, code, status: "live", hostHeartbeatAt: new Date() })
      .onConflictDoUpdate({
        target: rooms.code,
        set: { title, status: "live", hostHeartbeatAt: new Date() },
      })
      .returning();

    return NextResponse.json({ room }, { status: 201 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return NextResponse.json(
        {
          error:
            "이미 사용 중인 방 코드입니다. 새로고침 후 다시 시도해 주세요.",
        },
        { status: 409 },
      );
    }

    console.error("Failed to create room", error);
    return NextResponse.json(
      { error: "방 정보를 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}

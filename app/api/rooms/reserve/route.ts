import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";

function createRoomCode(length = 20) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  return [...bytes]
    .map((value) => alphabet[value % alphabet.length])
    .join("");
}

export async function POST() {
  try {
    const db = getDb();

    await db
      .delete(rooms)
      .where(
        and(
          eq(rooms.status, "draft"),
          lt(rooms.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [room] = await db
          .insert(rooms)
          .values({
            title: "새 게임 파티",
            code: createRoomCode(),
            status: "draft",
          })
          .returning({ id: rooms.id, code: rooms.code, status: rooms.status });

        return NextResponse.json({ room }, { status: 201 });
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "23505"
        )
          throw error;
      }
    }

    return NextResponse.json(
      { error: "방 코드를 만들지 못했습니다. 다시 시도해 주세요." },
      { status: 503 },
    );
  } catch (error) {
    console.error("Failed to reserve room", error);
    return NextResponse.json(
      { error: "파티를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}

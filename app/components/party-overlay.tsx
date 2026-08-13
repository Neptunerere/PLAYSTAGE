"use client";

import {
  Cross2Icon,
  CursorArrowIcon,
  Pencil2Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { PointerEvent, useEffect, useRef, useState } from "react";

export type OverlayItem = {
  id: string;
  kind: "stroke" | "ping" | "emoji" | "clear";
  color?: string;
  points?: Array<[number, number]>;
  x?: number;
  y?: number;
  emoji?: string;
  createdAt: number;
};

export default function PartyOverlay({
  items,
  send,
  host = false,
}: {
  items: OverlayItem[];
  send?: (item: Omit<OverlayItem, "id" | "createdAt">) => void;
  host?: boolean;
}) {
  const [tool, setTool] = useState<"ping" | "draw">("ping");
  const [local, setLocal] = useState<OverlayItem[]>([]);
  const drawing = useRef<Array<[number, number]> | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const visible = [...items, ...local].filter(
    (item) => Date.now() - item.createdAt < 6000,
  );

  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setLocal((items) =>
          items.filter((item) => Date.now() - item.createdAt < 6000),
        ),
      500,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (items.at(-1)?.kind === "clear") setLocal([]);
  }, [items]);

  function point(event: PointerEvent) {
    const rect = layerRef.current!.getBoundingClientRect();
    return [
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    ] as [number, number];
  }
  function down(event: PointerEvent) {
    if (!send) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    if (tool === "ping")
      send({ kind: "ping", x: p[0], y: p[1], color: "#21d7cf" });
    else drawing.current = [p];
  }
  function move(event: PointerEvent) {
    if (drawing.current) drawing.current.push(point(event));
  }
  function up() {
    if (drawing.current?.length)
      send?.({ kind: "stroke", points: drawing.current, color: "#67a0ff" });
    drawing.current = null;
  }
  function react(emoji: string) {
    send?.({
      kind: "emoji",
      emoji,
      x: 0.25 + Math.random() * 0.5,
      y: 0.35 + Math.random() * 0.3,
    });
  }

  return (
    <div
      className={`party-overlay ${send ? "interactive" : "host-overlay"}`}
      ref={layerRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      <svg viewBox="0 0 1000 562" preserveAspectRatio="none">
        {visible
          .filter((i) => i.kind === "stroke")
          .map((item) => (
            <polyline
              key={item.id}
              points={item.points
                ?.map(([x, y]) => `${x * 1000},${y * 562}`)
                .join(" ")}
              fill="none"
              stroke={item.color}
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </svg>
      {visible
        .filter((i) => i.kind === "ping")
        .map((item) => (
          <span
            key={item.id}
            className="overlay-ping"
            style={{
              left: `${item.x! * 100}%`,
              top: `${item.y! * 100}%`,
              borderColor: item.color,
            }}
          >
            <i />
          </span>
        ))}
      {visible
        .filter((i) => i.kind === "emoji")
        .map((item) => (
          <span
            key={item.id}
            className="overlay-emoji"
            style={{ left: `${item.x! * 100}%`, top: `${item.y! * 100}%` }}
          >
            {item.emoji}
          </span>
        ))}
      {send && (
        <div
          className="overlay-tools"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className={tool === "ping" ? "active" : ""}
            onClick={() => setTool("ping")}
            title="핑"
          >
            <CursorArrowIcon />
          </button>
          <button
            className={tool === "draw" ? "active" : ""}
            onClick={() => setTool("draw")}
            title="낙서"
          >
            <Pencil2Icon />
          </button>
          {["😂", "🔥", "👏"].map((e) => (
            <button key={e} onClick={() => react(e)}>
              {e}
            </button>
          ))}
          <button onClick={() => send({ kind: "clear" })} title="모두 지우기">
            <TrashIcon />
          </button>
        </div>
      )}
      {host && visible.length > 0 && (
        <span className="overlay-host-label">친구들이 화면에 반응 중!</span>
      )}
    </div>
  );
}

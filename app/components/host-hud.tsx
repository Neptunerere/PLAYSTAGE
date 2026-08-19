"use client";

import { Cross2Icon, SpeakerLoudIcon, TargetIcon } from "@radix-ui/react-icons";

type Mission = {
  title: string;
  type?: "normal" | "time_attack";
  endsAt?: string | null;
  success: number;
  fail: number;
};

export default function HostHud({
  mission,
  messages,
  combo,
  now,
  onClose,
}: {
  mission?: Mission;
  messages: Array<{ id: string; name: string; text: string }>;
  combo: number;
  now: number;
  onClose?: () => void;
}) {
  const seconds = mission?.endsAt
    ? Math.max(0, Math.ceil((new Date(mission.endsAt).getTime() - now) / 1000))
    : null;
  const timer =
    seconds === null
      ? null
      : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const latest = messages.at(-1);
  return (
    <section className="host-hud">
      <header>
        <span>
          <i /> PLAYSTAGE HUD
        </span>
        {onClose && (
          <button type="button" onClick={onClose}>
            <Cross2Icon />
          </button>
        )}
      </header>
      <div className="host-hud-mission">
        <TargetIcon />
        <div>
          <small>진행 중인 미션</small>
          <b>{mission?.title || "등록된 미션이 없어요"}</b>
        </div>
        {timer && (
          <strong className={seconds !== null && seconds <= 60 ? "danger" : ""}>
            {timer}
          </strong>
        )}
      </div>
      <div className="host-hud-stats">
        <span>성공 {mission?.success || 0}</span>
        <span>실패 {mission?.fail || 0}</span>
        {combo >= 2 && <b>🔥 반응 {combo} COMBO</b>}
      </div>
      <div className="host-hud-chat">
        <SpeakerLoudIcon />
        {latest ? (
          <p>
            <b>{latest.name}</b> {latest.text}
          </p>
        ) : (
          <p>친구의 채팅이 여기에 표시돼요.</p>
        )}
      </div>
    </section>
  );
}

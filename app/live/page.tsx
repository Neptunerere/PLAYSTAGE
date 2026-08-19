"use client";
import Link from "next/link";
import {
  ArrowRightIcon,
  ChatBubbleIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ClockIcon,
  DiscordLogoIcon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  PersonIcon,
  PlusIcon,
  LightningBoltIcon,
  SpeakerLoudIcon,
  TargetIcon,
} from "@radix-ui/react-icons";
import { Dialog, Select, Tabs, Toast } from "radix-ui";
import { FormEvent, useEffect, useRef, useState } from "react";
import PartyOverlay, {
  OverlayItem,
  PartyEffect,
} from "../components/party-overlay";
type Chat = { id: string; name: string; text: string };
type Mission = {
  id: string;
  title: string;
  creator: string;
  creatorClientId?: string | null;
  type: "normal" | "time_attack";
  durationSeconds?: number | null;
  startedAt?: string;
  endsAt?: string | null;
  endRequestedAt?: string | null;
  endRequiredCount: number;
  endApprovalCount: number;
  status: string;
  success: number;
  fail: number;
};
type Msg = {
  type: string;
  title?: string;
  id?: string;
  from?: string;
  offer?: RTCSessionDescriptionInit;
  name?: string;
  text?: string;
  mission?: Mission;
  missions?: Mission[];
  missionId?: string;
  vote?: "success" | "fail";
  quality?: "auto" | "1080" | "720" | "480";
  item?: OverlayItem;
  effect?: PartyEffect["effect"];
  createdAt?: number;
};
const iceDone = (pc: RTCPeerConnection) =>
  pc.iceGatheringState === "complete"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        let settled = false;
        const f = () => {
          if (pc.iceGatheringState === "complete") {
            settled = true;
            pc.removeEventListener("icegatheringstatechange", f);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", f);
        window.setTimeout(() => {
          if (settled) return;
          pc.removeEventListener("icegatheringstatechange", f);
          resolve();
        }, 3000);
      });
const peerConfig: RTCConfiguration = {
  iceServers: [
    {
      urls: process.env.NEXT_PUBLIC_STUN_URL || "stun:stun.cloudflare.com:3478",
    },
  ],
};
export default function PartyRoom() {
  const video = useRef<HTMLVideoElement>(null),
    playerContainer = useRef<HTMLDivElement>(null),
    socket = useRef<WebSocket | null>(null),
    peer = useRef<RTCPeerConnection | null>(null);
  const [room, setRoom] = useState("pixel-quest"),
    [roomTitle, setRoomTitle] = useState("친구 게임 파티"),
    [status, setStatus] = useState("호스트의 화면 공유를 기다리는 중"),
    [connected, setConnected] = useState(false),
    [audio, setAudio] = useState(false),
    [chat, setChat] = useState(""),
    [missionTitle, setMissionTitle] = useState(""),
    [missionType, setMissionType] = useState<"normal" | "time_attack">(
      "normal",
    ),
    [missionMinutes, setMissionMinutes] = useState(10),
    [messages, setMessages] = useState<Chat[]>([]),
    [overlay, setOverlay] = useState<OverlayItem[]>([]),
    [missions, setMissions] = useState<Mission[]>([]),
    [copyToastOpen, setCopyToastOpen] = useState(false),
    [nickname, setNickname] = useState(""),
    [nicknameDraft, setNicknameDraft] = useState(""),
    [roomAvailable, setRoomAvailable] = useState<boolean | null>(null),
    [discordConnected, setDiscordConnected] = useState(false),
    [myVotes, setMyVotes] = useState<Record<string, "success" | "fail">>({}),
    [quality, setQuality] = useState("auto"),
    [fullscreen, setFullscreen] = useState(false);
  const [partyEffect, setPartyEffect] = useState<PartyEffect | null>(null);
  const [pointBalance, setPointBalance] = useState(0);
  const [effectError, setEffectError] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("playstage-client-key");
    const key = saved || crypto.randomUUID();
    localStorage.setItem("playstage-client-key", key);
    setClientKey(key);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!clientKey) return;
    const updateFullscreen = () =>
      setFullscreen(document.fullscreenElement === playerContainer.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);
  useEffect(() => {
    fetch("/api/auth/discord/me", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { user?: { displayName?: string } | null }) => {
        const displayName = result.user?.displayName?.trim().slice(0, 12);
        if (displayName) {
          setDiscordConnected(true);
          setNicknameDraft(displayName);
          setNickname(displayName);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let cancelled = false;
    let reconnectDelay = 1000;
    let reconnectTimer: number | undefined;
    let recoveryTimer: number | undefined;
    let recoveryInterval: number | undefined;
    let lastReadyAt = 0;
    let shouldReconnect = true;
    const requestedRoom =
      new URLSearchParams(location.search).get("room") || "pixel-quest";
    const r =
      requestedRoom.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20) || "pixel-quest";
    setRoom(r);
    let ws: WebSocket | null = null;

    const connect = async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(r)}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!response.ok) {
          setRoomAvailable(false);
          return;
        }
        const result = (await response.json()) as {
          room?: { title?: string; status?: "draft" | "live" };
        };
        setRoomAvailable(true);
        if (result.room?.title) setRoomTitle(result.room.title);
        void refreshMyVotes(r);
        void refreshPoints(r);
        setStatus(
          result.room?.status === "live"
            ? "방송 화면에 연결하는 중"
            : "호스트가 화면 공유를 준비하고 있어요",
        );
      } catch {
        if (!cancelled) setRoomAvailable(false);
        return;
      }

      const currentWs = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${process.env.NODE_ENV === "production" ? "/api/ws" : "/ws"}?room=${encodeURIComponent(r)}&role=viewer`,
      );
      ws = currentWs;
      socket.current = currentWs;
      const requestStream = (delay = 0) => {
        window.clearTimeout(recoveryTimer);
        recoveryTimer = window.setTimeout(() => {
          if (
            currentWs.readyState !== WebSocket.OPEN ||
            Date.now() - lastReadyAt < 1200
          )
            return;
          lastReadyAt = Date.now();
          currentWs.send(JSON.stringify({ type: "viewer-ready" }));
        }, delay);
      };
      currentWs.onopen = () => {
        reconnectDelay = 1000;
        setConnected(true);
        requestStream();
        recoveryInterval = window.setInterval(() => {
          const track =
            video.current?.srcObject instanceof MediaStream
              ? video.current.srcObject.getVideoTracks()[0]
              : null;
          if (!track || track.readyState === "ended" || track.muted)
            requestStream();
        }, 4000);
        if (nickname)
          currentWs.send(
            JSON.stringify({
              type: "viewer-profile",
              name: nickname,
              clientKey,
            }),
          );
      };
      currentWs.onclose = () => {
        window.clearInterval(recoveryInterval);
        window.clearTimeout(recoveryTimer);
        setConnected(false);
        if (!cancelled && shouldReconnect) {
          reconnectTimer = window.setTimeout(
            () => void connect(),
            reconnectDelay,
          );
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
        }
      };
      currentWs.onmessage = async (e) => {
        const m = JSON.parse(e.data) as Msg;
        if (m.type === "room-info" && m.title) setRoomTitle(m.title);
        else if (m.type === "offer" && m.offer && m.from) {
          peer.current?.close();
          const pc = new RTCPeerConnection(peerConfig);
          peer.current = pc;
          pc.ontrack = ({ streams }) => {
            if (video.current && streams[0]) {
              video.current.srcObject = streams[0];
              video.current.muted = true;
              video.current.play().catch(() => {});
              const track = streams[0].getVideoTracks()[0];
              if (track) {
                track.onended = () => requestStream(200);
                track.onmute = () => requestStream(1200);
              }
            }
            setStatus("LIVE");
          };
          pc.onconnectionstatechange = () => {
            if (["failed", "closed"].includes(pc.connectionState))
              requestStream(300);
            else if (pc.connectionState === "disconnected") requestStream(1800);
          };
          await pc.setRemoteDescription(m.offer);
          await pc.setLocalDescription(await pc.createAnswer());
          await iceDone(pc);
          currentWs.send(
            JSON.stringify({
              type: "answer",
              target: m.from,
              answer: pc.localDescription,
            }),
          );
        } else if (m.type === "chat" && m.id && m.name && m.text)
          setMessages((v) => [
            ...v.slice(-99),
            { id: m.id!, name: m.name!, text: m.text! },
          ]);
        else if (m.type === "missions-sync" && m.missions)
          setMissions(m.missions);
        else if (m.type === "mission" && m.mission)
          setMissions((v) => [m.mission!, ...v]);
        else if (m.type === "mission-updated" && m.mission) {
          setMissions((v) =>
            v.map((x) => (x.id === m.mission!.id ? m.mission! : x)),
          );
          void refreshMyVotes(r);
        } else if (m.type === "overlay" && m.item)
          setOverlay((v) =>
            m.item!.kind === "clear"
              ? []
              : [...v.filter((x) => Date.now() - x.createdAt < 6000), m.item!],
          );
        else if (m.type === "party-effect" && m.effect) {
          const next = {
            effect: m.effect,
            name: m.name,
            createdAt: m.createdAt || Date.now(),
          } as PartyEffect;
          setPartyEffect(next);
          window.setTimeout(
            () =>
              setPartyEffect((current) => (current === next ? null : current)),
            3200,
          );
        } else if (
          m.type === "broadcast-started" ||
          m.type === "screen-changed" ||
          m.type === "broadcast-resumed"
        ) {
          setStatus("호스트의 화면을 다시 연결하는 중");
          peer.current?.close();
          peer.current = null;
          if (video.current) video.current.srcObject = null;
          lastReadyAt = 0;
          requestStream(120);
        } else if (m.type === "broadcast-paused") {
          setStatus("호스트가 화면 공유를 잠시 멈췄어요");
        } else if (m.type === "broadcast-reconnecting")
          setStatus("호스트의 재접속을 기다리는 중");
        else if (m.type === "room-closed") {
          shouldReconnect = false;
          setStatus("호스트 연결이 종료되어 방이 닫혔습니다");
          setRoomAvailable(false);
        } else if (m.type === "broadcast-ended")
          setStatus("호스트가 화면 공유를 종료했습니다");
      };
    };
    void connect();
    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(recoveryTimer);
      window.clearInterval(recoveryInterval);
      ws?.close();
      peer.current?.close();
    };
  }, [clientKey]);
  useEffect(() => {
    if (!nickname || socket.current?.readyState !== WebSocket.OPEN) return;
    socket.current.send(
      JSON.stringify({ type: "viewer-profile", name: nickname, clientKey }),
    );
  }, [nickname, clientKey]);
  const send = (v: object) =>
    socket.current?.readyState === WebSocket.OPEN &&
    socket.current.send(JSON.stringify(v));
  async function refreshMyVotes(roomCode = room) {
    const response = await fetch(
      `/api/missions/votes?room=${encodeURIComponent(roomCode)}`,
      { cache: "no-store" },
    ).catch(() => null);
    if (!response?.ok) return;
    const result = (await response.json()) as {
      authenticated?: boolean;
      votes?: Record<string, "success" | "fail">;
    };
    setDiscordConnected(Boolean(result.authenticated));
    setMyVotes(result.votes || {});
  }
  async function refreshPoints(roomCode = room) {
    const response = await fetch(
      `/api/party-effects?room=${encodeURIComponent(roomCode)}`,
      { cache: "no-store" },
    ).catch(() => null);
    if (!response?.ok) return;
    const result = (await response.json()) as { balance?: number };
    setPointBalance(Number(result.balance || 0));
  }
  async function usePartyEffect(effect: PartyEffect["effect"]) {
    setEffectError("");
    const response = await fetch("/api/party-effects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, effect }),
    });
    const result = (await response.json().catch(() => null)) as {
      balance?: number;
      error?: string;
      event?: PartyEffect & { type: string };
    } | null;
    if (!response.ok || !result?.event) {
      setEffectError(result?.error || "방해권을 사용하지 못했습니다.");
      return;
    }
    setPointBalance(Number(result.balance || 0));
    send(result.event);
  }
  async function voteMission(missionId: string, vote: "success" | "fail") {
    if (!discordConnected) {
      location.href = `/api/auth/discord?returnTo=${encodeURIComponent(`/live?room=${room}`)}`;
      return;
    }
    const response = await fetch("/api/missions/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, vote }),
    });
    if (response.status === 401) {
      location.href = `/api/auth/discord?returnTo=${encodeURIComponent(`/live?room=${room}`)}`;
      return;
    }
    await refreshMyVotes(room);
  }
  const submitChat = (e: FormEvent) => {
    e.preventDefault();
    if (chat.trim()) {
      send({ type: "chat", name: nickname, text: chat });
      setChat("");
    }
  };
  const addMission = (e: FormEvent) => {
    e.preventDefault();
    if (missionTitle.trim()) {
      const naturalMinutes = Number(
        missionTitle.match(/(\d{1,4})\s*분\s*(?:안|내)/)?.[1] || 0,
      );
      const effectiveType =
        missionType === "time_attack" || naturalMinutes > 0
          ? "time_attack"
          : "normal";
      const effectiveMinutes = naturalMinutes || missionMinutes;
      send({
        type: "mission-create",
        name: nickname,
        title: missionTitle,
        clientKey,
        missionType: effectiveType,
        durationSeconds:
          effectiveType === "time_attack" ? effectiveMinutes * 60 : null,
      });
      setMissionTitle("");
    }
  };
  const requestMissionEnd = (missionId: string) =>
    send({ type: "mission-end-request", missionId, clientKey });
  const approveMissionEnd = (missionId: string) =>
    send({ type: "mission-end-approve", missionId, clientKey });
  const remainingTime = (mission: Mission) => {
    const naturalMinutes = Number(
      mission.title.match(/(\d{1,4})\s*분\s*(?:안|내)/)?.[1] || 0,
    );
    const inferredEnd =
      !mission.endsAt && naturalMinutes > 0 && mission.startedAt
        ? new Date(mission.startedAt).getTime() + naturalMinutes * 60_000
        : null;
    const endTime = mission.endsAt
      ? new Date(mission.endsAt).getTime()
      : inferredEnd;
    if (!endTime) return null;
    if (!now) return "--:--";
    const seconds = Math.max(0, Math.ceil((endTime - now) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };
  const isTimeAttack = (mission: Mission) =>
    mission.type === "time_attack" || remainingTime(mission) !== null;
  const activeMissions = missions.filter(
    (mission) => mission.status === "active",
  );
  const representativeMission = activeMissions[0];
  const toggleAudio = () => {
    if (video.current) {
      video.current.muted = audio;
      setAudio(!audio);
      video.current.play().catch(() => {});
    }
  };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await playerContainer.current?.requestFullscreen();
  };
  const changeQuality = (value: string) => {
    setQuality(value);
    send({ type: "quality-request", quality: value });
  };
  const copyRoomCode = async () => {
    await navigator.clipboard.writeText(room);
    setCopyToastOpen(true);
  };
  const confirmNickname = (e: FormEvent) => {
    e.preventDefault();
    const nextNickname = nicknameDraft.trim();
    if (nextNickname) setNickname(nextNickname);
  };
  return (
    <Toast.Provider swipeDirection="down" duration={2600}>
      <main className="site dark party-room">
        <header className="topbar">
          <Link className="brand" href="/">
            <img className="brand-mark" src="/icon.png" alt="" />
            <span>
              PLAY<span>STAGE</span>
            </span>
          </Link>
          <div className="room-header-meta">
            🔒 방 코드 <b>{room}</b>
            <button type="button" onClick={copyRoomCode}>
              복사
            </button>
          </div>
          <div className="profile">
            <PersonIcon />
            <span>{nickname || "닉네임 설정 중"}</span>
          </div>
        </header>
        <div className="layout realtime-layout">
          <section className="broadcast">
            <div className="player realtime-player" ref={playerContainer}>
              <video ref={video} playsInline autoPlay muted />
              <PartyOverlay
                items={overlay}
                send={(item) => send({ type: "overlay", item })}
                effect={partyEffect}
              />
              <div
                className={status === "LIVE" ? "live-badge" : "stream-status"}
              >
                {status}
              </div>
              <div className="player-controls">
                <button
                  type="button"
                  className="audio-toggle"
                  onClick={toggleAudio}
                >
                  <SpeakerLoudIcon /> {audio ? "소리 끄기" : "소리 켜기"}
                </button>
                <div className="player-control-spacer" />
                <Select.Root value={quality} onValueChange={changeQuality}>
                  <Select.Trigger
                    className="quality-select-trigger"
                    aria-label="방송 화질 선택"
                  >
                    <Select.Value />
                    <Select.Icon>
                      <ChevronDownIcon />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content
                      className="quality-select-content"
                      position="popper"
                      sideOffset={6}
                    >
                      <Select.Viewport>
                        {[
                          ["auto", "자동"],
                          ["1080", "1080p"],
                          ["720", "720p"],
                          ["480", "480p"],
                        ].map(([value, label]) => (
                          <Select.Item
                            className="quality-select-item"
                            value={value}
                            key={value}
                          >
                            <Select.ItemText>{label}</Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
                <button
                  type="button"
                  className="fullscreen-toggle"
                  onClick={() => void toggleFullscreen()}
                  aria-label={fullscreen ? "전체화면 종료" : "전체화면"}
                  title={fullscreen ? "전체화면 종료" : "전체화면"}
                >
                  {fullscreen ? (
                    <ExitFullScreenIcon />
                  ) : (
                    <EnterFullScreenIcon />
                  )}
                </button>
              </div>
            </div>
            <div className="party-effect-shop">
              <div>
                <LightningBoltIcon /> <span>화면 방해권</span>
                <b>{pointBalance}P</b>
              </div>
              <button
                type="button"
                onClick={() => void usePartyEffect("sticker_rain")}
              >
                😂 이모지 폭우 <small>15P</small>
              </button>
              <button
                type="button"
                onClick={() => void usePartyEffect("shake")}
              >
                💥 흔들기 <small>20P</small>
              </button>
              <button type="button" onClick={() => void usePartyEffect("blur")}>
                🌫️ 흐리기 <small>30P</small>
              </button>
              <button
                type="button"
                onClick={() => void usePartyEffect("blackout")}
              >
                🌑 암전 <small>35P</small>
              </button>
              {effectError && (
                <span className="party-effect-error">{effectError}</span>
              )}
            </div>
            <div className="stream-title">
              <div>
                <span className="party-pill">FRIENDS PARTY</span>
                <h1>{roomTitle}</h1>
                <p>친구들끼리 미션 걸고 플레이</p>
              </div>
            </div>
            <div className="active-mission-strip">
              <TargetIcon />
              <div>
                <span>
                  진행 중인 대표 미션
                  {activeMissions.length > 1 &&
                    ` · 다음 미션 ${activeMissions.length - 1}개 대기`}
                </span>
                <b>
                  {representativeMission?.title || "아직 등록된 미션이 없어요"}
                </b>
              </div>
              {representativeMission && isTimeAttack(representativeMission) && (
                <strong className="representative-countdown">
                  <ClockIcon /> {remainingTime(representativeMission)}
                </strong>
              )}
            </div>
          </section>
          <aside className="sidebar">
            <Tabs.Root className="party-tabs panel" defaultValue="mission">
              <Tabs.List className="party-tab-list">
                <Tabs.Trigger value="mission">
                  <TargetIcon /> 미션 <span>{missions.length}</span>
                </Tabs.Trigger>
                <Tabs.Trigger value="chat">
                  <ChatBubbleIcon /> 채팅{" "}
                  <i className={connected ? "online" : ""} />
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="mission" className="party-tab-content">
                <form className="mission-form" onSubmit={addMission}>
                  <div className="mission-type-switch" aria-label="미션 방식">
                    <button
                      type="button"
                      className={missionType === "normal" ? "active" : ""}
                      onClick={() => setMissionType("normal")}
                    >
                      일반
                    </button>
                    <button
                      type="button"
                      className={missionType === "time_attack" ? "active" : ""}
                      onClick={() => setMissionType("time_attack")}
                    >
                      <ClockIcon /> 타임어택
                    </button>
                  </div>
                  <input
                    value={missionTitle}
                    onChange={(e) => setMissionTitle(e.target.value)}
                    placeholder={
                      missionType === "time_attack"
                        ? "예: 10분 안에 보스 클리어"
                        : "친구에게 미션 걸기"
                    }
                  />
                  {missionType === "time_attack" && (
                    <label className="mission-duration">
                      제한시간
                      <input
                        type="number"
                        min="1"
                        max="1440"
                        value={missionMinutes}
                        onChange={(event) =>
                          setMissionMinutes(
                            Math.min(
                              1440,
                              Math.max(1, Number(event.target.value) || 1),
                            ),
                          )
                        }
                      />
                      분
                    </label>
                  )}
                  <button disabled={!missionTitle.trim()}>
                    <PlusIcon /> 등록
                  </button>
                </form>
                <div className="mission-list">
                  {missions.length === 0 && (
                    <p className="empty-missions">
                      첫 번째 미션을 등록해 보세요.
                    </p>
                  )}
                  {missions.map((m) => (
                    <article
                      className={`mission-card ${m.status !== "active" ? "ended" : ""}`}
                      key={m.id}
                    >
                      <div>
                        <span>
                          {m.status !== "active"
                            ? "종료됨"
                            : isTimeAttack(m)
                              ? "타임어택"
                              : "진행 중"}
                        </span>
                        <small>제안자 · {m.creator}</small>
                      </div>
                      <h3>{m.title}</h3>
                      {isTimeAttack(m) && (
                        <div
                          className={`mission-countdown ${remainingTime(m) === "00:00" ? "expired" : ""}`}
                        >
                          <ClockIcon />
                          <strong>{remainingTime(m)}</strong>
                          <span>
                            {remainingTime(m) === "00:00"
                              ? "시간 종료"
                              : "남음"}
                          </span>
                        </div>
                      )}
                      {m.status === "active" && m.endRequestedAt ? (
                        <div className="mission-end-consensus">
                          <p>
                            종료 동의 {m.endApprovalCount}/{m.endRequiredCount}
                          </p>
                          {m.creatorClientId !== clientKey && (
                            <button
                              type="button"
                              onClick={() => approveMissionEnd(m.id)}
                            >
                              종료에 동의
                            </button>
                          )}
                        </div>
                      ) : m.status === "active" &&
                        m.creatorClientId === clientKey ? (
                        <button
                          type="button"
                          className="mission-end-request"
                          onClick={() => requestMissionEnd(m.id)}
                        >
                          미션 종료 요청
                        </button>
                      ) : null}
                      <div className="vote-buttons">
                        <button
                          type="button"
                          disabled={
                            m.status !== "active" || Boolean(myVotes[m.id])
                          }
                          title={
                            myVotes[m.id] ? "이미 투표한 미션입니다" : undefined
                          }
                          onClick={() => void voteMission(m.id, "success")}
                        >
                          성공 {m.success}
                        </button>
                        <button
                          type="button"
                          disabled={
                            m.status !== "active" || Boolean(myVotes[m.id])
                          }
                          title={
                            myVotes[m.id] ? "이미 투표한 미션입니다" : undefined
                          }
                          onClick={() => void voteMission(m.id, "fail")}
                        >
                          실패 {m.fail}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </Tabs.Content>
              <Tabs.Content value="chat" className="party-tab-content chat-tab">
                <div className="messages">
                  {messages.map((m) => (
                    <p key={m.id}>
                      <span className="mini-avatar">P</span>
                      <b>{m.name}</b> {m.text}
                    </p>
                  ))}
                </div>
                <form onSubmit={submitChat}>
                  <input
                    value={chat}
                    onChange={(e) => setChat(e.target.value)}
                    placeholder="메시지를 입력하세요"
                  />
                  <button disabled={!chat.trim()}>
                    <span>전송</span>
                    <ArrowRightIcon />
                  </button>
                </form>
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        </div>
      </main>
      <Dialog.Root open={roomAvailable === true && !nickname}>
        <Dialog.Portal>
          <Dialog.Overlay className="party-dialog-overlay" />
          <Dialog.Content
            className="party-dialog nickname-dialog"
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <Dialog.Title>파티에서 사용할 닉네임</Dialog.Title>
            <Dialog.Description>
              친구들에게 표시될 이름을 입력해 주세요.
            </Dialog.Description>
            <a
              className="discord-nickname-button"
              href={`/api/auth/discord?returnTo=${encodeURIComponent(`/live?room=${room}`)}`}
            >
              <DiscordLogoIcon /> Discord 닉네임으로 입장
            </a>
            <div className="nickname-divider">
              <span>또는</span>
            </div>
            <form onSubmit={confirmNickname}>
              <label htmlFor="party-nickname">닉네임</label>
              <input
                id="party-nickname"
                value={nicknameDraft}
                onChange={(e) => setNicknameDraft(e.target.value)}
                maxLength={12}
                autoFocus
                autoComplete="off"
                placeholder="예: 민수"
              />
              <small>{nicknameDraft.length}/12</small>
              <button type="submit" disabled={!nicknameDraft.trim()}>
                파티 입장
              </button>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={roomAvailable === false}>
        <Dialog.Portal>
          <Dialog.Overlay className="party-dialog-overlay" />
          <Dialog.Content
            className="party-dialog ended-room-dialog"
            onEscapeKeyDown={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <Dialog.Title>종료된 방송입니다.</Dialog.Title>
            <Dialog.Description>
              존재하지 않거나 호스트가 종료한 파티예요.
            </Dialog.Description>
            <Link href="/">메인으로 돌아가기</Link>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Toast.Root
        className="room-copy-toast"
        open={copyToastOpen}
        onOpenChange={setCopyToastOpen}
      >
        <CheckCircledIcon aria-hidden="true" />
        <div>
          <Toast.Title className="room-copy-toast-title">
            복사되었습니다.
          </Toast.Title>
          <Toast.Description className="room-copy-toast-description">
            방 코드를 친구에게 공유해 보세요.
          </Toast.Description>
        </div>
      </Toast.Root>
      <Toast.Viewport className="room-toast-viewport" />
    </Toast.Provider>
  );
}

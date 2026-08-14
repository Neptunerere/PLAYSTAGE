"use client";
import Link from "next/link";
import {
  ChatBubbleIcon,
  CheckCircledIcon,
  ChevronDownIcon,
  ClockIcon,
  DiscordLogoIcon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  PaperPlaneIcon,
  PersonIcon,
  PlusIcon,
  SpeakerLoudIcon,
  TargetIcon,
} from "@radix-ui/react-icons";
import { Dialog, Select, Tabs, Toast } from "radix-ui";
import { FormEvent, useEffect, useRef, useState } from "react";
import PartyOverlay, { OverlayItem } from "../components/party-overlay";
type Chat = { id: string; name: string; text: string };
type Mission = {
  id: string;
  title: string;
  creator: string;
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
};
const iceDone = (pc: RTCPeerConnection) =>
  pc.iceGatheringState === "complete"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const f = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", f);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", f);
      });
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
    [messages, setMessages] = useState<Chat[]>([]),
    [overlay, setOverlay] = useState<OverlayItem[]>([]),
    [missions, setMissions] = useState<Mission[]>([]),
    [copyToastOpen, setCopyToastOpen] = useState(false),
    [nickname, setNickname] = useState(""),
    [nicknameDraft, setNicknameDraft] = useState(""),
    [roomAvailable, setRoomAvailable] = useState<boolean | null>(null),
    [quality, setQuality] = useState("auto"),
    [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
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
          room?: { title?: string };
        };
        setRoomAvailable(true);
        if (result.room?.title) setRoomTitle(result.room.title);
      } catch {
        if (!cancelled) setRoomAvailable(false);
        return;
      }

      const currentWs = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${process.env.NODE_ENV === "production" ? "/api/ws" : "/ws"}?room=${encodeURIComponent(r)}&role=viewer`,
      );
      ws = currentWs;
      socket.current = currentWs;
      currentWs.onopen = () => {
        reconnectDelay = 1000;
        setConnected(true);
        currentWs.send(JSON.stringify({ type: "viewer-ready" }));
      };
      currentWs.onclose = () => {
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
          const pc = new RTCPeerConnection({ iceServers: [] });
          peer.current = pc;
          pc.ontrack = ({ streams }) => {
            if (video.current && streams[0]) {
              video.current.srcObject = streams[0];
              video.current.muted = true;
              video.current.play().catch(() => {});
            }
            setStatus("LIVE");
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
        else if (m.type === "mission-updated" && m.mission)
          setMissions((v) =>
            v.map((x) => (x.id === m.mission!.id ? m.mission! : x)),
          );
        else if (m.type === "overlay" && m.item)
          setOverlay((v) =>
            m.item!.kind === "clear"
              ? []
              : [...v.filter((x) => Date.now() - x.createdAt < 6000), m.item!],
          );
        else if (m.type === "broadcast-started") {
          setStatus("호스트의 화면을 다시 연결하는 중");
          currentWs.send(JSON.stringify({ type: "viewer-ready" }));
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
      ws?.close();
      peer.current?.close();
    };
  }, []);
  const send = (v: object) =>
    socket.current?.readyState === WebSocket.OPEN &&
    socket.current.send(JSON.stringify(v));
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
      send({ type: "mission-create", name: nickname, title: missionTitle });
      setMissionTitle("");
    }
  };
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
            <PersonIcon /> {nickname || "닉네임 설정 중"}
          </div>
        </header>
        <div className="layout realtime-layout">
          <section className="broadcast">
            <div className="player realtime-player" ref={playerContainer}>
              <video ref={video} playsInline autoPlay muted />
              <PartyOverlay
                items={overlay}
                send={(item) => send({ type: "overlay", item })}
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
            <div className="stream-title">
              <div>
                <span className="party-pill">FRIENDS PARTY</span>
                <h1>{roomTitle}</h1>
                <p>친구들끼리 미션 걸고 플레이</p>
              </div>
              <Link className="studio-link" href={`/studio?room=${room}`}>
                호스트 화면
              </Link>
            </div>
            <div className="active-mission-strip">
              <TargetIcon />
              <div>
                <span>진행 중인 대표 미션</span>
                <b>{missions[0]?.title || "아직 등록된 미션이 없어요"}</b>
              </div>
              {missions.length > 0 && <ClockIcon />}
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
                  <input
                    value={missionTitle}
                    onChange={(e) => setMissionTitle(e.target.value)}
                    placeholder="친구에게 미션 걸기"
                  />
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
                    <article className="mission-card" key={m.id}>
                      <div>
                        <span>진행 중</span>
                        <small>제안자 · {m.creator}</small>
                      </div>
                      <h3>{m.title}</h3>
                      <div className="vote-buttons">
                        <button
                          onClick={() =>
                            send({
                              type: "mission-vote",
                              missionId: m.id,
                              vote: "success",
                            })
                          }
                        >
                          성공 {m.success}
                        </button>
                        <button
                          onClick={() =>
                            send({
                              type: "mission-vote",
                              missionId: m.id,
                              vote: "fail",
                            })
                          }
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
                    <PaperPlaneIcon />
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

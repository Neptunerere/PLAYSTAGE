"use client";

import Link from "next/link";
import {
  ChatBubbleIcon,
  CheckCircledIcon,
  CopyIcon,
  DesktopIcon,
  DiscordLogoIcon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  Link2Icon,
  PauseIcon,
  PersonIcon,
  PlayIcon,
  SpeakerLoudIcon,
  SpeakerOffIcon,
  StopIcon,
  TargetIcon,
  TrashIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { Tabs, Toast } from "radix-ui";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import PartyOverlay, { OverlayItem } from "../components/party-overlay";

type Mission = {
  id: string;
  title: string;
  creator: string;
  status: string;
  success: number;
  fail: number;
};
type Msg = {
  type: string;
  id?: string;
  from?: string;
  name?: string;
  text?: string;
  answer?: RTCSessionDescriptionInit;
  item?: OverlayItem;
  quality?: "auto" | "1080" | "720" | "480";
  role?: "broadcaster" | "viewer";
  mission?: Mission;
  missions?: Mission[];
};
type Chat = { id: string; name: string; text: string };

function preventInvalidRoomCodeInput(event: FormEvent<HTMLInputElement>) {
  const value = (event.nativeEvent as InputEvent).data;
  if (value && /[^a-zA-Z0-9-]/.test(value)) event.preventDefault();
}
function preventInvalidRoomCodeKey(event: KeyboardEvent<HTMLInputElement>) {
  if (
    event.nativeEvent.isComposing ||
    event.key === "Process" ||
    (event.key.length === 1 && !/[a-zA-Z0-9-]/.test(event.key))
  )
    event.preventDefault();
}
function createRoomCode(length = 20) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}
const iceDone = (pc: RTCPeerConnection) =>
  pc.iceGatheringState === "complete"
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const done = () => {
          if (pc.iceGatheringState === "complete") {
            pc.removeEventListener("icegatheringstatechange", done);
            resolve();
          }
        };
        pc.addEventListener("icegatheringstatechange", done);
      });

export default function Studio() {
  const preview = useRef<HTMLVideoElement>(null);
  const previewShell = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const roomCreated = useRef(false);
  const stopping = useRef(false);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const heartbeatTimer = useRef<number | undefined>(undefined);
  const reconnectDelay = useRef(1000);
  const peers = useRef(new Map<string, RTCPeerConnection>());

  const [room, setRoom] = useState("");
  const [roomTitle, setRoomTitle] = useState("");
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [connection, setConnection] = useState("대기 중");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overlay, setOverlay] = useState<OverlayItem[]>([]);
  const [messages, setMessages] = useState<Chat[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [participants, setParticipants] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = new URLSearchParams(location.search).get("room");
    const requested = raw?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
    setRoom(requested || createRoomCode());
    const onFullscreen = () => setFullscreen(document.fullscreenElement === previewShell.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      cleanupResources(false);
    };
  }, []);

  function send(payload: object) {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(payload));
  }

  function syncViewerCount() {
    setViewers(
      [...peers.current.values()].filter((peer) => peer.connectionState === "connected")
        .length,
    );
  }

  async function offer(id: string, ws: WebSocket, source: MediaStream) {
    peers.current.get(id)?.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.current.set(id, pc);
    source.getTracks().forEach((track) => pc.addTrack(track, source));
    pc.onconnectionstatechange = syncViewerCount;
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    ws.send(JSON.stringify({ type: "offer", target: id, offer: pc.localDescription }));
  }

  function connectBroadcaster(source: MediaStream) {
    setConnection("연결 중");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${process.env.NODE_ENV === "production" ? "/api/ws" : "/ws"}?room=${encodeURIComponent(room)}&role=broadcaster`,
    );
    socket.current = ws;
    ws.onopen = () => {
      reconnectDelay.current = 1000;
      setConnection("연결됨");
      setLive(true);
      ws.send(JSON.stringify({ type: "room-info", title: roomTitle.trim() }));
      ws.send(JSON.stringify({ type: "missions-request" }));
    };
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data) as Msg;
      if (message.type === "viewer-ready" && message.from) {
        setParticipants((current) => ({
          ...current,
          [message.from!]: current[message.from!] || "친구",
        }));
        await offer(message.from, ws, source);
      } else if (message.type === "viewer-profile" && message.from && message.name) {
        setParticipants((current) => ({ ...current, [message.from!]: message.name! }));
      } else if (message.type === "peer-left" && message.from && message.role === "viewer") {
        peers.current.get(message.from)?.close();
        peers.current.delete(message.from);
        setParticipants((current) => {
          const next = { ...current };
          delete next[message.from!];
          return next;
        });
        syncViewerCount();
      } else if (message.type === "answer" && message.from && message.answer) {
        await peers.current.get(message.from)?.setRemoteDescription(message.answer);
      } else if (message.type === "overlay" && message.item) {
        setOverlay((current) =>
          message.item!.kind === "clear"
            ? []
            : [...current.filter((item) => Date.now() - item.createdAt < 6000), message.item!],
        );
      } else if (message.type === "chat" && message.id && message.name && message.text) {
        setMessages((current) => [
          ...current.slice(-99),
          { id: message.id!, name: message.name!, text: message.text! },
        ]);
      } else if (message.type === "missions-sync" && message.missions) {
        setMissions(message.missions);
      } else if (message.type === "mission" && message.mission) {
        setMissions((current) => [message.mission!, ...current]);
      } else if (message.type === "mission-updated" && message.mission) {
        setMissions((current) =>
          current.map((mission) =>
            mission.id === message.mission!.id ? message.mission! : mission,
          ),
        );
      } else if (message.type === "quality-request" && message.quality) {
        const track = source.getVideoTracks()[0];
        const sizes = {
          "1080": { width: 1920, height: 1080 },
          "720": { width: 1280, height: 720 },
          "480": { width: 854, height: 480 },
        } as const;
        const size = message.quality === "auto" ? null : sizes[message.quality];
        await track
          ?.applyConstraints(
            size
              ? { width: { ideal: size.width }, height: { ideal: size.height }, frameRate: { ideal: 30 } }
              : { frameRate: { ideal: 30 } },
          )
          .catch(() => {});
      }
    };
    ws.onclose = () => {
      setConnection("재연결 중");
      setLive(false);
      if (stream.current === source && !stopping.current) {
        reconnectTimer.current = window.setTimeout(
          () => connectBroadcaster(source),
          reconnectDelay.current,
        );
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
      }
    };
  }

  function bindStream(source: MediaStream) {
    stream.current = source;
    setAudioEnabled(source.getAudioTracks().some((track) => track.enabled));
    setPaused(false);
    if (preview.current) preview.current.srcObject = source;
    const videoTrack = source.getVideoTracks()[0];
    if (videoTrack) videoTrack.onended = () => void stop();
  }

  async function pickScreen() {
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
  }

  async function start() {
    stopping.current = false;
    setError("");
    try {
      const source = await pickScreen();
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: roomTitle.trim(), code: room }),
      });
      if (!response.ok) {
        source.getTracks().forEach((track) => track.stop());
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "방 정보를 저장하지 못했습니다.");
      }
      roomCreated.current = true;
      heartbeatTimer.current = window.setInterval(() => {
        void fetch(`/api/rooms/${encodeURIComponent(room)}`, {
          method: "PATCH",
          cache: "no-store",
        });
      }, 10_000);
      bindStream(source);
      connectBroadcaster(source);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "화면 공유를 시작하지 못했습니다.");
    }
  }

  async function switchScreen() {
    try {
      const next = await pickScreen();
      const previous = stream.current;
      previous?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      peers.current.forEach((peer) => peer.close());
      peers.current.clear();
      bindStream(next);
      send({ type: "screen-changed" });
      setNotice("공유 화면을 전환했습니다.");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotAllowedError") return;
      setError("화면을 전환하지 못했습니다.");
    }
  }

  function togglePause() {
    const next = !paused;
    stream.current?.getVideoTracks().forEach((track) => (track.enabled = !next));
    setPaused(next);
    send({ type: next ? "broadcast-paused" : "broadcast-resumed" });
  }

  function toggleAudio() {
    const tracks = stream.current?.getAudioTracks() || [];
    if (!tracks.length) {
      setNotice("현재 공유에는 시스템 소리가 포함되지 않았습니다.");
      return;
    }
    const next = !audioEnabled;
    tracks.forEach((track) => (track.enabled = next));
    setAudioEnabled(next);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await previewShell.current?.requestFullscreen();
  }

  function clearOverlay() {
    setOverlay([]);
    send({ type: "overlay", item: { kind: "clear" } });
  }

  async function copy(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    setNotice(message);
  }

  async function notifyDiscord() {
    const response = await fetch(`/api/rooms/${encodeURIComponent(room)}/discord`, {
      method: "POST",
    });
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    setNotice(response.ok ? "Discord 채널에 방송 알림을 보냈습니다." : result?.error || "알림을 보내지 못했습니다.");
  }

  function cleanupResources(updateState = true) {
    stopping.current = true;
    window.clearTimeout(reconnectTimer.current);
    window.clearInterval(heartbeatTimer.current);
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
    socket.current?.close();
    socket.current = null;
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    if (preview.current) preview.current.srcObject = null;
    if (updateState) {
      setLive(false);
      setPaused(false);
      setViewers(0);
      setParticipants({});
      setConnection("종료됨");
    }
  }

  async function stop() {
    if (stopping.current) return;
    stopping.current = true;
    cleanupResources();
    if (roomCreated.current) {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(room)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404)
          throw new Error("방 정보를 삭제하지 못했습니다.");
        roomCreated.current = false;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "방 정보를 삭제하지 못했습니다.");
      }
    }
    stopping.current = false;
  }

  const activeMission = missions.find((mission) => mission.status === "active") || missions[0];
  const settingsDisabled = live || Boolean(stream.current);
  const inviteUrl = typeof window === "undefined" ? "" : `${location.origin}/live?room=${room}`;
  const videoTrack = stream.current?.getVideoTracks()[0];
  const settings = videoTrack?.getSettings();

  return (
    <Toast.Provider swipeDirection="down" duration={2600}>
      <main className={`studio-page ${settingsDisabled ? "is-live" : "is-setup"}`}>
        <header>
          <Link className="brand" href="/">
            <img className="brand-mark" src="/icon.png" alt="" />
            <span>PLAY<span>STAGE</span></span>
          </Link>
          <div className="studio-header-links">
            <button type="button" onClick={() => void copy(inviteUrl, "시청 링크를 복사했습니다.")} disabled={!room}>
              <Link2Icon /> 시청 링크 복사
            </button>
            <Link href={`/live?room=${encodeURIComponent(room)}`}>시청 화면 열기 →</Link>
          </div>
        </header>

        <div className="studio-shell">
          <section className="studio-console">
            {!settingsDisabled ? (
              <div className="studio-heading">
                <div className="discord-bot-guide">
                  <div className="discord-channel-icon"><DiscordLogoIcon /></div>
                  <div>
                    <b>Discord 채널과 함께 쓰기</b>
                    <p>봇을 설치하고 /party를 실행하면 미션·투표·포인트가 실시간으로 연결돼요.</p>
                  </div>
                  <a href="/api/discord/install">봇 설치</a>
                </div>
                <div className="studio-heading-copy">
                  <span>방송 설정</span>
                  <p>친구에게 보여줄 방송 정보를 입력하세요.</p>
                </div>
                <div className="studio-heading-row">
                  <div className="studio-controls">
                    <label>
                      방 제목
                      <input autoFocus value={roomTitle} onChange={(event) => setRoomTitle(event.target.value.slice(0, 50))} placeholder="예: 금요일 저녁 게임 파티" maxLength={50} />
                    </label>
                    <label>
                      방 코드
                      <input value={room} onChange={(event) => setRoom(event.target.value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20))} onBeforeInput={preventInvalidRoomCodeInput} onKeyDown={preventInvalidRoomCodeKey} inputMode="text" pattern="[A-Za-z0-9-]+" maxLength={20} autoCapitalize="none" spellCheck={false} />
                    </label>
                    <button className="start-button" onClick={() => void start()} disabled={!room || !roomTitle.trim()}>
                      <DesktopIcon /> 화면 공유 시작
                    </button>
                  </div>
                  <span className="studio-live">OFFLINE</span>
                </div>
              </div>
            ) : (
              <div className="studio-session-bar">
                <div>
                  <span className="studio-live on">LIVE · {viewers}명</span>
                  <div><b>{roomTitle}</b><small>{room}</small></div>
                </div>
                <div className="studio-health">
                  <span className={connection === "연결됨" ? "healthy" : ""}>● {connection}</span>
                  <span>{settings?.width || "자동"}×{settings?.height || "자동"}</span>
                  <span>{audioEnabled ? "시스템 소리 ON" : "시스템 소리 OFF"}</span>
                </div>
              </div>
            )}

            <div className="studio-preview" ref={previewShell}>
              <video ref={preview} autoPlay muted playsInline />
              <PartyOverlay items={overlay} host />
              {!settingsDisabled && <div className="preview-empty"><DesktopIcon /><b>공유할 화면을 선택해 주세요</b></div>}
              {paused && <div className="studio-paused-screen"><PauseIcon /><b>화면 공유 일시정지</b></div>}
              {activeMission && settingsDisabled && (
                <div className="studio-active-mission">
                  <span>진행 중인 미션</span>
                  <b>{activeMission.title}</b>
                  <small>성공 {activeMission.success} · 실패 {activeMission.fail}</small>
                </div>
              )}
              {settingsDisabled && (
                <div className="studio-stage-toolbar">
                  <button type="button" onClick={() => void switchScreen()} title="화면 전환"><UpdateIcon /><span>화면 전환</span></button>
                  <button type="button" onClick={togglePause} title={paused ? "공유 재개" : "일시정지"}>{paused ? <PlayIcon /> : <PauseIcon />}<span>{paused ? "재개" : "일시정지"}</span></button>
                  <button type="button" className={audioEnabled ? "active" : ""} onClick={toggleAudio} title="시스템 소리">{audioEnabled ? <SpeakerLoudIcon /> : <SpeakerOffIcon />}<span>소리</span></button>
                  <button type="button" onClick={clearOverlay} title="낙서 초기화"><TrashIcon /><span>낙서 삭제</span></button>
                  <button type="button" onClick={() => void toggleFullscreen()} title="전체화면">{fullscreen ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}<span>전체화면</span></button>
                  <button type="button" className="danger" onClick={() => void stop()} title="공유 종료"><StopIcon /><span>종료</span></button>
                </div>
              )}
            </div>

            {settingsDisabled && (
              <div className="studio-invite-actions">
                <button type="button" onClick={() => void copy(room, "방 코드를 복사했습니다.")}><CopyIcon /> 코드 복사</button>
                <button type="button" onClick={() => void copy(inviteUrl, "시청 링크를 복사했습니다.")}><Link2Icon /> 링크 복사</button>
                <button type="button" onClick={() => void notifyDiscord()}><DiscordLogoIcon /> Discord에 다시 알림</button>
              </div>
            )}
            {error && <p className="studio-error">{error}</p>}
          </section>

          <aside className="studio-chat studio-side-panel">
            <Tabs.Root defaultValue="chat">
              <Tabs.List className="studio-tab-list">
                <Tabs.Trigger value="chat"><ChatBubbleIcon /> 채팅 <span>{messages.length}</span></Tabs.Trigger>
                <Tabs.Trigger value="missions"><TargetIcon /> 미션 <span>{missions.length}</span></Tabs.Trigger>
                <Tabs.Trigger value="people"><PersonIcon /> 참가자 <span>{Object.keys(participants).length}</span></Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="chat" className="studio-tab-content">
                {messages.length === 0 ? <p className="studio-empty">친구들이 보낸 채팅이 여기에 표시됩니다.</p> : messages.map((message) => <article key={message.id}><b>{message.name}</b><span>{message.text}</span></article>)}
              </Tabs.Content>
              <Tabs.Content value="missions" className="studio-tab-content studio-mission-list">
                {missions.length === 0 ? <p className="studio-empty">친구가 미션을 등록하면 여기에 표시됩니다.</p> : missions.map((mission) => <article key={mission.id}><div><span>{mission.status === "active" ? "진행 중" : "결과 확정"}</span><small>제안자 · {mission.creator}</small></div><b>{mission.title}</b><p><em>성공 {mission.success}</em><em>실패 {mission.fail}</em></p></article>)}
              </Tabs.Content>
              <Tabs.Content value="people" className="studio-tab-content studio-participant-list">
                {Object.keys(participants).length === 0 ? <p className="studio-empty">아직 입장한 친구가 없습니다.</p> : Object.entries(participants).map(([id, name]) => <article key={id}><span className="studio-avatar">P</span><div><b>{name}</b><small>시청 중 · 연결됨</small></div><i /></article>)}
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        </div>
      </main>

      <Toast.Root className="room-copy-toast" open={Boolean(notice)} onOpenChange={(open) => !open && setNotice("")}>
        <CheckCircledIcon aria-hidden="true" />
        <Toast.Title>{notice}</Toast.Title>
      </Toast.Root>
      <Toast.Viewport className="room-toast-viewport" />
    </Toast.Provider>
  );
}

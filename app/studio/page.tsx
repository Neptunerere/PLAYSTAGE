"use client";
import Link from "next/link";
import { DesktopIcon, StopIcon } from "@radix-ui/react-icons";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import PartyOverlay, { OverlayItem } from "../components/party-overlay";

type Msg = {
  type: string;
  id?: string;
  from?: string;
  name?: string;
  text?: string;
  answer?: RTCSessionDescriptionInit;
  item?: OverlayItem;
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
  ) {
    event.preventDefault();
  }
}

function createRoomCode(length = 20) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}
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

export default function Studio() {
  const preview = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    socket = useRef<WebSocket | null>(null),
    roomCreated = useRef(false),
    stopping = useRef(false),
    peers = useRef(new Map<string, RTCPeerConnection>());
  const [room, setRoom] = useState(""),
    [roomTitle, setRoomTitle] = useState(""),
    [live, setLive] = useState(false),
    [viewers, setViewers] = useState(0),
    [error, setError] = useState(""),
    [overlay, setOverlay] = useState<OverlayItem[]>([]),
    [messages, setMessages] = useState<Chat[]>([]);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get("room");
    const requestedRoom = r?.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
    setRoom(requestedRoom || createRoomCode());
    return () => cleanupResources(false);
  }, []);
  async function offer(id: string, ws: WebSocket, s: MediaStream) {
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.current.set(id, pc);
    s.getTracks().forEach((t) => pc.addTrack(t, s));
    pc.onconnectionstatechange = () =>
      setViewers(
        [...peers.current.values()].filter(
          (p) => p.connectionState === "connected",
        ).length,
      );
    await pc.setLocalDescription(await pc.createOffer());
    await iceDone(pc);
    ws.send(
      JSON.stringify({ type: "offer", target: id, offer: pc.localDescription }),
    );
  }
  async function start() {
    setError("");
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });

      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: roomTitle.trim(), code: room }),
      });

      if (!response.ok) {
        s.getTracks().forEach((track) => track.stop());
        const result = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(result?.error || "방 정보를 저장하지 못했습니다.");
      }

      roomCreated.current = true;

      stream.current = s;
      if (preview.current) preview.current.srcObject = s;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?room=${encodeURIComponent(room)}&role=broadcaster`,
      );
      socket.current = ws;
      ws.onopen = () => {
        setLive(true);
        ws.send(JSON.stringify({ type: "room-info", title: roomTitle.trim() }));
      };
      ws.onmessage = async (e) => {
        const m = JSON.parse(e.data) as Msg;
        if (m.type === "viewer-ready" && m.from) await offer(m.from, ws, s);
        else if (m.type === "answer" && m.from && m.answer)
          await peers.current.get(m.from)?.setRemoteDescription(m.answer);
        else if (m.type === "overlay" && m.item)
          setOverlay((v) =>
            m.item!.kind === "clear"
              ? []
              : [...v.filter((x) => Date.now() - x.createdAt < 6000), m.item!],
          );
        else if (m.type === "chat" && m.id && m.name && m.text)
          setMessages((current) => [
            ...current.slice(-99),
            { id: m.id!, name: m.name!, text: m.text! },
          ]);
      };
      ws.onclose = () => setLive(false);
      s.getVideoTracks()[0].onended = () => void stop();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "화면 공유를 시작하지 못했습니다.",
      );
    }
  }
  function cleanupResources(updateState = true) {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    socket.current?.close();
    socket.current = null;
    peers.current.forEach((p) => p.close());
    peers.current.clear();
    if (preview.current) preview.current.srcObject = null;
    if (updateState) {
      setLive(false);
      setViewers(0);
    }
  }

  async function stop() {
    if (stopping.current) return;
    stopping.current = true;

    cleanupResources();

    if (roomCreated.current) {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(room)}`, {
          method: "DELETE",
        });

        if (!response.ok && response.status !== 404) {
          throw new Error("방 정보를 삭제하지 못했습니다.");
        }

        roomCreated.current = false;
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "방 정보를 삭제하지 못했습니다.",
        );
      }
    }

    stopping.current = false;
  }
  return (
    <main className="studio-page">
      <header>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            PLAY<span>STAGE</span>
          </span>
        </Link>
        <Link href={`/live?room=${encodeURIComponent(room)}`}>
          시청 화면 열기 →
        </Link>
      </header>
      <div className="studio-shell">
        <section>
          <div className="studio-heading">
            <div className="studio-heading-copy">
              <span>방송 설정</span>
              <p>친구에게 보여줄 방송 정보를 입력하세요.</p>
            </div>
            <div className="studio-heading-row">
              <div className="studio-controls">
                <label>
                  방 제목
                  <input
                    autoFocus
                    value={roomTitle}
                    onChange={(event) =>
                      setRoomTitle(event.target.value.slice(0, 50))
                    }
                    disabled={live}
                    placeholder="예: 금요일 저녁 게임 파티"
                    maxLength={50}
                  />
                </label>
                <label>
                  방 코드
                  <input
                    value={room}
                    onChange={(event) =>
                      setRoom(
                        event.target.value
                          .replace(/[^a-zA-Z0-9-]/g, "")
                          .slice(0, 20),
                      )
                    }
                    onBeforeInput={preventInvalidRoomCodeInput}
                    onKeyDown={preventInvalidRoomCodeKey}
                    disabled={live}
                    inputMode="text"
                    pattern="[A-Za-z0-9-]+"
                    maxLength={20}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </label>
                {live ? (
                  <button className="stop-button" onClick={() => void stop()}>
                    <StopIcon /> 공유 종료
                  </button>
                ) : (
                  <button
                    className="start-button"
                    onClick={start}
                    disabled={!room || !roomTitle.trim()}
                  >
                    <DesktopIcon /> 화면 공유 시작
                  </button>
                )}
              </div>
              <span className={live ? "studio-live on" : "studio-live"}>
                {live ? `LIVE · ${viewers}명` : `OFFLINE`}
              </span>
            </div>
          </div>
          <div className="studio-preview">
            <video ref={preview} autoPlay muted playsInline />
            <PartyOverlay items={overlay} host />
            <div className="preview-empty">
              <DesktopIcon />
              <b>공유할 화면을 선택해 주세요</b>
            </div>
          </div>
          {error && <p className="studio-error">{error}</p>}
        </section>
        <aside className="studio-chat">
          <div>
            <b>친구 채팅</b>
            <span>{viewers}명 접속</span>
          </div>
          <section>
            {messages.length === 0 ? (
              <p>친구들이 보낸 채팅이 여기에 표시됩니다.</p>
            ) : (
              messages.map((message) => (
                <article key={message.id}>
                  <b>{message.name}</b>
                  <span>{message.text}</span>
                </article>
              ))
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

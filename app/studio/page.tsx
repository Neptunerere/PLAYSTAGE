"use client";
import Link from "next/link";
import { DesktopIcon, StopIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import PartyOverlay, { OverlayItem } from "../components/party-overlay";

type Msg = {
  type: string;
  from?: string;
  answer?: RTCSessionDescriptionInit;
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

export default function Studio() {
  const preview = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    socket = useRef<WebSocket | null>(null),
    peers = useRef(new Map<string, RTCPeerConnection>());
  const [room, setRoom] = useState("pixel-quest"),
    [live, setLive] = useState(false),
    [viewers, setViewers] = useState(0),
    [error, setError] = useState(""),
    [overlay, setOverlay] = useState<OverlayItem[]>([]);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get("room");
    if (r) setRoom(r);
    return () => stop();
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
      stream.current = s;
      if (preview.current) preview.current.srcObject = s;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?room=${encodeURIComponent(room)}&role=broadcaster`,
      );
      socket.current = ws;
      ws.onopen = () => setLive(true);
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
      };
      ws.onclose = () => setLive(false);
      s.getVideoTracks()[0].onended = stop;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "화면 공유를 시작하지 못했습니다.",
      );
    }
  }
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    socket.current?.close();
    socket.current = null;
    peers.current.forEach((p) => p.close());
    peers.current.clear();
    if (preview.current) preview.current.srcObject = null;
    setLive(false);
    setViewers(0);
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
            <div>
              <span>PARTY HOST</span>
              <h1>친구 파티 호스트</h1>
              <p>내 화면과 시스템 소리를 친구들에게 공유합니다.</p>
            </div>
            <span className={live ? "studio-live on" : "studio-live"}>
              {live ? `LIVE · ${viewers}명` : `OFFLINE`}
            </span>
          </div>
          <div className="studio-preview">
            <video ref={preview} autoPlay muted playsInline />
            <PartyOverlay items={overlay} host />
            <div className="preview-empty">
              <DesktopIcon />
              <b>공유할 화면을 선택해 주세요</b>
            </div>
          </div>
          <div className="studio-controls">
            <label>
              방 코드
              <input
                value={room}
                onChange={(e) =>
                  setRoom(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ""))
                }
                disabled={live}
              />
            </label>
            {live ? (
              <button className="stop-button" onClick={stop}>
                <StopIcon /> 공유 종료
              </button>
            ) : (
              <button className="start-button" onClick={start}>
                <DesktopIcon /> 화면 공유 시작
              </button>
            )}
          </div>
          {error && <p className="studio-error">{error}</p>}
        </section>
        <aside className="studio-chat">
          <div>
            <b>친구 반응</b>
            <span>{viewers}명 접속</span>
          </div>
          <section>
            <p>친구들의 핑, 낙서, 이모지가 화면 위에 표시됩니다.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}

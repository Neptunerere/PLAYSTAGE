"use client";
import Link from "next/link";
import {
  ChatBubbleIcon,
  ClockIcon,
  PaperPlaneIcon,
  PersonIcon,
  PlusIcon,
  SpeakerLoudIcon,
  TargetIcon,
} from "@radix-ui/react-icons";
import { Tabs } from "radix-ui";
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
  id?: string;
  from?: string;
  offer?: RTCSessionDescriptionInit;
  name?: string;
  text?: string;
  mission?: Mission;
  missionId?: string;
  vote?: "success" | "fail";
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
    socket = useRef<WebSocket | null>(null),
    peer = useRef<RTCPeerConnection | null>(null);
  const [room, setRoom] = useState("pixel-quest"),
    [status, setStatus] = useState("호스트의 화면 공유를 기다리는 중"),
    [connected, setConnected] = useState(false),
    [audio, setAudio] = useState(false),
    [chat, setChat] = useState(""),
    [missionTitle, setMissionTitle] = useState(""),
    [messages, setMessages] = useState<Chat[]>([]),
    [overlay, setOverlay] = useState<OverlayItem[]>([]),
    [missions, setMissions] = useState<Mission[]>([
      {
        id: "starter",
        title: "30분 안에 첫 보스 클리어",
        creator: "민수",
        success: 2,
        fail: 0,
      },
    ]);
  useEffect(() => {
    const r = new URLSearchParams(location.search).get("room") || "pixel-quest";
    setRoom(r);
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?room=${encodeURIComponent(r)}&role=viewer`,
    );
    socket.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "viewer-ready" }));
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = async (e) => {
      const m = JSON.parse(e.data) as Msg;
      if (m.type === "offer" && m.offer && m.from) {
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
        ws.send(
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
      else if (m.type === "mission" && m.mission)
        setMissions((v) => [m.mission!, ...v]);
      else if (m.type === "mission-vote" && m.missionId && m.vote)
        setMissions((v) =>
          v.map((x) =>
            x.id === m.missionId ? { ...x, [m.vote!]: x[m.vote!] + 1 } : x,
          ),
        );
      else if (m.type === "overlay" && m.item)
        setOverlay((v) =>
          m.item!.kind === "clear"
            ? []
            : [...v.filter((x) => Date.now() - x.createdAt < 6000), m.item!],
        );
      else if (m.type === "broadcast-ended")
        setStatus("호스트가 화면 공유를 종료했습니다");
    };
    return () => {
      ws.close();
      peer.current?.close();
    };
  }, []);
  const send = (v: object) =>
    socket.current?.readyState === WebSocket.OPEN &&
    socket.current.send(JSON.stringify(v));
  const submitChat = (e: FormEvent) => {
    e.preventDefault();
    if (chat.trim()) {
      send({ type: "chat", name: "친구", text: chat });
      setChat("");
    }
  };
  const addMission = (e: FormEvent) => {
    e.preventDefault();
    if (missionTitle.trim()) {
      send({ type: "mission-create", name: "친구", title: missionTitle });
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
  return (
    <main className="site dark party-room">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            PLAY<span>STAGE</span>
          </span>
        </Link>
        <div className="room-header-meta">
          🔒 방 코드 <b>{room}</b>
          <button onClick={() => navigator.clipboard?.writeText(room)}>
            복사
          </button>
        </div>
        <div className="profile">
          <PersonIcon /> 친구
        </div>
      </header>
      <div className="layout realtime-layout">
        <section className="broadcast">
          <div className="player realtime-player">
            <video ref={video} playsInline autoPlay muted />
            <PartyOverlay
              items={overlay}
              send={(item) => send({ type: "overlay", item })}
            />
            <div className={status === "LIVE" ? "live-badge" : "stream-status"}>
              {status}
            </div>
            <div className="player-controls">
              <button className="audio-toggle" onClick={toggleAudio}>
                <SpeakerLoudIcon /> {audio ? "소리 끄기" : "소리 켜기"}
              </button>
            </div>
          </div>
          <div className="stream-title">
            <div>
              <span className="party-pill">FRIENDS PARTY</span>
              <h1>금요일 게임 파티</h1>
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
              <b>{missions[0]?.title}</b>
            </div>
            <span>
              <ClockIcon /> 18:42
            </span>
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
                <button>
                  <PlusIcon /> 등록
                </button>
              </form>
              <div className="mission-list">
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
                <button>
                  <PaperPlaneIcon />
                </button>
              </form>
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>
    </main>
  );
}

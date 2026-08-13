"use client";

import {
  ArrowRightIcon,
  CheckCircledIcon,
  EnterIcon,
  LockClosedIcon,
  PersonIcon,
  PlusIcon,
} from "@radix-ui/react-icons";
import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const missionIdeas = [
  {
    game: "ARPG",
    title: "한대도 안 맞고 보스 클리어 하기",
    meta: "타이머 미션",
    image: "/games/elden-ring.jpg",
    imagePosition: "center 45%",
  },
  {
    game: "AOS",
    title: "이번 판 10킬 달성하기",
    meta: "목표 달성",
    image: "/games/league.png",
    imagePosition: "center 52%",
  },
  {
    game: "FPS",
    title: "오늘의 MVP 뽑기",
    meta: "친구 투표",
    image: "/games/overwatch.png",
    imagePosition: "center 42%",
  },
];

function makeRoomCode() {
  return `party-${Math.random().toString(36).slice(2, 7)}`;
}

export default function PartyHome() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");

  useEffect(() => {
    const howSection = document.getElementById("how");
    const missionsSection = document.getElementById("missions");
    if (!howSection || !missionsSection) return;

    let frameId = 0;

    const updateActiveSection = () => {
      frameId = 0;
      const viewportFocus =
        window.scrollY + 64 + (window.innerHeight - 64) * 0.5;
      const howTop = howSection.offsetTop;
      const missionsTop = missionsSection.offsetTop;
      const howCenter = howTop + howSection.offsetHeight * 0.5;
      const missionsCenter = missionsTop + missionsSection.offsetHeight * 0.5;
      const sectionBoundary = (howCenter + missionsCenter) * 0.5;
      const reachedPageBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 4;

      if (reachedPageBottom || viewportFocus >= sectionBoundary) {
        setActiveSection("missions");
      } else if (viewportFocus >= howTop) {
        setActiveSection("how");
      } else {
        setActiveSection("");
      }
    };

    const handleScroll = () => {
      if (!frameId) frameId = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  function scrollToSection(
    event: React.MouseEvent<HTMLAnchorElement>,
    sectionId: "how" | "missions",
  ) {
    event.preventDefault();
    const section = document.getElementById(sectionId);
    if (!section) return;

    const headerHeight = 64;
    const visibleHeight = window.innerHeight - headerHeight;
    const sectionCenter = section.offsetTop + section.offsetHeight * 0.5;
    const targetTop = Math.max(
      0,
      sectionCenter - headerHeight - visibleHeight * 0.5,
    );

    window.history.replaceState(null, "", `#${sectionId}`);
    setActiveSection(sectionId);
    window.scrollTo({ top: targetTop, behavior: "smooth" });
  }

  function createParty() {
    router.push(`/studio?room=${makeRoomCode()}`);
  }

  function joinParty() {
    const code = roomCode.trim();
    if (code) router.push(`/live?room=${encodeURIComponent(code)}`);
  }

  return (
    <main className="party-home">
      <header className="party-header">
        <a className="brand" href="/">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            PLAY<span>STAGE</span>
          </span>
        </a>
        <nav>
          <a
            href="#how"
            className={activeSection === "how" ? "active" : ""}
            aria-current={activeSection === "how" ? "location" : undefined}
            onClick={(event) => scrollToSection(event, "how")}
          >
            이용 방법
          </a>
          <a
            href="#missions"
            className={activeSection === "missions" ? "active" : ""}
            aria-current={activeSection === "missions" ? "location" : undefined}
            onClick={(event) => scrollToSection(event, "missions")}
          >
            미션 아이디어
          </a>
        </nav>
      </header>

      <section className="party-hero">
        <div className="party-hero-copy">
          <span className="eyebrow">
            <span /> FRIENDS ONLY GAME PARTY
          </span>
          <h1>
            같이 보고,
            <br />
            <em>미션 걸고,</em>
            <br />더 재밌게 플레이
          </h1>
          <p>
            친구들과 비공개 파티를 열어보세요.
            <br />
            화면을 공유하고 미션의 성공 여부를 함께 결정해요.
          </p>
          <div className="hero-actions">
            <button className="create-party" onClick={createParty}>
              <PlusIcon /> 새 파티 만들기
            </button>
            <Dialog.Root open={joinOpen} onOpenChange={setJoinOpen}>
              <Dialog.Trigger asChild>
                <button className="join-party">
                  <EnterIcon /> 방 코드로 참가
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="party-dialog-overlay" />
                <Dialog.Content className="party-dialog">
                  <Dialog.Title>친구 파티에 참가하기</Dialog.Title>
                  <Dialog.Description>
                    친구에게 받은 방 코드를 입력해 주세요.
                  </Dialog.Description>
                  <label>
                    방 코드
                    <input
                      autoFocus
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value)}
                      onKeyDown={(event) =>
                        event.key === "Enter" && joinParty()
                      }
                      placeholder="예: party-a1b2c"
                    />
                  </label>
                  <div>
                    <Dialog.Close asChild>
                      <button>취소</button>
                    </Dialog.Close>
                    <button onClick={joinParty}>
                      파티 참가 <ArrowRightIcon />
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
          <div className="private-note">
            <LockClosedIcon />
            <span>
              <b>초대받은 친구만 입장</b>방 코드를 가진 사람끼리 안전하게
              즐겨요.
            </span>
          </div>
        </div>

        <div className="party-preview-card">
          <div className="preview-screen">
            <div className="preview-live">PARTY LIVE</div>
            <div className="preview-mission">
              <span>진행 중인 미션</span>
              <b>30분 안에 보스 클리어</b>
              <em>18:42</em>
              <div>
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
          <div className="preview-info">
            <div>
              <span className="preview-avatar">P</span>
              <span>
                <b>금요일 게임 파티</b>
                <small>친구 4명 · 미션 2개 진행 중</small>
              </span>
            </div>
            <span className="online-friends">
              <i /> 4명 함께 보는 중
            </span>
          </div>
          <div className="floating-chat chat-one">
            <b>민수</b> 이거 성공하면 인정 ㅋㅋ
          </div>
          <div className="floating-chat chat-two">
            <b>지수</b> 미션 하나 더 걸었어!
          </div>
        </div>
      </section>

      <section className="how-section" id="how">
        <div className="section-title">
          <span>HOW IT WORKS</span>
          <h2>친구들과 바로 시작하세요</h2>
          <p>복잡한 설정 없이 방 하나면 충분해요.</p>
        </div>
        <div className="step-grid">
          {[
            ["01", "파티 만들기", "방을 만들고 코드를 친구에게 공유하세요."],
            ["02", "화면 공유", "게임 화면과 시스템 소리를 함께 띄워요."],
            ["03", "미션 도전", "친구들이 미션을 걸고 성공을 판정해요."],
          ].map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <div className="step-icon">
                <CheckCircledIcon />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mission-section" id="missions">
        <div className="section-title left">
          <span>MISSION IDEAS</span>
          <h2>오늘은 어떤 미션을 걸까요?</h2>
          <p>친구들과 가볍게 시작하기 좋은 미션이에요.</p>
        </div>
        <div className="idea-grid">
          {missionIdeas.map((idea) => (
            <article key={idea.title}>
              <div
                className="idea-thumb"
                role="img"
                aria-label={`${idea.game} 게임 화면`}
                style={{
                  backgroundImage: `url("${idea.image}")`,
                  backgroundPosition: idea.imagePosition,
                }}
              >
                <i>{idea.game}</i>
              </div>
              <div>
                <h3>{idea.title}</h3>
                <p>{idea.meta} · 친구끼리 추천</p>
              </div>
              <button onClick={createParty}>
                <PlusIcon />
              </button>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <a className="brand" href="/">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            PLAY<span>STAGE</span>
          </span>
        </a>
        <p>친구들의 게임이 콘텐츠가 되는 곳.</p>
      </footer>
    </main>
  );
}

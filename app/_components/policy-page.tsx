import Link from "next/link";

export type PolicySection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
};

type PolicyPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections: PolicySection[];
};

const policyLinks = [
  ["서비스 이용약관", "/terms"],
  ["개인정보 처리방침", "/privacy"],
  ["저작권 정책", "/copyright"],
] as const;

export default function PolicyPage({
  eyebrow,
  title,
  description,
  sections,
}: PolicyPageProps) {
  return (
    <main className="policy-page">
      <header className="policy-header">
        <Link className="brand" href="/">
          <img className="brand-mark" src="/icon.png" alt="" />
          <span>
            PLAY<span>STAGE</span>
          </span>
        </Link>
        <Link href="/">홈으로 돌아가기 →</Link>
      </header>

      <div className="policy-shell">
        <aside className="policy-sidebar">
          <span>약관 및 정책</span>
          <nav aria-label="약관 및 정책">
            {policyLinks.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                aria-current={title === label ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        <article className="policy-content">
          <div className="policy-title">
            <span>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
            <small>시행일 · 2026년 8월 15일</small>
          </div>

          {sections.map((section, index) => (
            <section key={section.title}>
              <h2>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {section.title}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items && (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </div>

      <footer className="policy-footer">
        <span>© 2026 PLAYSTAGE</span>
        <span>친구들의 게임이 콘텐츠가 되는 곳.</span>
      </footer>
    </main>
  );
}

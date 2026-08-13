import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./browse-theme.css";
import "./party-home.css";
import "./party-room.css";
import "./readable-type.css";

const jua = localFont({
  src: "../public/fonts/BMJUA.ttf",
  variable: "--font-jua",
  display: "block",
  preload: true,
  fallback: ["Arial", "sans-serif"],
});

export const metadata: Metadata = {
  title: "PLAYSTAGE — 친구들과 미션 걸고 플레이",
  description: "친구를 초대하고, 화면을 공유하고, 오늘의 미션을 시작하세요.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${jua.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

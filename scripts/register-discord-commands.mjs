import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true, quiet: true });

const applicationId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!applicationId || !token)
  throw new Error("DISCORD_CLIENT_ID와 DISCORD_BOT_TOKEN이 필요합니다.");

const commands = [
  {
    name: "party",
    name_localizations: { ko: "파티" },
    description: "Create a PLAYSTAGE party",
    description_localizations: { ko: "PLAYSTAGE 파티를 만들어요" },
    options: [
      {
        type: 3,
        name: "title",
        name_localizations: { ko: "제목" },
        description: "Party title",
        description_localizations: { ko: "파티 제목" },
        required: true,
        max_length: 50,
      },
    ],
  },
  {
    name: "mission",
    name_localizations: { ko: "미션" },
    description: "Create a mission in the current party",
    description_localizations: { ko: "현재 파티에 미션을 제안해요" },
    options: [
      {
        type: 3,
        name: "title",
        name_localizations: { ko: "내용" },
        description: "Mission title",
        description_localizations: { ko: "미션 내용" },
        required: true,
        max_length: 80,
      },
      {
        type: 4,
        name: "reward",
        name_localizations: { ko: "보상" },
        description: "Reward points",
        description_localizations: { ko: "성공 시 받을 포인트" },
        min_value: 0,
        max_value: 1000,
      },
    ],
  },
  {
    name: "points",
    name_localizations: { ko: "포인트" },
    description: "Check PLAYSTAGE points",
    description_localizations: { ko: "내 포인트를 확인해요" },
  },
  {
    name: "gift",
    name_localizations: { ko: "선물" },
    description: "Gift points to a friend",
    description_localizations: { ko: "친구에게 포인트를 선물해요" },
    options: [
      {
        type: 6,
        name: "user",
        name_localizations: { ko: "친구" },
        description: "Friend",
        description_localizations: { ko: "포인트를 받을 친구" },
        required: true,
      },
      {
        type: 4,
        name: "amount",
        name_localizations: { ko: "포인트" },
        description: "Point amount",
        description_localizations: { ko: "선물할 포인트" },
        required: true,
        min_value: 1,
        max_value: 10000,
      },
    ],
  },
  {
    name: "rank",
    name_localizations: { ko: "순위" },
    description: "View the PLAYSTAGE leaderboard",
    description_localizations: { ko: "서버 포인트 순위를 확인해요" },
  },
];

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!response.ok)
  throw new Error(
    `Discord 명령어 등록 실패: ${response.status} ${await response.text()}`,
  );
console.log(`Discord 명령어 ${commands.length}개를 등록했습니다.`);

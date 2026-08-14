import { neon } from "@neondatabase/serverless";

export type MissionVote = "success" | "fail";

export async function castMissionVote(
  missionId: string,
  discordUserId: string,
  vote: MissionVote,
) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const sql = neon(process.env.DATABASE_URL);

  const [inserted] = await sql.query(
    `insert into mission_votes (mission_id, discord_user_id, vote)
     select id, $2, $3 from missions where id = $1 and status = 'active'
     on conflict (mission_id, discord_user_id) do nothing
     returning vote`,
    [missionId, discordUserId, vote],
  );

  const [mission] = await sql.query(
    inserted
      ? `update missions m set
           success = success + case when $2 = 'success' then 1 else 0 end,
           fail = fail + case when $2 = 'fail' then 1 else 0 end,
           status = case
             when success + case when $2 = 'success' then 1 else 0 end >= 3 then 'success'
             when fail + case when $2 = 'fail' then 1 else 0 end >= 3 then 'fail'
             else status end
         from rooms r
         left join room_discord rd on rd.room_id = r.id
         where m.id = $1 and m.room_id = r.id
         returning m.id, m.title, m.creator,
                   m.creator_discord_id as "creatorDiscordId", m.reward,
                   m.status, m.success, m.fail, r.code as "roomCode",
                   rd.guild_id as "guildId"`
      : `select m.id, m.title, m.creator,
                m.creator_discord_id as "creatorDiscordId", m.reward,
                m.status, m.success, m.fail, r.code as "roomCode",
                rd.guild_id as "guildId"
           from missions m
           join rooms r on r.id = m.room_id
           left join room_discord rd on rd.room_id = r.id
          where m.id = $1`,
    inserted ? [missionId, vote] : [missionId],
  );

  if (!mission) return { accepted: false, mission: null };

  if (inserted && mission.guildId) {
    await sql.query(
      `insert into point_ledger (guild_id, discord_user_id, amount, reason, reference_key)
       values ($1, $2, 5, 'mission_vote', $3)
       on conflict (reference_key) do nothing`,
      [mission.guildId, discordUserId, `vote:${missionId}:${discordUserId}`],
    );
    if (mission.status === "success" && mission.creatorDiscordId) {
      await sql.query(
        `insert into point_ledger (guild_id, discord_user_id, amount, reason, reference_key)
         values ($1, $2, $3, 'mission_success', $4)
         on conflict (reference_key) do nothing`,
        [
          mission.guildId,
          mission.creatorDiscordId,
          mission.reward,
          `mission-reward:${missionId}`,
        ],
      );
    }
  }

  return { accepted: Boolean(inserted), mission };
}

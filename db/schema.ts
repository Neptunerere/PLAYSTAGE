import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 50 }).notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).default("draft").notNull(),
    createdVia: varchar("created_via", { length: 20 })
      .default("web")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    hostHeartbeatAt: timestamp("host_heartbeat_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("rooms_code_unique").on(table.code)],
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;

export const missions = pgTable("missions", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 80 }).notNull(),
  creator: varchar("creator", { length: 24 }).notNull(),
  creatorDiscordId: varchar("creator_discord_id", { length: 24 }),
  reward: integer("reward").default(100).notNull(),
  discordMessageId: varchar("discord_message_id", { length: 24 }),
  discordChannelId: varchar("discord_channel_id", { length: 24 }),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  success: integer("success").default(0).notNull(),
  fail: integer("fail").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Mission = typeof missions.$inferSelect;
export type NewMission = typeof missions.$inferInsert;

export const discordGuilds = pgTable("discord_guilds", {
  guildId: varchar("guild_id", { length: 24 }).primaryKey(),
  name: varchar("name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const discordChannels = pgTable("discord_channels", {
  channelId: varchar("channel_id", { length: 24 }).primaryKey(),
  guildId: varchar("guild_id", { length: 24 })
    .notNull()
    .references(() => discordGuilds.guildId, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roomDiscord = pgTable(
  "room_discord",
  {
    roomId: uuid("room_id")
      .primaryKey()
      .references(() => rooms.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 24 })
      .notNull()
      .references(() => discordGuilds.guildId, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 24 })
      .notNull()
      .references(() => discordChannels.channelId, { onDelete: "cascade" }),
    hostDiscordId: varchar("host_discord_id", { length: 24 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("room_discord_channel_idx").on(table.channelId)],
);

export const discordProfiles = pgTable("discord_profiles", {
  discordUserId: varchar("discord_user_id", { length: 24 }).primaryKey(),
  username: varchar("username", { length: 80 }).notNull(),
  avatar: text("avatar"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const missionVotes = pgTable(
  "mission_votes",
  {
    missionId: uuid("mission_id")
      .notNull()
      .references(() => missions.id, { onDelete: "cascade" }),
    discordUserId: varchar("discord_user_id", { length: 24 }).notNull(),
    vote: varchar("vote", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.missionId, table.discordUserId] })],
);

export const pointLedger = pgTable(
  "point_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    discordUserId: varchar("discord_user_id", { length: 24 }).notNull(),
    amount: integer("amount").notNull(),
    reason: varchar("reason", { length: 40 }).notNull(),
    referenceKey: varchar("reference_key", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("point_ledger_reference_unique").on(table.referenceKey),
    index("point_ledger_user_idx").on(table.guildId, table.discordUserId),
  ],
);

import {
  integer,
  pgTable,
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
  status: varchar("status", { length: 20 }).default("active").notNull(),
  success: integer("success").default(0).notNull(),
  fail: integer("fail").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Mission = typeof missions.$inferSelect;
export type NewMission = typeof missions.$inferInsert;

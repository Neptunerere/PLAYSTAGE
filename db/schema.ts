import { pgTable, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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

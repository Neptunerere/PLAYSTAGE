CREATE TABLE "discord_channels" (
	"channel_id" varchar(24) PRIMARY KEY NOT NULL,
	"guild_id" varchar(24) NOT NULL,
	"name" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_guilds" (
	"guild_id" varchar(24) PRIMARY KEY NOT NULL,
	"name" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_profiles" (
	"discord_user_id" varchar(24) PRIMARY KEY NOT NULL,
	"username" varchar(80) NOT NULL,
	"avatar" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission_votes" (
	"mission_id" uuid NOT NULL,
	"discord_user_id" varchar(24) NOT NULL,
	"vote" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_votes_mission_id_discord_user_id_pk" PRIMARY KEY("mission_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" varchar(24) NOT NULL,
	"discord_user_id" varchar(24) NOT NULL,
	"amount" integer NOT NULL,
	"reason" varchar(40) NOT NULL,
	"reference_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_discord" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"guild_id" varchar(24) NOT NULL,
	"channel_id" varchar(24) NOT NULL,
	"host_discord_id" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "creator_discord_id" varchar(24);--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "reward" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "discord_message_id" varchar(24);--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "discord_channel_id" varchar(24);--> statement-breakpoint
ALTER TABLE "discord_channels" ADD CONSTRAINT "discord_channels_guild_id_discord_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."discord_guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_votes" ADD CONSTRAINT "mission_votes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_discord" ADD CONSTRAINT "room_discord_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_discord" ADD CONSTRAINT "room_discord_guild_id_discord_guilds_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."discord_guilds"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_discord" ADD CONSTRAINT "room_discord_channel_id_discord_channels_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."discord_channels"("channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_ledger_reference_unique" ON "point_ledger" USING btree ("reference_key");--> statement-breakpoint
CREATE INDEX "point_ledger_user_idx" ON "point_ledger" USING btree ("guild_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "room_discord_channel_idx" ON "room_discord" USING btree ("channel_id");
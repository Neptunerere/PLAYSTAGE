CREATE TABLE "mission_end_votes" (
	"mission_id" uuid NOT NULL,
	"voter_client_id" varchar(64) NOT NULL,
	"voter_name" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_end_votes_mission_id_voter_client_id_pk" PRIMARY KEY("mission_id","voter_client_id")
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "creator_client_id" varchar(64);--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "type" varchar(20) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "end_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "end_required_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mission_end_votes" ADD CONSTRAINT "mission_end_votes_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;
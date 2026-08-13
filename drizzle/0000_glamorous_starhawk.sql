CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(50) NOT NULL,
	"code" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_code_unique" ON "rooms" USING btree ("code");
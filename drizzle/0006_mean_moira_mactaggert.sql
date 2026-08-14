ALTER TABLE "rooms" ADD COLUMN "created_via" varchar(20) DEFAULT 'web' NOT NULL;
--> statement-breakpoint
UPDATE "rooms" r
SET "created_via" = 'discord'
WHERE r."status" = 'draft'
  AND r."title" <> '새 게임 파티'
  AND EXISTS (
    SELECT 1 FROM "room_discord" rd WHERE rd."room_id" = r."id"
  );

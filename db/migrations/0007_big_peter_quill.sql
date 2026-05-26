CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`recipeId` text,
	`kind` text NOT NULL,
	`metadata` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_kind_created_idx` ON `events` (`kind`,`createdAt`);--> statement-breakpoint
CREATE INDEX `events_user_created_idx` ON `events` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `events_created_idx` ON `events` (`createdAt`);
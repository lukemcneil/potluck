CREATE TABLE `aiUsage` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`recipeId` text,
	`model` text NOT NULL,
	`inputTokens` integer NOT NULL,
	`outputTokens` integer NOT NULL,
	`totalTokens` integer NOT NULL,
	`costUsd` real NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `aiUsage` (`userId`,`createdAt`);
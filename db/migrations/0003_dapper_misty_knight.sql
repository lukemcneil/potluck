CREATE TABLE `pushSubscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dhKey` text NOT NULL,
	`authKey` text NOT NULL,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`lastSeenAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pushSubscriptions_endpoint_unique` ON `pushSubscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `pushSubscriptions` (`userId`);--> statement-breakpoint
CREATE TABLE `recipeComments` (
	`id` text PRIMARY KEY NOT NULL,
	`recipeId` text NOT NULL,
	`authorId` text NOT NULL,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_comments_recipe_created_idx` ON `recipeComments` (`recipeId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `recipe_comments_author_idx` ON `recipeComments` (`authorId`);--> statement-breakpoint
CREATE TABLE `recipeRatings` (
	`recipeId` text NOT NULL,
	`userId` text NOT NULL,
	`value` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`recipeId`, `userId`),
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_ratings_recipe_idx` ON `recipeRatings` (`recipeId`);--> statement-breakpoint
CREATE INDEX `recipe_ratings_user_idx` ON `recipeRatings` (`userId`);--> statement-breakpoint
CREATE TABLE `shoppingListItems` (
	`id` text PRIMARY KEY NOT NULL,
	`listId` text NOT NULL,
	`name` text NOT NULL,
	`quantity` text,
	`unit` text,
	`sourceRecipeId` text,
	`position` integer DEFAULT 0 NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`addedAt` integer NOT NULL,
	FOREIGN KEY (`listId`) REFERENCES `shoppingLists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sourceRecipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_list_items_list_idx` ON `shoppingListItems` (`listId`,`position`);--> statement-breakpoint
CREATE TABLE `shoppingLists` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	`archivedAt` integer,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_lists_owner_idx` ON `shoppingLists` (`ownerId`,`createdAt`);
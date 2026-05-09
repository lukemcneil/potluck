CREATE TABLE `accounts` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `authenticators` (
	`credentialID` text NOT NULL,
	`userId` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`credentialPublicKey` text NOT NULL,
	`counter` integer NOT NULL,
	`credentialDeviceType` text NOT NULL,
	`credentialBackedUp` integer NOT NULL,
	`transports` text,
	PRIMARY KEY(`userId`, `credentialID`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authenticators_credentialID_unique` ON `authenticators` (`credentialID`);--> statement-breakpoint
CREATE TABLE `collectionRecipes` (
	`collectionId` text NOT NULL,
	`recipeId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`addedAt` integer NOT NULL,
	PRIMARY KEY(`collectionId`, `recipeId`),
	FOREIGN KEY (`collectionId`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_recipes_recipe_idx` ON `collectionRecipes` (`recipeId`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`coverPhotoPath` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`isDefaultSaves` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collections_owner_idx` ON `collections` (`ownerId`);--> statement-breakpoint
CREATE UNIQUE INDEX `collections_owner_slug_unq` ON `collections` (`ownerId`,`slug`);--> statement-breakpoint
CREATE TABLE `recipeIngredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipeId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`quantity` text,
	`unit` text,
	`name` text NOT NULL,
	`note` text,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredients_recipe_idx` ON `recipeIngredients` (`recipeId`,`position`);--> statement-breakpoint
CREATE TABLE `recipePhotos` (
	`id` text PRIMARY KEY NOT NULL,
	`recipeId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`path` text NOT NULL,
	`blurhash` text,
	`width` integer,
	`height` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_photos_recipe_idx` ON `recipePhotos` (`recipeId`,`position`);--> statement-breakpoint
CREATE TABLE `recipeSteps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipeId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_steps_recipe_idx` ON `recipeSteps` (`recipeId`,`position`);--> statement-breakpoint
CREATE TABLE `recipeTags` (
	`recipeId` text NOT NULL,
	`tagId` text NOT NULL,
	PRIMARY KEY(`recipeId`, `tagId`),
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`authorId` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`sourceUrl` text,
	`prepMinutes` integer,
	`cookMinutes` integer,
	`servings` text,
	`mealType` text,
	`cuisine` text,
	`diets` text DEFAULT '[]',
	`visibility` text DEFAULT 'public' NOT NULL,
	`kind` text DEFAULT 'structured' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipes_author_idx` ON `recipes` (`authorId`);--> statement-breakpoint
CREATE INDEX `recipes_visibility_idx` ON `recipes` (`visibility`);--> statement-breakpoint
CREATE INDEX `recipes_meal_type_idx` ON `recipes` (`mealType`);--> statement-breakpoint
CREATE UNIQUE INDEX `recipes_author_slug_unq` ON `recipes` (`authorId`,`slug`);--> statement-breakpoint
CREATE TABLE `saves` (
	`userId` text NOT NULL,
	`recipeId` text NOT NULL,
	`savedAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `recipeId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipeId`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saves_recipe_idx` ON `saves` (`recipeId`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`emailVerified` integer,
	`image` text,
	`handle` text,
	`bio` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);--> statement-breakpoint
CREATE TABLE `verificationTokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);

ALTER TABLE `recipePhotos` ADD `role` text DEFAULT 'cover' NOT NULL;--> statement-breakpoint
CREATE INDEX `recipe_photos_recipe_role_idx` ON `recipePhotos` (`recipeId`,`role`);
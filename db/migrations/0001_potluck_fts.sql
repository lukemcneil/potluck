CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
  recipe_id UNINDEXED,
  title,
  description,
  ingredients,
  tokenize = 'porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipes_fts_after_insert
AFTER INSERT ON recipes BEGIN
  INSERT INTO recipes_fts(recipe_id, title, description, ingredients)
  VALUES (new.id, new.title, COALESCE(new.description, ''), '');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipes_fts_after_update
AFTER UPDATE OF title, description ON recipes BEGIN
  UPDATE recipes_fts
     SET title = new.title,
         description = COALESCE(new.description, '')
   WHERE recipe_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipes_fts_after_delete
AFTER DELETE ON recipes BEGIN
  DELETE FROM recipes_fts WHERE recipe_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipe_ingredients_fts_after_insert
AFTER INSERT ON recipeIngredients BEGIN
  UPDATE recipes_fts
     SET ingredients = (
       SELECT GROUP_CONCAT(
         TRIM(
           COALESCE(quantity || ' ', '') ||
           COALESCE(unit || ' ', '') ||
           name ||
           COALESCE(' ' || note, '')
         ),
         ' | '
       )
       FROM recipeIngredients
       WHERE recipeId = new.recipeId
     )
   WHERE recipe_id = new.recipeId;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipe_ingredients_fts_after_update
AFTER UPDATE ON recipeIngredients BEGIN
  UPDATE recipes_fts
     SET ingredients = (
       SELECT GROUP_CONCAT(
         TRIM(
           COALESCE(quantity || ' ', '') ||
           COALESCE(unit || ' ', '') ||
           name ||
           COALESCE(' ' || note, '')
         ),
         ' | '
       )
       FROM recipeIngredients
       WHERE recipeId = new.recipeId
     )
   WHERE recipe_id = new.recipeId;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recipe_ingredients_fts_after_delete
AFTER DELETE ON recipeIngredients BEGIN
  UPDATE recipes_fts
     SET ingredients = COALESCE((
       SELECT GROUP_CONCAT(
         TRIM(
           COALESCE(quantity || ' ', '') ||
           COALESCE(unit || ' ', '') ||
           name ||
           COALESCE(' ' || note, '')
         ),
         ' | '
       )
       FROM recipeIngredients
       WHERE recipeId = old.recipeId
     ), '')
   WHERE recipe_id = old.recipeId;
END;

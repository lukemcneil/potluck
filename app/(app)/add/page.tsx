import { requireSession } from "@/lib/session";
import { AddRecipeFlow } from "@/components/upload/AddRecipeFlow";

export const dynamic = "force-dynamic";

export default async function AddRecipePage() {
  await requireSession("/add");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <AddRecipeFlow />
    </div>
  );
}

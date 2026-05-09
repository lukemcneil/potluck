import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MeRedirect() {
  const session = await requireSession("/me");
  const handle = session.user.handle;
  redirect(handle ? `/u/${handle}` : "/feed");
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// No standalone login page — /login redirects home.
// If a session already exists, send them to /dashboard (defense in depth).
export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  redirect("/");
}

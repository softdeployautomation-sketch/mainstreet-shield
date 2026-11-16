import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

  // MainStreet Shield is referral-only: there is no separate sign-in page.
  // Access is granted via a referral link that opens /signup.
  redirect("/signup");
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession, requireAdmin } from "@/lib/auth";
import ClientReferralsPage from "./ClientReferralsPage";

export const metadata: Metadata = {
  title: "Referrals — MainStreet Shield Admin",
};

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  await requireAdmin(session).catch(() => redirect("/"));

  return <ClientReferralsPage />;
}

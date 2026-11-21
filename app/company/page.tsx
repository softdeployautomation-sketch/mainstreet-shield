import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";
import CompanyCreateForm from "@/app/company/company-create-form";

export const metadata: Metadata = {
  title: "Company Onboarding — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // S0-2: require password — redirect to Settings to create one
  const pw = await requirePasswordUser(session);
  if (!pw.user) redirect("/login");
  if (pw.needPassword) redirect("/settings?need-password=1");

  // Check if user already has a company
  const existing = await db.company.findUnique({
    where: { userId: session.userId },
  });

  if (existing) {
    redirect("/dashboard/assets");
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-emerald-400 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">Company Onboarding</h1>
        <span className="ml-auto text-xs text-zinc-500">
          {session.email}
        </span>
      </div>

      <CompanyCreateForm />
    </div>
  );
}
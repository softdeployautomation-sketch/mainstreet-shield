import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession, requirePasswordUser } from "@/lib/auth";
import { db } from "@/lib/db";

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
    redirect("/dashboard");
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

      <form
        className="max-w-2xl bg-zinc-900/50 rounded-xl border border-zinc-800 p-6"
        action={"/api/company/create"}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Business Name
            </label>
            <input
              name="name"
              type="text"
              required
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. Acme Corp"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Domain (optional)
            </label>
            <input
              name="domain"
              type="text"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. example.com"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">
            Description / What do you want to secure?
          </label>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            placeholder="Tell us about your business and the assets you want us to test."
          ></textarea>
        </div>
        <button
          type="submit"
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Create Company Profile
        </button>
      </form>
    </div>
  );
}
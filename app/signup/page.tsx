import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Request Access — MainStreet Shield",
};

export const dynamic = "force-dynamic";

const REFERRAL_COOKIE = "sw_ref";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (await getSession()) redirect("/dashboard");

  const cookieStore = await cookies();
  const refCookie = cookieStore.get(REFERRAL_COOKIE)?.value;
  const resolvedSearchParams = await searchParams;
  const refQuery = Array.isArray(resolvedSearchParams.ref)
    ? resolvedSearchParams.ref[0]
    : resolvedSearchParams.ref;

  let hasAccess = refCookie ? await hasAccessGate(refCookie) : false;

  const referralError = !hasAccess ? "A valid referral link is required to apply." : null;

  if (refQuery && !hasAccess) {
    hasAccess = await hasAccessGate(refQuery);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-emerald-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <Link href="/" className="text-xs font-mono text-[#888] hover:text-emerald-400 transition-colors">
              ← Back to homepage
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-2xl px-4 py-20">
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-8">
          <h1 className="text-2xl font-mono font-bold mb-2">Apply for access</h1>
          <p className="text-[#a1a1a1] text-sm mb-6">
            MainStreet Shield is referral-only. Complete the application below
            and we will review it. You will hear back by email.
          </p>

          {referralError && (
            <div className="mb-6 p-3 rounded bg-[#1a1a1a]/50 border border-red-500/30 text-red-400 text-xs font-mono">
              {referralError}
            </div>
          )}

          <form
            className="space-y-5"
            action="/api/auth/signup"
            method="POST"
          >
            <input type="hidden" name="referralCode" value={refQuery ?? ""} />

            <div>
              <label className="block text-xs font-mono text-[#888] mb-2">Email address</label>
              <input
                name="email"
                type="email"
                required
                className="w-full rounded border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 text-sm text-[#e5e5e5] focus:ring-2 focus:ring-emerald-500"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-[#888] mb-2">Name (optional)</label>
              <input
                name="name"
                type="text"
                className="w-full rounded border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 text-sm text-[#e5e5e5] focus:ring-2 focus:ring-emerald-500"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-[#888] mb-2">Why do you need MainStreet Shield?</label>
              <textarea
                name="why"
                rows={5}
                required
                className="w-full rounded border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3 text-sm text-[#e5e5e5] focus:ring-2 focus:ring-emerald-500"
                placeholder="Tell us about your business, what you want to secure, and why you need access to the lab..."
              ></textarea>
            </div>

            <button
              type="submit"
              className="w-full rounded bg-emerald-500 text-black font-mono font-bold py-3 hover:bg-emerald-400 transition-colors"
            >
              Submit application
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";

async function hasAccessGate(ref: string): Promise<boolean> {
  try {
    const referral = await db.referral.findUnique({
      where: { code: ref },
    });
    return !!referral && referral.status === "pending";
  } catch {
    return false;
  }
}

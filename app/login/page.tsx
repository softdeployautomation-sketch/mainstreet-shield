import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAccessGate } from "@/lib/referral";

export const dynamic = "force-dynamic";

const REFERRAL_COOKIE = "sw_ref";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("shield-session")?.value;
  if (token) redirect("/dashboard");

  const resolvedParams = await searchParams;
  const refCookie = cookieStore.get(REFERRAL_COOKIE)?.value;
  const refQuery = Array.isArray(resolvedParams.ref)
    ? resolvedParams.ref[0]
    : resolvedParams.ref;

  // Referral gate: need valid sw_ref cookie or ?ref=CODE to see login form
  let hasAccess = refCookie ? await hasAccessGate(refCookie) : false;

  if (!hasAccess && refQuery) {
    hasAccess = await hasAccessGate(refQuery);
    if (!hasAccess) redirect("/?error=referral_required");
  }

  if (!hasAccess) {
    redirect("/?error=referral_required");
  }

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-xl px-4 py-12 flex items-center justify-center">
        <div className="w-full rounded-xl border border-border bg-bg-elevated p-8 md:p-12">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-brand-600 font-mono text-xs dark:text-brand-400">›_</span>
            <h1 className="text-3xl font-display font-bold tracking-tight">Sign in</h1>
          </div>
          <p className="text-fg-muted text-sm md:text-base mb-8 leading-relaxed">
            Enter your email to sign in. No password required — sign-in is via
            referral link only.
          </p>

          <form action="/api/auth/login" method="POST" className="space-y-6">
            <div className="space-y-2">
              <label className="block text-xs font-mono text-fg-muted">Email address</label>
              <input
                name="email"
                type="email"
                required
                className="w-full rounded border border-border bg-white px-4 py-3.5 text-sm text-fg focus:ring-2 focus:ring-brand-500 transition-colors dark:bg-bg-elevated dark:text-fg dark:border-border"
                placeholder="you@company.com"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded bg-brand-600 text-white font-mono font-bold py-4 hover:bg-brand-700 transition-colors"
            >
              Sign in
            </button>
          </form>

          <p className="mt-6 text-xs font-mono text-fg-muted text-center">
            Don't have an account?{" "}
            <Link href="/signup" className="text-brand-600 hover:text-brand-500 underline">
              Apply for access
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

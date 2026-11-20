import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { hasAccessGate } from "@/lib/referral";
import { SignupForm } from "@/components/signup-form";

export const metadata: Metadata = {
  title: "Apply for Access — MainStreet Shield",
};

export const dynamic = "force-dynamic";

const REFERRAL_COOKIE = "sw_ref";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const refCookie = cookieStore.get(REFERRAL_COOKIE)?.value;
  const resolvedSearchParams = await searchParams;
  const refQuery = Array.isArray(resolvedSearchParams.ref)
    ? resolvedSearchParams.ref[0]
    : resolvedSearchParams.ref;

  // Resolve access BEFORE the session check (G11): a signed-in visitor holding a
  // valid ref may still see the form; only a ref-less signed-in visitor bounces.
  let hasAccess = refCookie ? await hasAccessGate(refCookie) : false;
  if (refQuery && !hasAccess) {
    hasAccess = await hasAccessGate(refQuery);
  }

  const session = await getSession();

  // No valid access: a session holder goes to /dashboard, everyone else to the
  // gated homepage.
  if (!hasAccess) {
    if (session) redirect("/dashboard");
    redirect("/?error=referral_required");
  }

  // Valid access. A signed-in visitor is shown the form with a dismissible-style
  // notice (and a Go to dashboard link) so they're never trapped at /dashboard.
  const signedInNotice = session
    ? `You're signed in as ${session.email}. This form creates a new account.`
    : null;

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-mono font-bold text-brand-600 dark:text-brand-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </Link>
            <Link href="/" className="text-xs font-mono text-fg-muted hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              ← Back to homepage
            </Link>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-3xl px-4 py-12 flex items-center justify-center">
        <div className="w-full rounded-xl border border-border bg-bg-elevated p-8 md:p-12">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-brand-600 font-mono text-xs dark:text-brand-400">›_</span>
            <h1 className="text-3xl font-display font-bold tracking-tight">Apply for access</h1>
          </div>
          <p className="text-fg-muted text-sm md:text-base mb-8 leading-relaxed">
            MainStreet Shield is referral-only. Complete the application below
            and we will review it. You will hear back by email.
          </p>

          {signedInNotice && (
            <div className="mb-6 p-4 rounded bg-blue-50 border border-blue-200 text-sm text-blue-800 dark:bg-blue-900/20 dark:border-blue-800/30 dark:text-blue-200">
              {signedInNotice}{" "}
              <Link
                href="/dashboard"
                className="font-medium underline ml-2 hover:text-blue-600 dark:hover:text-blue-400"
              >
                Go to dashboard
              </Link>
            </div>
          )}

          <SignupForm ref={refQuery ?? undefined} />

          <p className="mt-6 text-center text-sm text-fg-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}


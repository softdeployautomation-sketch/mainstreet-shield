import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Signup — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const referralCode =
    typeof searchParams.ref === "string" ? searchParams.ref : undefined;

  // Validate referral code if provided
  let referral = null;
  if (referralCode) {
    referral = await db.referral.findUnique({
      where: { code: referralCode },
    });
    if (!referral || referral.status !== "pending") {
      referral = null;
    }
  }

  return (
    <div className="flex flex-col h-full p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-emerald-400 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">Create MainStreet Shield Account</h1>
      </div>

      <form
        className="max-w-md mx-auto bg-zinc-900/50 rounded-xl border border-zinc-800 p-6"
        action="/api/auth/signup"
      >
        {referral && (
          <div className="mb-4 p-3 rounded bg-emerald-900/20 border border-emerald-500/30">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-emerald-400">🎫</span>
              <span className="text-xs text-emerald-400 font-medium">
                Referred by {referral.referrerId}
              </span>
            </div>
            <input
              type="hidden"
              name="referralCode"
              value={referral.code}
            />
          </div>
        )}
        {!referral && referralCode && (
          <div className="mb-4 p-3 rounded bg-rose-900/20 border border-rose-500/30">
            <span className="text-xs text-rose-400">
              Invalid or expired referral code.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Name (optional)
            </label>
            <input
              name="name"
              type="text"
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">
            Password
          </label>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Create Account
        </button>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Already have an account?{" "}
          <a href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
}
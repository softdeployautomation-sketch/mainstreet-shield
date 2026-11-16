import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in — MainStreet Shield",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex flex-col h-full p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 mb-6">
        <span className="text-emerald-400 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">Sign in to MainStreet Shield</h1>
      </div>

      <form
        className="max-w-md mx-auto bg-zinc-900/50 rounded-xl border border-zinc-800 p-6"
        action="/api/auth/login"
      >
        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Email</label>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs text-zinc-400 mb-1">Password</label>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Sign in
        </button>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Don't have an account?{" "}
          <a href="/signup" className="text-emerald-400 hover:underline">
            Create one
          </a>
        </p>
      </form>
    </div>
  );
}
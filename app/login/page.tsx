import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, createSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e5e5e5] flex flex-col">
      <nav className="sticky top-0 z-50 border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur py-3 px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 font-mono font-bold text-emerald-400">
              <span className="text-xl">›_</span>
              <span className="text-sm">MainStreet Shield</span>
            </a>
            <a href="/" className="text-xs font-mono text-[#888] hover:text-emerald-400 transition-colors">
              ← Back to homepage
            </a>
          </div>
        </div>
      </nav>

      <section className="flex-1 mx-auto max-w-md px-4 py-12 flex items-center justify-center">
        <div className="w-full rounded-xl border border-[#1a1a1a] bg-[#111] p-8 md:p-12">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-emerald-400 font-mono text-xs">›_</span>
            <h1 className="text-3xl font-mono font-bold tracking-tight">Sign in</h1>
          </div>
          <p className="text-[#a1a1a1] text-sm mb-8 leading-relaxed">
            Enter your email to sign in to MainStreet Shield. A session will be
            created for your account.
          </p>

          <form
            className="space-y-6"
            action="/api/auth/login"
            method="POST"
          >
            <div className="space-y-2">
              <label className="block text-xs font-mono text-[#888]">Email address</label>
              <input
                name="email"
                type="email"
                required
                className="w-full rounded border border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3.5 text-sm text-[#e5e5e5] focus:ring-2 focus:ring-emerald-500 transition-colors"
                placeholder="admin@mainstreetmint.click"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded bg-emerald-500 text-black font-mono font-bold py-4 hover:bg-emerald-400 transition-colors"
            >
              Sign in
            </button>
          </form>

          <p className="text-xs text-[#666] text-center mt-8">
            Don&#39;t have access yet?{" "}
            <a href="/signup" className="text-emerald-400 hover:text-emerald-400 underline">
              Apply for access
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}

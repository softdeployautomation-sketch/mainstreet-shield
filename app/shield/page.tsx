import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ShieldVmPanel } from "@/components/shield-vm-panel";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "MainStreet Shield — Linux VM Lab",
};

// TASK: session-gated server page, force-dynamic like /cyberlab in spaceworker
export const dynamic = "force-dynamic";

export default async function ShieldPage() {
  const session = await getSession();
  if (!session) redirect("/signup");

  return (
    <div className="flex flex-col h-full gap-4 p-4 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-emerald-400 font-mono text-sm">›_</span>
        <h1 className="text-xl font-semibold">MainStreet Shield</h1>
        <span className="ml-auto text-xs text-zinc-500">
          {session.email} · {session.role}
        </span>
      </div>
      <ShieldVmPanel userId={session.userId} isAdmin={session.role === "admin"} />
    </div>
  );
}
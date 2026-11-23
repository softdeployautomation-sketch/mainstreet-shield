import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Settings — MainStreet Shield",
};

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const user = session
    ? await db.user.findUnique({
        where: { id: session.userId },
        select: { email: true, name: true, tier: true, role: true },
      })
    : null;
  return <AppShell user={user}>{children}</AppShell>;
}

import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";

export const metadata: Metadata = {
  title: "Settings — MainStreet Shield",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

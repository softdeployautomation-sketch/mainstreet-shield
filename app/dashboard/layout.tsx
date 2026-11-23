import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";

export const metadata: Metadata = {
  title: "Dashboard — MainStreet Shield",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

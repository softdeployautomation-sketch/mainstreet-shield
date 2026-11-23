import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell/app-shell";

export const metadata: Metadata = {
  title: "Lab Console — MainStreet Shield",
};

export default function ShieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

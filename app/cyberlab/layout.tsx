import type { Metadata } from "next";

import type { ReactNode } from "react";

// CyberLab layout — wraps the console in .lab-ops so it feels like its own
// place: light "blueprint console" by default, near-black SOC canvas under .dark.
// Honours the app-wide theme toggle set in root layout.
export const metadata: Metadata = { title: "CyberLab — MainStreet Shield" };

export default function CyberLabLayout({ children }: { children: ReactNode }) {
  return <div className="lab-ops min-h-screen">{children}</div>;
}
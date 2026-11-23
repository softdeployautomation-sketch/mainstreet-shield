import {
  LayoutDashboard,
  Boxes,
  ShieldAlert,
  FileText,
  Bot,
  MonitorPlay,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  badge?: "Soon" | string;
  minTier?: "5" | "3";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/assets", label: "Assets", icon: Boxes },
  {
    href: "/dashboard/findings",
    label: "Findings",
    icon: ShieldAlert,
    disabled: true,
    badge: "Soon",
  },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
  {
    href: "/shield",
    label: "Agent",
    icon: Bot,
    minTier: "5",
  },
  {
    href: "/shield",
    label: "Lab",
    icon: MonitorPlay,
    minTier: "5",
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

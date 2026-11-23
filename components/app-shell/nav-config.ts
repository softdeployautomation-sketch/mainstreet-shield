import {
  LayoutDashboard,
  Boxes,
  ShieldAlert,
  FileText,
  MonitorPlay,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  badge?: "Soon" | string;
  minTier?: "3" | "5";
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
    label: "Lab Console",
    icon: MonitorPlay,
    minTier: "5",
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

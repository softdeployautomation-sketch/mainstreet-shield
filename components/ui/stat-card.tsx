import { cn } from "./cn";
import { Card } from "./card";

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      {icon && <div className="mb-2">{icon}</div>}
      <div className="text-2xl font-semibold text-fg">{value}</div>
      <div className="text-xs text-fg-muted">{title}</div>
      {subtitle && <div className="text-xs text-fg-muted mt-1">{subtitle}</div>}
    </Card>
  );
}

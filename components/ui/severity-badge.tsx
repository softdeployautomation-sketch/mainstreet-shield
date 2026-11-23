import { cn } from "./cn";

export interface SeverityBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  severity: "info" | "low" | "medium" | "high" | "critical";
}

const variants = {
  info: "border-severity-info/30 bg-severity-info/10 text-severity-info",
  low: "border-severity-low/30 bg-severity-low/10 text-severity-low",
  medium: "border-severity-medium/30 bg-severity-medium/10 text-severity-medium",
  high: "border-severity-high/30 bg-severity-high/10 text-severity-high",
  critical:
    "border-severity-critical/30 bg-severity-critical/10 text-severity-critical",
};

export function SeverityBadge({
  className,
  severity,
  ...props
}: SeverityBadgeProps) {
  return (
    <div
      {...props}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[severity],
        className
      )}
    />
  );
}

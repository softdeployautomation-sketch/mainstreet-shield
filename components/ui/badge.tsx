import { cn } from "./cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "brand" | "accent" | "outline" | "ghost";
}

const variants = {
  default: "border-border bg-surface text-fg-muted",
  brand: "border-transparent bg-brand-600 text-white",
  accent: "border-transparent bg-accent-600 text-white",
  outline: "border-border bg-transparent text-fg",
  ghost: "bg-surface text-fg",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      {...props}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variants[variant],
        className
      )}
    />
  );
}

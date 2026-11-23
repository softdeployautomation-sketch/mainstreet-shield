import { cn } from "./cn";
import { CircleAlert } from "lucide-react";

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon = <CircleAlert className="w-8 h-8 text-fg-muted" />,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
    >
      <div className="mb-4">{icon}</div>
      {title && (
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
      )}
      {description && (
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      )}
    </div>
  );
}

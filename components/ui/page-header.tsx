import { cn } from "./cn";

export interface PageHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

export function PageHeader({
  title,
  description,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
      {description && (
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      )}
    </div>
  );
}

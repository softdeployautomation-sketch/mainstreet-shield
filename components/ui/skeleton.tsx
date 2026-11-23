import { cn } from "./cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      className={cn(
        "animate-pulse rounded-md border border-border bg-surface",
        className
      )}
    />
  );
}

import * as React from "react";
import { cn } from "./cn";

export interface TabsProps {
  children?: React.ReactNode;
  className?: string;
}

export interface TabsListProps extends React.HTMLAttributes<HTMLUListElement> {
  children?: React.ReactNode;
  className?: string;
}

export interface TabsTriggerProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  selected?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export interface TabsContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function Tabs({ className, children }: TabsProps) {
  return (
    <div className={cn("w-full", className)}>{children}</div>
  );
}

export function TabsList({ className, children, ...props }: TabsListProps) {
  return (
    <ul
      {...props}
      className={cn("inline-flex flex-wrap gap-1 border-b border-border", className)}
    >
      {children}
    </ul>
  );
}

export function TabsTrigger({
  selected = false,
  className,
  ...props
}: TabsTriggerProps) {
  return (
    <a
      {...props}
      className={cn(
        "-mb-px inline-flex border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-muted transition-opacity duration-150 hover:text-fg hover:border-border",
        selected && "text-fg border-brand-600",
        className
      )}
    />
  );
}

export function TabsContent({ children, className }: TabsContentProps) {
  return <div className={cn("mt-2", className)}>{children}</div>;
}

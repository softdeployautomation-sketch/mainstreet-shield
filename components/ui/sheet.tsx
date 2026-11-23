"use client";

import * as React from "react";
import { cn } from "./cn";
import { X } from "lucide-react";

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export interface SheetTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  className?: string;
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}

export function Sheet({ open = false, onOpenChange, children }: SheetProps) {
  if (!open) return null;
  return (
    <>
      <SheetOverlay onOpenChange={onOpenChange} />
      <SheetContent open={open} onOpenChange={onOpenChange}>
        {children}
      </SheetContent>
    </>
  );
}

export function SheetTrigger({
  className,
  ...props
}: SheetTriggerProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-border bg-bg-elevated text-fg px-4 py-2 text-sm shadow-sm transition-opacity duration-150 hover:opacity-90",
        className
      )}
    />
  );
}

export function SheetOverlay({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm transition-opacity duration-200"
      onClick={() => onOpenChange?.(false)}
    />
  );
}

export function SheetContent({
  open = false,
  onOpenChange,
  title,
  children,
  className,
  ...props
}: SheetContentProps) {
  if (!open) return null;
  return (
    <div
      {...props}
      className={cn(
        "fixed top-0 right-0 z-50 h-full w-full max-w-md bg-bg-elevated border-l border-border shadow-lg transform transition-transform duration-200 translate-x-0",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <button
          onClick={() => onOpenChange?.(false)}
          className="rounded-md p-1 text-fg-muted transition-opacity duration-150 hover:bg-surface-hover hover:text-fg"
          aria-label="Close panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 overflow-y-auto">{children}</div>
    </div>
  );
}

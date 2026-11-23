"use client";

import * as React from "react";
import { cn } from "./cn";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "brand" | "accent" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const base =
  "inline-flex items-center justify-center rounded-md border font-medium transition-opacity duration-150 hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const variants = {
  default: "border-border bg-bg-elevated text-fg focus-visible:ring-fg",
  brand: "border-transparent bg-brand-600 text-white focus-visible:ring-brand-600",
  accent: "border-transparent bg-accent-600 text-white focus-visible:ring-accent-600",
  outline: "border-border bg-transparent text-fg focus-visible:ring-fg",
  ghost: "bg-transparent text-fg focus-visible:ring-fg",
  danger: "border-transparent bg-severity-critical text-white focus-visible:ring-severity-critical",
};

const sizes = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      type="button"
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
);

Button.displayName = "Button";

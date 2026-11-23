import { cn } from "./cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-lg border border-border bg-surface shadow-sm",
        className
      )}
    />
  );
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}
export function CardHeader({ className, ...props }: CardHeaderProps) {
  return (
    <div
      {...props}
      className={cn("flex flex-col space-y-1.5 px-6 py-4", className)}
    />
  );
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children?: React.ReactNode;
}
export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <h3
      {...props}
      className={cn(
        "text-base font-semibold leading-none tracking-tight text-fg",
        className
      )}
    />
  );
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}
export function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div {...props} className={cn("px-6 py-4", className)} />
  );
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}
export function CardFooter({ className, ...props }: CardFooterProps) {
  return (
    <div
      {...props}
      className={cn("flex items-center px-6 py-3", className)}
    />
  );
}

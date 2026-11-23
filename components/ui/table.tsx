import { cn } from "./cn";

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  children?: React.ReactNode;
}

export function Table({ className, children, ...props }: TableProps) {
  return (
    <div className={cn("w-full overflow-auto", className)} {...props}>
      <table className="w-full text-sm text-left">{children}</table>
    </div>
  );
}

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children?: React.ReactNode;
}
export function TableHeader({ className, ...props }: TableHeaderProps) {
  return (
    <thead
      {...props}
      className={cn("bg-bg-elevated/[50] border-b border-border", className)}
    />
  );
}

export interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children?: React.ReactNode;
}
export function TableBody({ className, ...props }: TableBodyProps) {
  return (
    <tbody {...props} className={cn("text-fg", className)} />
  );
}

export interface TableFooterProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  children?: React.ReactNode;
}
export function TableFooter({ className, ...props }: TableFooterProps) {
  return (
    <tfoot
      {...props}
      className={cn("bg-bg-elevated border-t border-border text-fg-muted", className)}
    />
  );
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children?: React.ReactNode;
}
export function TableRow({ className, ...props }: TableRowProps) {
  return (
    <tr
      {...props}
      className={cn(
        "border-b border-border hover:bg-surface-hover transition-opacity duration-150",
        className
      )}
    />
  );
}

export interface TableHeadProps extends React.HTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}
export function TableHead({ className, ...props }: TableHeadProps) {
  return (
    <th
      {...props}
      className={cn(
        "text-xs font-medium text-fg-muted uppercase tracking-wider",
        className
      )}
    />
  );
}

export interface TableHeadRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  children?: React.ReactNode;
}
export function TableHeadRow({ className, ...props }: TableHeadRowProps) {
  return (
    <tr {...props} className={cn(className)} />
  );
}

export interface TableCellProps extends React.HTMLAttributes<HTMLTableCellElement> {
  children?: React.ReactNode;
}
export function TableCell({ className, ...props }: TableCellProps) {
  return (
    <td
      {...props}
      className={cn("p-4 align-middle", className)}
    />
  );
}

export interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {
  children?: React.ReactNode;
}
export function TableCaption({ className, ...props }: TableCaptionProps) {
  return (
    <caption
      {...props}
      className={cn("text-fg-muted text-xs mb-2", className)}
    />
  );
}

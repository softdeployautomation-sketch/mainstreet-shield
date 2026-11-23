"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Copy } from "lucide-react";

const sanitizeOptions = {
  tagNames: [
    "h1","h2","h3","h4","h5","h6",
    "p","br","hr",
    "ul","ol","li",
    "blockquote",
    "code","pre",
    "a","img",
    "strong","em","del",
    "table","thead","tbody","tr","th","td",
  ],
  attributes: {
    a: ["href","target","rel","title"],
    img: ["src","alt","title","width","height"],
    code: ["className"],
    pre: ["className"],
  },
  protocols: {
    a: ["http","https","mailto"],
  },
} as const;

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      className="absolute right-1 top-1 flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg-elevated text-fg-muted text-xs transition-opacity hover:opacity-100 disabled:opacity-50 disabled:pointer-events-none"
      disabled={copied}
    >
      {copied ? (
        <>
          <Copy className="w-3 h-3" /> Copied
        </>
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
}

export const headingStyles = {
  h1: "font-display semibold text-[18px] leading-none mt-4 mb-2 text-fg",
  h2: "font-display semibold text-[16px] leading-none mt-4 mb-2 text-fg",
  h3: "font-display semibold text-[14px] leading-none mt-4 mb-2 text-fg",
};

export const components: Record<string, React.ComponentType<any>> = {
  root: ({ children }: { children: React.ReactNode }) => (
    <div className="font-sans text-sm leading-7 text-fg max-w-[72ch] break-words">
      {children}
    </div>
  ),
  code: ({ children, className, ...props }: any) => {
    const text =
      typeof children === "string" ? children : String(children ?? "");
    return (
      <div className="relative overflow-x-auto rounded border border-border bg-bg-elevated my-4 text-sm font-mono">
        <CopyButton code={text} />
        <pre
          {...props}
          className="p-3 overflow-x-auto text-fg"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {text}
        </pre>
      </div>
    );
  },
  a: ({ href, children, ...props }: any) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-600 underline underline-offset-2 hover:text-brand-500 dark:text-brand-400"
    />
  ),
  table: ({ children }: { children: React.ReactNode }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border-collapse border border-border rounded">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead>{children}</thead>
  ),
  tbody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr>{children}</tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th className="border border-border p-1 text-left text-fg-muted font-medium text-xs uppercase tracking-wider">
      {children}
    </th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td className="border border-border p-1 text-left text-fg">
      {children}
    </td>
  ),
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote className="border-l-2 border-brand-600 pl-3 my-2 italic text-fg-muted">
      {children}
    </blockquote>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong className="text-fg">{children}</strong>
  ),
  em: ({ children }: { children: React.ReactNode }) => (
    <em className="text-fg">{children}</em>
  ),
  del: ({ children }: { children: React.ReactNode }) => (
    <del className="text-fg">{children}</del>
  ),
  hr: () => <hr className="border-t border-border my-4" />,
  br: () => <br />,
  li: ({ children }: { children: React.ReactNode }) => (
    <li className="break-words">{children}</li>
  ),
  img: ({ src, alt, ...props }: any) => (
    <img
      {...props}
      src={src}
      alt={alt}
      className="max-w-full rounded border border-border bg-bg-elevated"
    />
  ),
  h1: ({ children }: { children: React.ReactNode }) => (
    <h1 className={headingStyles.h1}>{children}</h1>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 className={headingStyles.h2}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 className={headingStyles.h3}>{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p className="break-words">{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul className="list-disc pl-5 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol className="list-decimal pl-5 space-y-1">{children}</ol>
  ),
  inlineCode: ({ className, children, ...props }: any) => (
    <code
      {...props}
      className={[
        "rounded bg-bg-muted px-1 py-0.5 text-fg font-mono text-xs",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  ),
};

interface MarkdownProps {
  content: string;
}

export function ChatMarkdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, sanitizeOptions]]}
      components={components as any}
    >
      {content}
    </ReactMarkdown>
  );
}
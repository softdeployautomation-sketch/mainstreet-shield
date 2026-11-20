"use client";

import { useState } from "react";

interface CopyButtonProps {
  link: string;
  label?: string;
  copiedLabel?: string;
}

/** Client-side copy-to-clipboard button (safe inside Server Components). */
export default function CopyButton({
  link,
  label = "Copy",
  copiedLabel = "Copied ✓",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; silently no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={copied}
      className="text-xs font-mono text-brand-600 hover:underline cursor-pointer dark:text-brand-400 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies the given text to the clipboard (handover doc → external LLM). */
export default function CopyButton({ text, label = "Copy markdown" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (non-secure context) — silently ignore
    }
  }

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-xs font-medium text-tmuted hover:border-accent hover:text-tprimary"
    >
      {copied ? <Check size={13} strokeWidth={1.5} className="text-up" /> : <Copy size={13} strokeWidth={1.5} />}
      {copied ? "Copied" : label}
    </button>
  );
}

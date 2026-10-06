"use client";

import { SecondaryButton } from "@/components/Form";
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
    <SecondaryButton size="sm" onClick={copy} className="font-medium hover:border-accent">
      {copied ? <Check size={13} strokeWidth={1.5} className="text-up" /> : <Copy size={13} strokeWidth={1.5} />}
      {copied ? "Copied" : label}
    </SecondaryButton>
  );
}

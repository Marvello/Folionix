"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

// Brand dialog. A solid dark scrim (no blur — no glassmorphism), a flat
// surface panel with a hairline edge, Folio Teal only on focus. Closes on
// Escape or scrim click; restores focus to the trigger on unmount.
export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    // Move focus into the dialog so keyboard + screen-reader users land here.
    panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    )?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock background scroll

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="modal-scrim fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-page/80 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-panel w-full max-w-lg rounded-lg border border-edge bg-component p-4 shadow-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id={titleId} className="font-semibold text-tprimary">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-tdim hover:text-tprimary"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Confirmation for an irreversible action. Reuses the brand dialog; focus
 * lands on the close button, so Enter never confirms by accident.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Remove",
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-tsecondary">{message}</p>
      {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-sm border border-down/40 px-4 text-sm font-semibold text-down hover:bg-page disabled:opacity-60"
        >
          {busy ? "Removing…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-sm border border-edge px-4 text-sm text-tmuted hover:text-tprimary disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

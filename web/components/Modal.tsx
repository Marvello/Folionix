"use client";

import { useEffect, useId, useRef } from "react";
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

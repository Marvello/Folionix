"use client";

import { useState } from "react";

// Shared form primitives for the CRUD dialogs. Brand: inputs rounded-md on the
// canvas, primary button = the only solid teal (40px, rounded-sm, label-sm),
// errors shown inside the dialog where the user is looking.

export const inputCls = "rounded-md border border-edge bg-page px-3 py-2 text-tprimary";

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function Field({
  label,
  optional,
  className = "",
  children,
}: {
  label: React.ReactNode;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-tmuted">
        {label}
        {optional && <span className="ml-1 text-tdim">optional</span>}
      </span>
      {children}
    </label>
  );
}

export function PrimaryButton({
  className = "",
  type = "submit",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-sm bg-btn px-5 text-xs font-semibold tracking-[0.04em] text-page transition-colors duration-[120ms] hover:bg-btn-hover disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export const secondaryBtnCls =
  "inline-flex h-10 items-center justify-center gap-1.5 rounded-sm border border-edge px-4 text-sm text-tmuted hover:text-tprimary disabled:opacity-60";

/** Busy flag + in-dialog error for an async submit/remove. */
export function useAsyncAction<K extends string = "save">() {
  const [busy, setBusy] = useState<K | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: K, fn: () => Promise<unknown>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run };
}

/** Error line + Save/Cancel row. Pass extra actions (e.g. Remove) as children. */
export function FormActions({
  busy,
  saving = busy,
  error,
  submitLabel = "Save",
  busyLabel = "Saving…",
  disabled,
  onCancel,
  cancelLabel = "Cancel",
  children,
}: {
  busy: boolean;
  /** Show the busy label on the submit button; defaults to `busy`. */
  saving?: boolean;
  error?: string | null;
  submitLabel?: string;
  busyLabel?: string;
  disabled?: boolean;
  onCancel: () => void;
  cancelLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <PrimaryButton disabled={busy || disabled}>{saving ? busyLabel : submitLabel}</PrimaryButton>
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryBtnCls}>
          {cancelLabel}
        </button>
        {children}
      </div>
    </>
  );
}

/** `<form>` that prevents the native submit and runs `onSubmit` (Enter submits). */
export function Form({
  onSubmit,
  className,
  children,
}: {
  onSubmit: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

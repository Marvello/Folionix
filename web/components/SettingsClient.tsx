"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { SETTINGS, type SettingDef } from "@folionix/lib";
import { saveSetting, resetSetting } from "@/app/actions";
import Modal from "@/components/Modal";
import { Field, Form, FormActions, SecondaryButton, inputCls, useAsyncAction } from "@/components/Form";
import { fmtAgo } from "@/lib/format";

export interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
}

const GROUP_INTRO: Record<SettingDef["group"], string> = {
  "Alerts & signals": "When the system reacts to market moves and what it pushes to Telegram.",
  "Recommendation & AI": "How often stocks are re-analysed and which AI model and personas do the analysis.",
  Schedules: "When background jobs run. All hours are Jakarta time (WIB).",
};

const show = (def: SettingDef, v: string) =>
  def.type === "bool" ? (v === "true" ? "On" : "Off") : `${v}${def.unit && /^[\d.,]+$/.test(v) ? ` ${def.unit}` : ""}`;

function Help({ def }: { def: SettingDef }) {
  return (
    <>
      <p className="text-sm text-tmuted">{def.help}</p>
      {def.example && <p className="mt-1 text-xs text-tdim">Example: {def.example}</p>}
    </>
  );
}

/** The effective value, set apart from the label: boxed, larger, mono (figures
 *  are always JetBrains Mono). A custom value sits on a raised tone with a
 *  stronger edge so overrides stand out from untouched defaults. */
function ValueChip({ def, value, custom }: { def: SettingDef; value: string; custom: boolean }) {
  const isPhrase = / /.test(value) && def.type !== "hours"; // e.g. "same as primary model"
  const numeric = def.type === "number" && !isPhrase;
  // Comma lists (personas, hours) get a space after each comma so they wrap
  // between items, and a smaller size so a long list doesn't dominate the row.
  const isList = !isPhrase && value.includes(",");
  const text = def.type === "bool" ? (value === "true" ? "On" : "Off") : isList ? value.split(",").join(", ") : value;
  return (
    <div
      className={`inline-flex max-w-full items-baseline gap-1.5 rounded-md border px-3 py-1.5 ${
        custom ? "border-tmuted bg-surface-container-high" : "border-edge bg-page"
      }`}
    >
      <span
        className={
          isPhrase
            ? "text-sm text-tsecondary"
            : isList
              ? "font-mono text-sm font-semibold leading-snug text-tprimary"
              : "break-all font-mono text-lg font-semibold tabular-nums leading-none text-tprimary"
        }
      >
        {text}
      </span>
      {numeric && def.unit && <span className="text-xs text-tdim">{def.unit}</span>}
    </div>
  );
}

export default function SettingsClient({ rows }: { rows: SettingRow[] }) {
  const router = useRouter();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const [editing, setEditing] = useState<SettingDef | null>(null);
  const [value, setValue] = useState("");
  const { busy, error, setError, run } = useAsyncAction<"save" | "reset">();

  function open(def: SettingDef) {
    setEditing(def);
    setValue(byKey.get(def.key)?.value ?? (/ /.test(def.default) ? "" : def.default));
    setError(null);
  }

  async function act(fn: () => Promise<{ error?: string }>) {
    const res = await fn();
    if (res.error) throw new Error(res.error);
    setEditing(null);
    router.refresh();
  }

  const groups = [...new Set(SETTINGS.map((s) => s.group))];
  const override = editing ? byKey.get(editing.key) : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-medium text-tprimary">Settings</h1>
        <p className="mt-1 text-sm text-tmuted">
          Changes apply to the running services within about a minute — no redeploy or restart. A setting marked <span className="text-tprimary">custom</span> was changed here and wins
          over the server&apos;s .env file; &ldquo;Reset to default&rdquo; removes it so the .env value (or, if .env
          does not set it, the built-in default shown) applies again. Secrets and connection details (database, API keys, tokens,
          email) are not editable here and stay in .env.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group} className="rounded-lg border border-edge bg-component">
          <header className="border-b border-edge p-4">
            <h2 className="font-semibold text-tprimary">{group}</h2>
            <p className="mt-0.5 text-xs text-tdim">{GROUP_INTRO[group]}</p>
          </header>
          <ul className="divide-y divide-edge">
            {SETTINGS.filter((s) => s.group === group).map((def) => {
              const row = byKey.get(def.key);
              return (
                <li key={def.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:gap-6">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-tprimary">{def.label}</h3>
                    <div className="mt-1">
                      <Help def={def} />
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-tdim">{def.key}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-3 sm:w-56 sm:flex-col sm:items-end">
                    <div className="flex flex-col gap-1 sm:items-end">
                      <span className="text-[11px] uppercase tracking-[0.06em] text-tdim">Current value</span>
                      <ValueChip def={def} value={row?.value ?? def.default} custom={!!row} />
                    </div>
                    <p className="flex-1 text-[11px] leading-snug text-tdim sm:flex-none sm:text-right">
                      {row ? (
                        <>
                          <span className="text-tsecondary">Custom</span> · changed {fmtAgo(row.updated_at)}
                          {row.updated_by && <> by {row.updated_by}</>}
                        </>
                      ) : (
                        "Built-in default, unless .env sets it"
                      )}
                    </p>
                    <SecondaryButton size="sm" onClick={() => open(def)} aria-label={`Edit ${def.label}`}>
                      <Pencil size={13} strokeWidth={1.5} />
                      Edit
                    </SecondaryButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {editing && (
        <Modal title={editing.label} onClose={() => setEditing(null)}>
          <Form onSubmit={() => run("save", () => act(() => saveSetting(editing.key, value)))}>
            <div className="mb-3">
              <Help def={editing} />
            </div>
            <Field label={editing.unit ? `Value (${editing.unit})` : "Value"}>
              {editing.type === "bool" ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} className={inputCls}>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              ) : (
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode={editing.type === "number" ? "decimal" : undefined}
                  placeholder={editing.default}
                  className={`${inputCls} font-mono`}
                />
              )}
            </Field>
            <p className="mt-2 text-xs text-tdim">
              Default: {show(editing, editing.default)}
              {editing.min != null && editing.max != null && ` · allowed ${editing.min}–${editing.max}`}
            </p>
            <FormActions busy={busy !== null} saving={busy === "save"} error={error} onCancel={() => setEditing(null)}>
              {override && (
                <SecondaryButton
                  onClick={() => run("reset", () => act(() => resetSetting(editing.key)))}
                  disabled={busy !== null}
                  className="ml-auto"
                >
                  {busy === "reset" ? "Resetting…" : "Reset to default"}
                </SecondaryButton>
              )}
            </FormActions>
          </Form>
        </Modal>
      )}
    </div>
  );
}

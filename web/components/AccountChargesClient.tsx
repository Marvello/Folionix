"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { insertAccountCharge, deleteAccountCharge } from "@/app/actions";
import { fmtIdr, fmtWibDate } from "@/lib/format";
import type { AccountCharge } from "@/lib/types";
import EmptyState from "@/components/EmptyState";
import Modal, { ConfirmDialog } from "@/components/Modal";
import { Field, Form, FormActions, PrimaryButton, inputCls, useAsyncAction } from "@/components/Form";
import Pager from "@/components/Pager";
import { usePaged } from "@/lib/usePaged";

const CHARGE_TYPES: AccountCharge["type"][] = ["DATA_FEE", "METERAI", "LATE_FEE", "OTHER"];

const CHARGE_LABEL: Record<AccountCharge["type"], string> = {
  DATA_FEE: "Data Fee",
  METERAI: "Meterai",
  LATE_FEE: "Late Fee",
  OTHER: "Other",
};

export default function AccountChargesClient({ charges }: { charges: AccountCharge[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<AccountCharge | null>(null);

  const totalCharges = charges.reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const { page, setPage, totalPages, pageItems } = usePaged(charges);

  async function save(chargedAt: string, type: AccountCharge["type"], amount: string, notes: string) {
    await insertAccountCharge({ charged_at: chargedAt, type, amount: Number(amount) || 0, notes });
    setCreating(false);
    router.refresh();
  }

  async function remove(id: number) {
    await deleteAccountCharge(id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-tprimary">Account Charges</h2>
          <p className="mt-0.5 text-caption text-tdim">Total {fmtIdr(totalCharges)}</p>
        </div>
        <PrimaryButton type="button" onClick={() => setCreating(true)}>
          <Plus size={14} strokeWidth={2} />
          Add Charge
        </PrimaryButton>
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove charge?"
          message={`${CHARGE_LABEL[removing.type]} of ${fmtIdr(removing.amount)} on ${fmtWibDate(removing.charged_at)} is deleted permanently.`}
          onConfirm={() => remove(removing.id!)}
          onClose={() => setRemoving(null)}
        />
      )}

      {creating && (
        <Modal title="Add Charge" onClose={() => setCreating(false)}>
          <ChargeForm
            onCancel={() => setCreating(false)}
            onSave={(v) => save(v.chargedAt, v.type, v.amount, v.notes)}
          />
        </Modal>
      )}

      {charges.length === 0 ? (
        <EmptyState message="No account charges." />
      ) : (
        <>
          {/* Mobile stacked card view */}
          <div className="space-y-2.5 md:hidden">
            {pageItems.map((c) => (
              <div key={c.id} className="rounded-lg border border-edge bg-component p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium text-tprimary">{CHARGE_LABEL[c.type]}</span>
                    <p className="mt-0.5 text-xs text-tdim">{fmtWibDate(c.charged_at)}</p>
                  </div>
                  <div className="text-right">
                    <span className="num font-semibold text-tprimary">{fmtIdr(c.amount)}</span>
                  </div>
                </div>
                {c.notes && <p className="mt-2 text-xs text-tmuted">{c.notes}</p>}
                <div className="mt-2.5 flex justify-end border-t border-edge/50 pt-2">
                  <button
                    type="button"
                    onClick={() => c.id != null && setRemoving(c)}
                    className="rounded px-2 py-1 text-xs font-medium text-tmuted hover:bg-page hover:text-tprimary"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-tdim">
                  <th className="pb-2 pr-4 text-left">DATE</th>
                  <th className="pb-2 pr-4 text-left">TYPE</th>
                  <th className="pb-2 pr-4 text-right">AMOUNT</th>
                  <th className="pb-2 pr-4 text-left">NOTES</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((c) => (
                  <tr key={c.id} className="border-t border-edge">
                    <td className="py-2 pr-4 text-tmuted">{fmtWibDate(c.charged_at)}</td>
                    <td className="py-2 pr-4 text-tprimary">{CHARGE_LABEL[c.type]}</td>
                    <td className="num py-2 pr-4 text-right text-tprimary">{fmtIdr(c.amount)}</td>
                    <td className="py-2 pr-4 text-tmuted">{c.notes || "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => c.id != null && setRemoving(c)}
                        className="text-xs text-tmuted hover:text-tprimary hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totalPages} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
        </>
      )}
    </div>
  );
}

function ChargeForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (v: { chargedAt: string; type: AccountCharge["type"]; amount: string; notes: string }) => Promise<void>;
}) {
  const [chargedAt, setChargedAt] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState<AccountCharge["type"]>("DATA_FEE");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const { busy, error, run } = useAsyncAction();

  return (
    <Form onSubmit={() => run("save", () => onSave({ chargedAt, type, amount, notes }))}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Date">
          <input type="date" value={chargedAt} onChange={(e) => setChargedAt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as AccountCharge["type"])} className={inputCls}>
            {CHARGE_TYPES.map((t) => (
              <option key={t} value={t}>{CHARGE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Amount (IDR)">
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes" optional className="md:col-span-2">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <FormActions busy={busy !== null} error={error} onCancel={onCancel} />
    </Form>
  );
}

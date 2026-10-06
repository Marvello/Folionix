"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtEventAmount, type CalendarEvent, type CalendarEventKind } from "@/lib/calendarEvents";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const KIND_DOT: Record<CalendarEventKind, string> = {
  income: "bg-up",
  buy: "bg-accent",
  sell: "bg-tmuted",
};
const KIND_LABEL: Record<CalendarEventKind, string> = {
  income: "text-up",
  buy: "text-accent",
  sell: "text-tsecondary",
};
const MAX_TOOLTIP_ROWS = 8;

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function ActivityCalendar({ events }: { events: CalendarEvent[] }) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [openIso, setOpenIso] = useState<string | null>(null);
  const todayIso = isoLocal(now);

  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay(); // 0=Sun
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Build a 6×7 grid of Date cells (leading/trailing days spill from adjacent months).
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(view.y, view.m, 1 - startPad + i));

  const shift = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-tprimary">Activity Calendar</h2>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-tdim" aria-live="polite">{monthLabel}</span>
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md border border-edge p-1 text-tmuted hover:text-tprimary">
            <ChevronLeft size={14} />
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-md border border-edge p-1 text-tmuted hover:text-tprimary">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-caption text-tdim">
        {WEEKDAYS.map((w, i) => <div key={i} aria-hidden className="pb-1 font-medium">{w}</div>)}
        {cells.map((d, i) => {
          const iso = isoLocal(d);
          const inMonth = d.getMonth() === view.m;
          const isToday = iso === todayIso;
          const isFuture = iso > todayIso; // not disbursed yet — nothing to record
          const evList = byDate.get(iso) ?? [];
          const kinds = [...new Set(evList.map((e) => e.kind))];
          const overflow = evList.length - MAX_TOOLTIP_ROWS;

          const dayLabel = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
          const cellCls = `relative flex h-7 w-7 items-center justify-center rounded-full text-sm ${
            isToday
              ? "font-semibold text-tprimary ring-2 ring-accent"
              : evList.length
                ? "font-medium text-tprimary ring-1 ring-edge-hover"
                : inMonth
                  ? "text-tsecondary"
                  : "text-tdim"
          }`;
          const dots = evList.length > 0 && (
            <span aria-hidden className="absolute -bottom-0.5 flex gap-0.5">
              {kinds.slice(0, 3).map((k) => (
                <span key={k} className={`h-1 w-1 rounded-full ${KIND_DOT[k]}`} />
              ))}
            </span>
          );

          if (evList.length === 0) {
            return (
              <div key={i} className="relative flex justify-center py-0.5">
                <div className={cellCls} aria-current={isToday ? "date" : undefined}>{d.getDate()}</div>
              </div>
            );
          }

          // Event day: a real button (keyboard + touch). Details show on hover,
          // on keyboard focus (focus-within) and on tap (open state).
          const open = openIso === iso;
          return (
            <div key={i} className="group relative flex justify-center py-0.5">
              <button
                type="button"
                className={cellCls}
                aria-current={isToday ? "date" : undefined}
                aria-expanded={open}
                aria-label={`${dayLabel}: ${evList.length} event${evList.length > 1 ? "s" : ""}`}
                onClick={() => setOpenIso(open ? null : iso)}
                onBlur={() => setOpenIso((o) => (o === iso ? null : o))}
              >
                {d.getDate()}
                {dots}
              </button>
              <div
                role="tooltip"
                className={`pointer-events-none absolute bottom-full z-20 mb-1.5 w-max max-w-[240px] rounded-md border border-edge bg-surface-container-high p-2 text-left group-focus-within:block group-hover:block ${open ? "block" : "hidden"} ${i % 7 < 2 ? "left-0" : i % 7 > 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`}
              >
                <p className="mb-1 text-caption font-semibold text-tprimary">{dayLabel}</p>
                {evList.slice(0, MAX_TOOLTIP_ROWS).map((e, j) => (
                  <div key={j} className="mb-1 whitespace-nowrap text-caption last:mb-0">
                    <p className="text-tprimary">{e.label}</p>
                    <p className="text-tmuted">
                      {fmtEventAmount(e)
                        ? <span className={`num ${KIND_LABEL[e.kind]}`}>{fmtEventAmount(e)}</span>
                        : <span className="text-tdim">—</span>}
                      {e.kind === "income" && (
                        <>
                          {" · "}
                          {e.recorded
                            ? <span className="text-up">✓ Recorded</span>
                            : isFuture
                              ? <span className="text-tdim">Upcoming</span>
                              : <span className="text-warn">Not recorded</span>}
                        </>
                      )}
                    </p>
                  </div>
                ))}
                {overflow > 0 && (
                  <p className="mt-1 border-t border-edge pt-1 text-caption text-tdim">+{overflow} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

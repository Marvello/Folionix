"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtEventAmount, type CalendarEvent, type CalendarEventKind } from "@/lib/calendarEvents";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const KIND_DOT: Record<CalendarEventKind, string> = {
  income: "bg-up",
  buy: "bg-accent",
  sell: "bg-down",
};
const KIND_LABEL: Record<CalendarEventKind, string> = {
  income: "text-up",
  buy: "text-accent",
  sell: "text-down",
};
const MAX_TOOLTIP_ROWS = 8;

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function ActivityCalendar({ events }: { events: CalendarEvent[] }) {
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
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
          <span className="mr-1 text-xs text-tdim">{monthLabel}</span>
          <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded-md border border-edge p-1 text-tmuted hover:text-tprimary">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => shift(1)} aria-label="Next month" className="rounded-md border border-edge p-1 text-tmuted hover:text-tprimary">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-tdim">
        {WEEKDAYS.map((w, i) => <div key={i} className="pb-1 font-medium">{w}</div>)}
        {cells.map((d, i) => {
          const iso = isoLocal(d);
          const inMonth = d.getMonth() === view.m;
          const isToday = iso === todayIso;
          const isFuture = iso > todayIso; // not disbursed yet — nothing to record
          const evList = byDate.get(iso) ?? [];
          const kinds = [...new Set(evList.map((e) => e.kind))];
          const overflow = evList.length - MAX_TOOLTIP_ROWS;

          return (
            <div key={i} className="relative flex justify-center py-0.5">
              <div
                className={`group relative flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                  isToday
                    ? "bg-btn font-semibold text-page"
                    : evList.length
                      ? "font-medium text-tprimary ring-1 ring-accent"
                      : inMonth
                        ? "text-tsecondary"
                        : "text-tdim"
                }`}
              >
                {d.getDate()}
                {evList.length > 0 && !isToday && (
                  <span className="absolute -bottom-0.5 flex gap-0.5">
                    {kinds.slice(0, 3).map((k) => (
                      <span key={k} className={`h-1 w-1 rounded-full ${KIND_DOT[k]}`} />
                    ))}
                  </span>
                )}
                {evList.length > 0 && (
                  <div className={`pointer-events-none absolute bottom-full z-20 mb-1.5 hidden w-max max-w-[240px] rounded-md border border-edge bg-component p-2 text-left shadow-lg group-hover:block ${i % 7 < 2 ? "left-0" : i % 7 > 4 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
                    <p className="mb-1 text-[11px] font-semibold text-tprimary">
                      {d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                    {evList.slice(0, MAX_TOOLTIP_ROWS).map((e, j) => (
                      <div key={j} className="mb-1 whitespace-nowrap text-[11px] last:mb-0">
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
                      <p className="mt-1 border-t border-edge pt-1 text-[11px] text-tdim">+{overflow} more</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

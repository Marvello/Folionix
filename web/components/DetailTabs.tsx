import Link from "next/link";
import { DETAIL_TABS, type TabId } from "@/lib/tabs";

export default function DetailTabs({
  active,
  hrefFor,
}: {
  active: TabId;
  hrefFor: (tab: TabId) => string;
}) {
  return (
    <nav className="border-b border-edge" aria-label="Detail sections">
      <ul className="flex gap-6">
        {DETAIL_TABS.map((t) => {
          const on = t.id === active;
          return (
            <li key={t.id}>
              <Link
                href={hrefFor(t.id)}
                aria-current={on ? "page" : undefined}
                className={`-mb-px block border-b-2 px-1 pb-2 text-sm transition-colors duration-150 ${
                  on
                    ? "border-accent text-tprimary"
                    : "border-transparent text-tdim hover:text-tsecondary"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

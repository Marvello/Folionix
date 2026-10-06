"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { signOut } from "next-auth/react";
import Version from "@/components/Version";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/stocks", label: "Stocks" },
  { href: "/gold", label: "Gold" },
  { href: "/funds", label: "Funds" },
  { href: "/bonds", label: "Bonds" },
  { href: "/news", label: "News" },
  { href: "/reviews", label: "Reviews" },
];

export default function Nav() {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  // Close the mobile drawer on route change (incl. back/forward) and Escape.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawer(false);
  }
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  if (pathname === "/login") return null;

  async function handleSignOut() {
    await signOut({ callbackUrl: "/login" });
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  function linkClass(href: string) {
    const active = isActive(href);
    return `rounded-md px-3 py-2 text-sm font-medium ${
      active ? "bg-edge text-tprimary" : "text-tmuted hover:text-tprimary"
    }`;
  }

  const links = (onNavigate?: () => void) => (
    <>
      {NAV_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={linkClass(l.href)}
          aria-current={isActive(l.href) ? "page" : undefined}
          onClick={onNavigate}
        >
          {l.label}
        </Link>
      ))}
    </>
  );

  const signOutBtn = (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-tdim hover:text-tprimary"
    >
      <LogOut size={15} strokeWidth={1.5} />
      Sign out
    </button>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-edge bg-component p-4 md:flex">
        <Image
          src="/logo/wordmark-transparent.svg"
          alt="Folionix"
          width={140}
          height={48}
          priority
          className="mb-6 h-auto w-36"
        />
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">{links()}</nav>
        <div className="mt-4">{signOutBtn}</div>
        <Version />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="border-b border-edge bg-component md:hidden">
        <div className="flex items-center justify-between p-4">
          <Image
            src="/logo/wordmark-transparent.svg"
            alt="Folionix"
            width={120}
            height={40}
            priority
            className="h-auto w-32"
          />
          <button
            onClick={() => setDrawer((d) => !d)}
            aria-label={drawer ? "Close menu" : "Open menu"}
            aria-expanded={drawer}
            aria-controls="mobile-nav"
            className="rounded-md p-2 text-tmuted hover:text-tprimary"
          >
            {drawer ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>
        </div>
        {drawer && (
          <nav id="mobile-nav" aria-label="Main" className="flex flex-col gap-1 border-t border-edge px-4 pb-4 pt-2">
            {links(() => setDrawer(false))}
            <div className="mt-2 border-t border-edge pt-2">{signOutBtn}</div>
            <Version />
          </nav>
        )}
      </div>
    </>
  );
}

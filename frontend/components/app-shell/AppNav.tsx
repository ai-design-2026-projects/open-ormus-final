"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { Library, Clapperboard, Bot, Settings } from "lucide-react";
import { Monogram } from "@/components/ui/monogram";
import { logout } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Library", icon: Library, href: "/" },
  { label: "Scenes", icon: Clapperboard, href: "/conversations" },
  { label: "Assistant", icon: Bot, href: "/chat" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <nav
      aria-label="Main navigation"
      className="sticky top-0 z-50 flex items-center gap-4 px-4 h-14 border-b border-hair backdrop-blur-[10px]"
      style={{
        background: "color-mix(in oklch, var(--surface-1) 85%, transparent)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 shrink-0">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <circle cx="10" cy="12" r="6.5" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
          <circle cx="14" cy="12" r="6.5" fill="none" stroke="var(--accent-oo)" strokeWidth="1.4" />
        </svg>
        <span className="font-medium text-[15px] tracking-[-0.01em]">
          Open<em className="t-editorial">Ormus</em>
        </span>
      </div>

      {/* Nav links */}
      <div className="flex-1 flex items-center gap-0.5 px-4">
        {NAV_LINKS.map(({ label, icon: Icon, href }) => {
          const isActive = (h: string) =>
            h === "/" ? pathname === "/" : pathname.startsWith(h);
          const active = isActive(href);
          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-[120ms]",
                active
                  ? "bg-bg-tinted text-ink"
                  : "text-ink-mute hover:text-ink hover:bg-bg-tinted"
              )}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </div>

      {/* Right: user menu */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="User menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <Monogram name="User" size={28} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1.5 w-44 bg-surface-1 border border-hair rounded-[var(--r-md)] shadow-[var(--shadow-2)] py-1 z-50"
          >
            <Link
              href="/settings"
              role="menuitem"
              className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-dim hover:text-ink hover:bg-bg-tinted transition-colors duration-[120ms]"
              onClick={() => setMenuOpen(false)}
            >
              <Settings className="size-3.5" strokeWidth={1.5} />
              Settings
            </Link>
            <div className="border-t border-hair my-1" />
            <form action={logout}>
              <button
                type="submit"
                role="menuitem"
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-ink-dim hover:text-ink hover:bg-bg-tinted transition-colors duration-[120ms] text-left"
              >
                Log out
              </button>
            </form>
          </div>
        )}
      </div>
    </nav>
  );
}

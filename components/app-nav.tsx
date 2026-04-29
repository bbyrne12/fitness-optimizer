"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";

const NAV_LINKS = [
  { href: "/protected", label: "Dashboard" },
  { href: "/plan", label: "My Plan" },
  { href: "/routine", label: "Routine" },
  { href: "/log-workout", label: "Log Workout" },
  { href: "/exercises", label: "Exercises" },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/protected") return pathname === "/protected";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeHref = useMemo(() => {
    const p = pathname ?? "";
    const match = NAV_LINKS.find((l) => isActivePath(p, l.href));
    return match?.href ?? null;
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setEmail(data.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = () => {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth/login");
      router.refresh();
    });
  };

  return (
    <div className="sticky top-0 z-10 w-full border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-zinc-400 hover:bg-zinc-900 hover:text-white md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link
            href="/protected"
            className="font-bold tracking-tight text-white hover:opacity-90"
          >
            Fitness Optimizer
          </Link>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => {
            const active = activeHref === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "font-semibold text-lime-400"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-zinc-500 sm:inline">
            {email ?? ""}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={logout}
            disabled={isPending}
            className="text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            Logout
          </Button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-zinc-800 bg-zinc-950 md:hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-3">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((l) => {
                const active = activeHref === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenuOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "font-semibold text-lime-400"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-white",
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";

import { Logo } from "@/components/logo";
import { DEMO_NOTICE } from "@/lib/athlete/demo";

// The routine builder (/plan, /plans) and the exercise library (/exercises)
// are deliberately not here. Neither is part of training day to day: one is a
// way to get a starting routine when there is nothing to log yet, the other a
// reference the app uses behind the scenes. Both are linked from the dashboard.
const NAV_LINKS = [
  { href: "/protected", label: "Dashboard" },
  { href: "/athlete", label: "Setup" },
  { href: "/coach", label: "Coach" },
  { href: "/calendar", label: "Plan" },
  { href: "/log-workout", label: "Log" },
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
  const [demo, setDemo] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeHref = useMemo(() => {
    const p = pathname ?? "";
    const match = NAV_LINKS.find((l) => isActivePath(p, l.href));
    return match?.href ?? null;
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (cancelled) return;
      setEmail(data.user?.email ?? null);
      if (!data.user) return;
      // Whoever is signed in should know at a glance whether the athlete they
      // are reading is a real one. Only the demo account's own row matches.
      const { data: prof } = await supabase.from("athlete_profile")
        .select("config->demo").eq("user_id", data.user.id).maybeSingle();
      if (!cancelled) setDemo((prof as { demo?: unknown } | null)?.demo === true);
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

          <Link href="/protected" className="hover:opacity-90">
            <Logo markClassName="h-5 w-5" />
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

      {demo && (
        <div className="border-t border-lime-400/20 bg-lime-400/5">
          <p className="mx-auto w-full max-w-6xl px-4 py-2 text-[12px] leading-relaxed text-lime-300/90">
            {DEMO_NOTICE}
          </p>
        </div>
      )}

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


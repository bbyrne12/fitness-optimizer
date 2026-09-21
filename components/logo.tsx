/**
 * The mark: a morning that dips and climbs, with today's point on the end.
 * One stroke, one dot -- the app makes one call a day, and the line it is
 * drawn from is the athlete's own recovery.
 *
 * Kept as geometry rather than an image file so it takes the colour it is
 * given, stays sharp at any size, and costs no request.
 */
export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M2.5 17.5 L8 11.5 L12 15 L19 6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="6" r="3" fill="currentColor" />
    </svg>
  );
}

/** Mark plus name, for a header or a footer. */
export function Logo({ className = "", markClassName = "h-6 w-6" }:
                     { className?: string; markClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className={`${markClassName} text-lime-400`} />
      <span className="font-bold tracking-tight text-white">Fitness Optimizer</span>
    </span>
  );
}

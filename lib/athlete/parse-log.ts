/**
 * Parser for the Apple Notes workout log, ported from whoop-dashboard/parse_workouts.py.
 *
 * The point is that the format never has to change. This reads the shorthand
 * people already type into a notes app rather than asking them to adopt a new
 * one:
 *
 *   1/4:                       date header (year from a "Workouts 26" line)
 *   X4:                        block multiplier, applies until the next blank
 *   Leg press: 340 x 12        weight x reps
 *   Bench: 95 x 10, 10, 6      several sets at one weight
 *   Bench: 50 x 9, 60 x 8      several weight/rep pairs on one line
 *   Seated rows: 7th from top  machine pin position, no numeric weight
 *   Calf raises: 50 x 40 (25)  parenthetical is a note, not a set
 *   Pushups: 25 x 3            bodyweight: reps x sets
 *   Wide pushups: 25           bodyweight: reps, one set
 *   Ab workout: (10 min):      a core routine; the lines under it are its movements
 *   dead bugs: 32              inside it, a bare number is reps
 *   1 min plank                a timed hold
 *   Shoulder holds: 2, 1 min   two timed holds
 *   ... 130 x 12 ^             a progression marker
 *
 * A line with no set count written means DEFAULT_SETS.
 */
export const DEFAULT_SETS = 3;

export type ParsedSet = {
  day: string;
  exercise: string;
  weight: number | null;
  reps: number | null;
  sets: number;
  pin: string | null;
  notes: string | null;
};

// Forgiving on purpose: this gets typed one-handed on a phone after a
// workout. 9/14, 9/14:, 9/14/26, 9-14, "Sept 14" and "September 14th" all
// mean the same thing, and none of them should cost a lost session.
const DATE_RE = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?:?\s*$/;
const MONTHS = ["jan","feb","mar","apr","may","jun",
                "jul","aug","sep","oct","nov","dec"];
const WORD_DATE_RE = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?:?\s*$/i;
const YEAR_RE = /^Workouts\s+(\d{2})\s*$/i;
const MULT_RE = /^[Xx](\d+):?\s*$/;
const PIN_RE = /(\d+)(?:st|nd|rd|th)\s+from\s+(top|bottom)/i;
const SET_RE = /(\d+(?:\.\d+)?)\s*(?:lbs?|kg)?\s*[xX]\s*([\d,\s]+)/g;
const AB_HEADER_RE = /^ab workout\b/i;
// "1 min plank", "30 sec hollow hold": a timed hold with no colon.
const HOLD_LINE_RE = /^(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|sec|secs|seconds?)\s+(.+)$/i;
// "Forward shoulder holds: 2, 1 min" -> two holds of a minute; "Plank: 1 min".
const HOLD_BODY_RE = /^(?:(\d+)\s*,\s*)?(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|sec|secs|seconds?)\b/i;
// "dead bugs: 32", "sit ups: 50 reps": reps with no weight and no set count.
const REPS_RE = /^(\d{1,3})\s*(?:reps?)?\s*$/i;

const BODYWEIGHT = ["pushup", "sit up", "plank", "dead bug", "toe touch",
  "knee tuck", "tuck jump", "copenhagen", "mountain climber"];

const SKIP = ["resistance band", "bands", "superset", "explosive",
  "neck exercises", "to add", "mid-back", "agility ladder", "ladder to sprint",
  "(ankle workout)", "scissors", "jumping jack", "icky shuffle", "hops and run",
  "hopscotch", "in-in-out-out", "in x 2"];

export type ParseResult = {
  sets: ParsedSet[];
  /** False when the date was assumed rather than written. */
  dated: boolean;
  days: number;
  unparsed: string[];
  years: number[];
};

export function parseLog(text: string, fallbackYear?: number,
                         defaultDay?: string): ParseResult {
  const out: ParsedSet[] = [];
  const unparsed: string[] = [];
  const years = new Set<number>();
  let year = fallbackYear ?? new Date().getFullYear();
  // No date line at all means "this is today" -- the common case when logging
  // straight after a session.
  let day: string | null = defaultDay ?? null;
  let sawDate = false;
  let mult = 1;
  // Inside an "Ab workout" block a bare number is reps of a bodyweight move.
  let inAb = false;

  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) { mult = 1; inAb = false; continue; }

    const ym = YEAR_RE.exec(s);
    if (ym) { year = 2000 + parseInt(ym[1]); years.add(year); continue; }

    const dm = DATE_RE.exec(s);
    if (dm) {
      const mo = parseInt(dm[1]), dy = parseInt(dm[2]);
      let yr = year;
      if (dm[3]) {
        const n = parseInt(dm[3]);
        yr = n < 100 ? 2000 + n : n;
      }
      const d = new Date(Date.UTC(yr, mo - 1, dy));
      day = d.getUTCMonth() === mo - 1 ? d.toISOString().slice(0, 10) : null;
      if (day) { years.add(yr); sawDate = true; }
      mult = 1; inAb = false;
      continue;
    }

    const wm = WORD_DATE_RE.exec(s);
    if (wm) {
      const mi = MONTHS.indexOf(wm[1].slice(0, 3).toLowerCase());
      if (mi >= 0) {
        const yr = wm[3] ? parseInt(wm[3]) : year;
        const d = new Date(Date.UTC(yr, mi, parseInt(wm[2])));
        day = d.getUTCMonth() === mi ? d.toISOString().slice(0, 10) : null;
        if (day) { years.add(yr); sawDate = true; }
        mult = 1;
        continue;
      }
    }

    const mm = MULT_RE.exec(s);
    if (mm) { mult = parseInt(mm[1]); continue; }

    if (!day) continue;

    // The core routine: a header, then its movements. Older entries are the
    // header alone, which still records that the routine was done.
    if (AB_HEADER_RE.test(s)) {
      const dur = /\((\d+)\s*min/i.exec(s);
      out.push({ day, exercise: "Ab workout", weight: null, reps: null, sets: 1,
                 pin: dur ? `${dur[1]} min` : null, notes: null });
      inAb = true;
      continue;
    }
    const hl = HOLD_LINE_RE.exec(s);
    if (hl && !s.includes(":")) {
      const nm = hl[3].trim();
      out.push({ day, exercise: nm[0].toUpperCase() + nm.slice(1), weight: null, reps: null,
                 sets: 1, pin: `${hl[1]} ${/^s/i.test(hl[2]) ? "sec" : "min"}`, notes: null });
      continue;
    }

    if (!s.includes(":")) continue;
    const low = s.toLowerCase();
    if (SKIP.some((k) => low.includes(k))) continue;

    const i = s.indexOf(":");
    const name = s.slice(0, i).trim();
    const rest = s.slice(i + 1).trim();
    if (!name || !rest) continue;

    const notes = [...rest.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const body = rest.replace(/\([^)]*\)/g, "").replace(/\^/g, "").trim();

    const pm = PIN_RE.exec(body);
    let pin = pm ? `${pm[1]} from ${pm[2]}` : null;
    let countedOnce = false;

    const bw = BODYWEIGHT.some((b) => name.toLowerCase().includes(b));
    const entries: { weight: number | null; reps: number | null; sets: number }[] = [];

    SET_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SET_RE.exec(body)) !== null) {
      const w = parseFloat(m[1]);
      const reps = (m[2].match(/\d+/g) ?? []).map(Number);
      if (bw) {
        entries.push({ weight: null, reps: Math.round(w), sets: reps[0] ?? 1 });
      } else {
        for (const r of reps) entries.push({ weight: w, reps: r, sets: 1 });
      }
    }

    if (!entries.length && pin === null) {
      const hb = HOLD_BODY_RE.exec(body);
      const rp = REPS_RE.exec(body);
      if (hb) {
        // A timed hold: "Plank: 1 min", "Shoulder holds: 2, 1 min".
        pin = `${hb[2]} ${/^s/i.test(hb[3]) ? "sec" : "min"}`;
        entries.push({ weight: null, reps: null, sets: hb[1] ? parseInt(hb[1]) : 1 });
        countedOnce = true;
      } else if (rp && (bw || inAb || /reps?$/i.test(body))) {
        // Bodyweight reps with no set count: one set of that many.
        entries.push({ weight: null, reps: parseInt(rp[1]), sets: 1 });
        countedOnce = true;
      }
    }
    if (!entries.length && pin === null) {
      // Prose with a number in it lands here. Kept out of the set maths, but
      // surfaced so nothing disappears silently.
      if (/\d/.test(body)) unparsed.push(s);
      continue;
    }
    if (!entries.length) entries.push({ weight: null, reps: null, sets: 1 });

    const explicit = entries.length > 1 || mult > 1 || bw || countedOnce;
    for (const e of entries) {
      out.push({
        day, exercise: name, weight: e.weight, reps: e.reps,
        sets: explicit ? e.sets * mult : DEFAULT_SETS,
        pin, notes: notes.join("; ") || null,
      });
    }
  }

  return {
    sets: out,
    dated: sawDate,
    days: new Set(out.map((r) => r.day)).size,
    unparsed,
    years: [...years].sort(),
  };
}

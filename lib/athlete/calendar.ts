/**
 * The full plan, week by week, from today to race day.
 *
 * Built from the same engine the morning email uses, so the calendar and the
 * daily call can never disagree. Structure follows the meso-cycle model: 4-week
 * blocks, each with one job, each ending in a recovery week where volume drops
 * and mobility work rises.
 */
import { racePlan, weekTemplate, mesocycle, readiness, type Slot } from "./decide";

export type CalendarDay = {
  date: string;
  dow: string;
  kind: string;
  note: string;
  detail: string;
  today: boolean;
};

export type CalendarWeek = {
  index: number;
  start: string;
  end: string;
  phase: string;
  job: string;
  week_in_block: number;
  recovery_week: boolean;
  long_run_mi: number;
  easy_run_min: number;
  days: CalendarDay[];
  current: boolean;
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, n: number) => iso(new Date(Date.parse(day) + n * DAY));
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing `day`. */
function monday(day: string) {
  const d = new Date(day + "T00:00:00Z");
  return shift(day, -((d.getUTCDay() + 6) % 7));
}

/** Session detail for a slot, given where the plan is that week. */
function detailFor(kind: string, longMi: number, easyMin: number, z2: number,
                   recoveryWeek: boolean, unlocked: ReturnType<typeof readiness>) {
  switch (kind) {
    case "long run":
      // longMi already carries the cutback: the ladder discounts recovery
      // weeks when it is built. Discounting again here would halve them.
      return recoveryWeek
        ? `${longMi} mi easy — cutback week`
        : `${longMi} mi, under ${z2} bpm`;
    case "run":
    case "pull+run":
      return `${recoveryWeek ? Math.round(easyMin * 0.75) : easyMin} min easy, under ${z2} bpm`
        + (kind === "pull+run" ? " + pull lift" : "");
    case "lacrosse":
      return "6pm — the biggest session of the week";
    case "legs":
      return recoveryWeek ? "Lighter. Hold weights, add the mobility block."
                          : "Rotates: quad / hip-adductor / posterior";
    case "push":
      return "Bench stays at 95 with pauses while the shoulder talks";
    case "pull":
      return "Rows, and the vertical pull that has been missing";
    case "tennis":
      return "About an hour. Costs a third of what a run costs";
    case "rest":
      return "Rest or a slow 15-minute walk";
    default:
      return "";
  }
}

export function buildCalendar(opts: {
  raceDate: string; today: string; recentLongMi: number; longestEver: number;
  lacrosseDays: string[]; tennisDays?: string[];
  z2: number; consistencyWeeks: number;
}): { weeks: CalendarWeek[]; unlocked: ReturnType<typeof readiness> } {
  const { raceDate, today, lacrosseDays, z2 } = opts;
  const plan = racePlan(raceDate, today, opts.recentLongMi, opts.longestEver);
  const template = weekTemplate(lacrosseDays, opts.tennisDays ?? []);
  const unlocked = readiness(opts.consistencyWeeks);

  const weeks: CalendarWeek[] = [];
  const firstMonday = monday(today);

  for (let w = 0; w < plan.weeks_out + 1; w++) {
    const idx = w;
    const start = shift(firstMonday, w * 7);
    // Phase reflects weeks actually trained, plus the weeks ahead in this plan.
    const meso = mesocycle(opts.consistencyWeeks + w, plan.weeks_out - w);

    // Long run and easy run both grow; the long run stays 1.4x the easy run at
    // most, because a long run three times the usual one is how people get hurt.
    const longMi = plan.schedule_all[Math.min(idx, plan.schedule_all.length - 1)];
    const easyBase = Math.min(70, Math.max(25,
      Math.round((plan.anchored_on_mi * 10) / 1.8 / 5) * 5));
    const easyMin = Math.min(70, easyBase + Math.floor(idx / 3) * 5);
    const ratio = easyMin >= 45 ? 1.8 : 1.4;
    const isRaceWeek = w === plan.weeks_out;
    const cappedLong = isRaceWeek
      ? 13.1
      : Math.min(longMi, Math.max(plan.anchored_on_mi,
          Math.round((easyMin * ratio) / 10 * 10) / 10));

    const days: CalendarDay[] = DOW.map((dw, i) => {
      const date = shift(start, i);
      const [kind, note] = (template[dw] ?? ["rest", ""]) as Slot;
      return {
        date, dow: dw, kind, note,
        detail: detailFor(kind, cappedLong, easyMin, z2, meso.recovery_week, unlocked),
        today: date === today,
      };
    });

    weeks.push({
      index: w, start, end: shift(start, 6),
      phase: meso.phase, job: meso.job,
      week_in_block: meso.week_in_block,
      recovery_week: meso.recovery_week,
      long_run_mi: cappedLong, easy_run_min: easyMin,
      days, current: w === 0,
    });
  }
  return { weeks, unlocked };
}

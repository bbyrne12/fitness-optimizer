/**
 * The plan, week by week: to race day when there is a race, otherwise twelve
 * weeks ahead.
 *
 * Built from the same engine the morning email uses, so the calendar and the
 * daily call can never disagree. Structure follows the meso-cycle model: 4-week
 * blocks, each with one job, each ending in a recovery week where volume drops
 * and mobility work rises.
 */
import {
  racePlan, weekTemplate, mesocycle, readiness, personalFrom, liftOf, clock,
  type Slot, type Personal, type PlanInputs,
} from "./decide";

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

const LIFT_WORD: Record<string, string> = {
  legs: "leg", pull: "pull", push: "push", upper: "upper-body", "full body": "full-body",
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Session detail for a slot, given where the plan is that week. */
function detailFor(kind: string, longMi: number, easyMin: number, z2: number,
                   recoveryWeek: boolean, personal: Personal) {
  if (kind === "long run") {
    // longMi already carries the cutback: the ladder discounts recovery
    // weeks when it is built. Discounting again here would halve them.
    return recoveryWeek ? `${longMi} mi easy — cutback week` : `${longMi} mi, under ${z2} bpm`;
  }

  if (kind === "run" || kind.endsWith("+run")) {
    const lift = liftOf(kind);
    return `${recoveryWeek ? Math.round(easyMin * 0.75) : easyMin} min easy, under ${z2} bpm`
      + (lift ? ` + ${LIFT_WORD[lift]} lift` : "");
  }

  const activity = personal.activities.find((a) => a.sport === kind);
  if (activity) {
    const cost = personal.activityCosts[activity.sport];
    const size = activity.intensity === "hard" ? "the biggest session of the week"
      : activity.intensity === "easy" ? "light, barely a recovery cost"
      : cost && cost.value < -0.5 ? `a real session, about ${Math.abs(cost.value).toFixed(0)} recovery points`
      : "a real session";
    return activity.time ? `${clock(activity.time)} — ${size}` : capitalise(size);
  }

  switch (kind) {
    case "legs":
      return recoveryWeek ? "Lighter. Hold weights, add the mobility block."
                          : "Rotates: quad / hip-adductor / posterior";
    case "push":
      return personal.cues.push ?? "Upper body — the cheapest session of the week";
    case "pull":
      return personal.cues.pull ?? "Rows and a vertical pull";
    case "upper":
      return personal.cues.upper ?? "Push or pull, whichever is due";
    case "full body":
      return personal.cues["full body"] ?? "What leads rotates each time";
    case "rest":
      return "Rest or a slow 15-minute walk";
    default:
      return "";
  }
}

export function buildCalendar(opts: {
  inputs: PlanInputs;
  today: string;
  recentLongMi: number;
  consistencyWeeks: number;
  personal?: Personal;
  /** Today's session when a missed lift was carried into it, so the calendar
   *  shows what the morning actually asked for. This week only. */
  carried?: { dow: string; slot: Slot } | null;
}): { weeks: CalendarWeek[]; unlocked: ReturnType<typeof readiness> } {
  const { inputs, today } = opts;
  const z2 = inputs.zone2;
  const plan = racePlan(inputs.race, today, opts.recentLongMi, inputs.longestRunMi);
  const personal = opts.personal ?? personalFrom({});
  const template = weekTemplate(inputs);
  const unlocked = readiness(opts.consistencyWeeks);

  const weeks: CalendarWeek[] = [];
  const firstMonday = monday(today);
  const horizon = inputs.race ? plan.weeks_out + 1 : plan.schedule_all.length;

  for (let w = 0; w < horizon; w++) {
    const idx = w;
    const start = shift(firstMonday, w * 7);
    // Phase reflects weeks actually trained, plus the weeks ahead in this plan.
    const meso = mesocycle(opts.consistencyWeeks + w,
                           inputs.race ? plan.weeks_out - w : Infinity);

    // Long run and easy run both grow; the long run stays 1.4x the easy run at
    // most, because a long run three times the usual one is how people get hurt.
    const longMi = plan.schedule_all[Math.min(idx, plan.schedule_all.length - 1)];
    const easyBase = Math.min(70, Math.max(25,
      Math.round((plan.anchored_on_mi * 10) / 1.8 / 5) * 5));
    const easyMin = Math.min(70, easyBase + Math.floor(idx / 3) * 5);
    const ratio = easyMin >= 45 ? 1.8 : 1.4;
    const raceWeek = inputs.race && w === plan.weeks_out ? inputs.race : null;
    const cappedLong = raceWeek
      ? raceWeek.miles
      : Math.min(longMi, Math.max(plan.anchored_on_mi,
          Math.round((easyMin * ratio) / 10 * 10) / 10));

    const days: CalendarDay[] = DOW.map((dw, i) => {
      const date = shift(start, i);
      const carried = w === 0 && opts.carried?.dow === dw ? opts.carried.slot : null;
      const [kind, note] = carried ?? (template[dw] ?? ["rest", ""]) as Slot;
      return {
        date, dow: dw, kind, note,
        detail: detailFor(kind, cappedLong, easyMin, z2, meso.recovery_week, personal),
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

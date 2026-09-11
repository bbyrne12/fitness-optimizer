/**
 * Evidence-backed protocols, with sources.
 *
 * Everything here is external research, kept separate from decide.ts so it can
 * be re-checked and dated independently of the engine. Each entry carries what
 * the evidence says, the number it implies, and where it came from -- so a
 * recommendation on the page can always be traced to something other than my
 * opinion.
 *
 * Last reviewed: 2026-09-11.
 * To refresh: re-run the searches in the `query` fields, update `value`,
 * `finding` and `reviewed`, and note anything that contradicts what is here.
 */

export type Protocol = {
  id: string;
  title: string;
  finding: string;
  /** What it means for this athlete specifically. */
  applied: string;
  source: string;
  query: string;
  reviewed: string;
  confidence: "strong" | "moderate" | "limited";
};

export const PROTOCOLS: Protocol[] = [
  {
    id: "polarized",
    title: "Polarized intensity distribution",
    finding:
      "Polarized training (~80% easy, ~20% genuinely hard, little at threshold) " +
      "produced the largest gains in a controlled comparison against threshold, " +
      "high-intensity and high-volume training: VO2peak +11.7%, time to " +
      "exhaustion +17.4%, peak velocity +5.1% in well-trained endurance athletes.",
    applied:
      "Easy days stay under the zone 2 ceiling; one short hard session per week " +
      "once base is established. The middle -- threshold -- is what gets avoided, " +
      "because it costs the most recovery for the least adaptation.",
    source: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3912323/",
    query: "polarized training vs threshold endurance VO2peak randomized",
    reviewed: "2026-09-11",
    confidence: "strong",
  },
  {
    id: "hrv-guided",
    title: "HRV-guided training load",
    finding:
      "A meta-analysis found that adjusting daily training to morning HRV " +
      "produced better VO2max gains than a fixed prescribed plan.",
    applied:
      "This is what the whole system does: recovery and a 3-morning HRV streak " +
      "decide whether today is as planned, reduced, or dropped.",
    source: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7663087/",
    query: "HRV-guided training VO2max systematic review meta-analysis",
    reviewed: "2026-09-11",
    confidence: "strong",
  },
  {
    id: "slow-breathing",
    title: "Slow breathing at ~6 breaths/min",
    finding:
      "A systematic review and meta-analysis found voluntary slow breathing " +
      "raises vagally-mediated HRV during the session, immediately after a " +
      "single session, and after multi-session interventions. Reported RMSSD " +
      "gains of roughly 5-15 ms over 4-6 weeks of practice.",
    applied:
      "HRV is the stated primary goal, and this is the cheapest lever available: " +
      "10 minutes at 6 breaths/min. There are already 24 logged meditation " +
      "sessions, so the habit exists -- it just needs a cadence.",
    source: "https://www.sciencedirect.com/science/article/abs/pii/S0149763422002007",
    query: "voluntary slow breathing heart rate variability systematic review meta-analysis",
    reviewed: "2026-09-11",
    confidence: "strong",
  },
  {
    id: "cadence",
    title: "Running cadence and tibial load",
    finding:
      "Increasing cadence 5-10% reduces peak tibial acceleration and lower-leg " +
      "load at the same running speed. Runners below ~170 spm benefit most.",
    applied:
      "Cadence sits at 153-160 spm and the shins flare on longer runs. Target is " +
      "165-170. WHOOP's API returns no cadence at all, so this one has to come " +
      "from the watch and be entered by hand.",
    source: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7892879/",
    query: "running cadence 5-10% increase tibial acceleration shin splints MTSS",
    reviewed: "2026-09-11",
    confidence: "moderate",
  },
  {
    id: "long-run-ratio",
    title: "Long run relative to the usual easy run",
    finding:
      "A long run should be 20-40% longer than your usual easy run -- not " +
      "double, not extreme -- and should feel easier than you want it to. Once " +
      "a long run becomes moderate or hard effort, recovery cost rises sharply, " +
      "injury risk jumps, and the aerobic adaptation it exists for is reduced.",
    applied:
      "The easy run has to grow alongside the long one. A 25-minute easy run " +
      "cannot support a 110-minute long run; the ladder to 13.1 only works if " +
      "midweek duration climbs with it.",
    source: "Ruut Labs HRV course, topic 11.5 (run types)",
    query: "long run 20-40% longer than easy run duration not intensity",
    reviewed: "2026-09-11",
    confidence: "moderate",
  },
  {
    id: "readiness-gates",
    title: "Readiness criteria for adding run types",
    finding:
      "Long runs: after 3-4 weeks of consistent running. Tempo: after 2-3 " +
      "months. Intervals: after 4-6 months, with all other run types " +
      "comfortable and recovery strong. Adding a run type before the criteria " +
      "are met is described as the fastest way to invite injury.",
    applied:
      "Gates on measured consistency -- consecutive weeks with at least two " +
      "runs -- rather than on weeks remaining until the race. The calendar does " +
      "not know whether the training happened.",
    source: "Ruut Labs HRV course, topic 11.4 (readiness criteria)",
    query: "when to add long runs tempo intervals readiness criteria beginner",
    reviewed: "2026-09-11",
    confidence: "moderate",
  },
  {
    id: "runner-isometrics",
    title: "Mobility and isometric strength for runners",
    finding:
      "A 15-20 minute calm block: ankle isometric holds 2 x 45s, bent-knee calf " +
      "holds 2 x 40s, hip bridge holds 3 x 30s, side plank 2 x 30s, spinal " +
      "mobility 3 min. Framed as joint protection and tendon strength -- the " +
      "work that keeps injuries away once mileage increases.",
    applied:
      "Hits three open flags at once: calves at 1.4 sets/wk, core at 0.2, and " +
      "the shin history. Cheaper than adding a session, and it is the same " +
      "tissue the 2024 ankle rehab block was protecting.",
    source: "Ruut Labs HRV course, topic 11.3 (foundation session)",
    query: "runner ankle isometric calf holds hip bridge injury prevention mileage",
    reviewed: "2026-09-11",
    confidence: "moderate",
  },
];

/** Polarized targets, as fractions of total training time. */
export const INTENSITY_TARGET = {
  easy_min: 0.75,       // zones 0-2
  threshold_max: 0.12,  // zone 3 -- the zone to avoid living in
  hard_min: 0.08,       // zones 4-5; ~20% is the textbook figure, 8% a floor
};

export const CADENCE_TARGET = { current: 157, target_low: 165, target_high: 170 };

/**
 * Watch VO2 max estimates, and why this system does not trust them.
 *
 * The figures: 50-51 from Sep 2025 through Apr 2026 (Eastern, sea level),
 * 53 in May, 57 in June, then 55 / 54 / 52 through September. The move to
 * Denver was 17 May 2026 and the return 12 Aug 2026, both confirmed by the
 * timezone offsets on the WHOOP records.
 *
 * Two things make the number unusable as a fitness signal here:
 *   1. It is derived from the pace-to-heart-rate relationship on runs, and it
 *      rose while runs averaged 158-160 bpm and fell once they moved to 128-132.
 *      It is measuring run intensity, not aerobic capacity.
 *   2. It is computed from two or three runs a month, 30-60 minutes in total.
 *
 * Altitude may contribute, but it does not fit cleanly: the decline began in
 * July while still in Denver, with strain falling throughout the stay.
 *
 * Consequence: if intensity goes back in, this number will probably rise. That
 * is not evidence the training worked. Judge the build on pace at a fixed heart
 * rate on the long run instead.
 */
export const VO2MAX_CAVEAT = {
  sea_level_baseline: [50, 51] as const,
  altitude_peak: 57,
  latest: 52,
  trust_as_fitness_signal: false,
};

export function protocolById(id: string) {
  return PROTOCOLS.find((p) => p.id === id) ?? null;
}

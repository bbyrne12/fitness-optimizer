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
];

/** Polarized targets, as fractions of total training time. */
export const INTENSITY_TARGET = {
  easy_min: 0.75,       // zones 0-2
  threshold_max: 0.12,  // zone 3 -- the zone to avoid living in
  hard_min: 0.08,       // zones 4-5; ~20% is the textbook figure, 8% a floor
};

export const CADENCE_TARGET = { current: 157, target_low: 165, target_high: 170 };

export function protocolById(id: string) {
  return PROTOCOLS.find((p) => p.id === id) ?? null;
}

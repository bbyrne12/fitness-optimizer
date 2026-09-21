/**
 * What the demo coach shows, kept free of server code so the chat can import
 * it. The demo athlete is invented; see lib/athlete/demo.ts.
 */

/** Questions a reviewer is likely to ask first. Written against the demo
 *  athlete's own week (pull on Wednesday, basketball Tuesday and Thursday,
 *  the long run on Saturday, a left knee in the notes), so none of them opens
 *  with a premise the coach has to correct. Replies to these exact prompts
 *  are cached for the day, so they cost nothing after the first. */
export const DEMO_STARTERS = [
  "Why is Wednesday a pull day?",
  "My long run felt terrible, what should change?",
  "What does basketball cost me?",
  "How are you handling my knee?",
];

export type DemoLimit = "visitor" | "network" | "budget" | "turns";

export type SampleTurn = { role: "user" | "assistant"; content: string; applied?: string[] };

/** Shown when the demo coach is out of messages for the day, so a reviewer
 *  still sees what it does. A real conversation with the demo athlete,
 *  recorded word for word, including the plan change it made. */
export const DEMO_SAMPLE: SampleTurn[] = [
  {"role": "user", "content": "What does basketball cost me?"},
  {"role": "assistant", "content": "Basketball is your priciest session by a good margin — about 8.1 recovery points below a rest day next morning, more than double any of your lift days (leg day is next at -4.6). Since it's on your calendar twice a week, that's roughly 16 points off your week just from those two nights."},
  {"role": "user", "content": "My long run on Saturday keeps feeling terrible. Is that the basketball?"},
  {"role": "assistant", "content": "Basketball's cost lands the next morning, and by Saturday you're two days out from Thursday's game — your recovery scores going into the long run (84%, 70%) don't show it dragging low. It's more likely the accumulated week (basketball twice, three lifts, then the run) rather than Thursday specifically. If Saturday keeps feeling rough, I could shift the long run to Sunday to add a buffer day — want me to try that?"},
  {"role": "user", "content": "Move the long run to Sunday then."},
  {"role": "assistant", "content": "Done — long run is now Sunday, with Saturday's push lift shifting to sit before it.", "applied": ["Long run: Sunday"]},
];
export const DEMO_SAMPLE_RECORDED = "21 September 2026";

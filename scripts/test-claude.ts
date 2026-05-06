import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

async function main() {

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY not found in environment");
  process.exit(1);
}

console.log("API key present:", apiKey.slice(0, 8) + "...");

const client = new Anthropic({ apiKey });

const prompt = `You are a professional fitness coach. Return a JSON object with exactly this shape:
{
  "coachingNote": "A short 2-3 sentence coaching note.",
  "exerciseRationales": { "1": "Short rationale for exercise 1." }
}
Return only raw JSON. No markdown, no code fences.`;

try {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error("No text block in response. Content:", message.content);
    process.exit(1);
  }

  console.log("\nRaw response text:");
  console.log(JSON.stringify(textBlock.text));

  const raw = textBlock.text.trim();
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    console.log("\nDetected code fences — stripping them");
  }
  const jsonText = fenceMatch ? fenceMatch[1].trim() : raw;

  const parsed = JSON.parse(jsonText);
  console.log("\nParsed successfully:", parsed);
  } catch (err) {
    console.error("\nFailed:", err);
  }
}

main();

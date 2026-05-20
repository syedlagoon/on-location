// Caption generator — calls Anthropic API to produce per-month summaries.
// Run with: npm run captions
// Requires ANTHROPIC_API_KEY in .env

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

interface CountsData {
  metadata: {
    dateRange: { min: string; max: string };
    categories?: string[];
  };
  byZip: Record<string, Record<string, number>>;
  byCommunityDistrict: Record<string, Record<string, number>>;
}

interface CaptionsOutput {
  metadata: { generatedAt: string; model: string };
  cd: Record<string, string>;
  zip: Record<string, string>;
}

const MODEL = "claude-sonnet-4-20250514";

function generateMonths(min: string, max: string): string[] {
  const months: string[] = [];
  let [year, month] = min.split("-").map(Number);
  const [maxYear, maxMonth] = max.split("-").map(Number);
  while (year < maxYear || (year === maxYear && month <= maxMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return months;
}

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split("-").map(Number);
  return new Date(year, month - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function topAreas(
  data: Record<string, Record<string, number>>,
  month: string,
  n: number,
): Array<{ name: string; count: number }> {
  const entries: Array<{ name: string; count: number }> = [];
  for (const [area, months] of Object.entries(data)) {
    const c = months[month] ?? 0;
    if (c > 0) entries.push({ name: area, count: c });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, n);
}

function totalForMonth(
  data: Record<string, Record<string, number>>,
  month: string,
): number {
  let sum = 0;
  for (const months of Object.values(data)) {
    sum += months[month] ?? 0;
  }
  return sum;
}

async function generateCaptionBatch(
  client: Anthropic,
  batchData: Array<{
    month: string;
    formattedMonth: string;
    topAreas: Array<{ name: string; count: number }>;
    totalCount: number;
    prevTotalCount: number | null;
  }>,
): Promise<Record<string, string>> {
  const monthBlocks = batchData.map((d) => {
    const delta = d.prevTotalCount !== null
      ? ` (previous month: ${d.prevTotalCount})`
      : "";
    const tops = d.topAreas.map((a, i) => `  ${i + 1}. ${a.name}: ${a.count}`).join("\n");
    return `### ${d.month} (${d.formattedMonth})\nTotal: ${d.totalCount}${delta}\nTop areas:\n${tops}`;
  }).join("\n\n");

  const prompt = `You write one-line captions for a data visualization of NYC film permit activity.

For each month below, write a punchy caption (max 80 characters). Do NOT include the month name. Highlight the most interesting pattern — a leader, a surge, a drop, a surprise.

${monthBlocks}

Respond with ONLY a JSON object mapping month keys to captions, like:
{"2024-01": "Greenpoint leads the city with 47 shoots", "2024-02": "Filming drops 30% as winter bites"}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  if (text.type !== "text") return {};
  try {
    return JSON.parse(text.text) as Record<string, string>;
  } catch {
    console.warn("  Failed to parse batch response, skipping");
    return {};
  }
}

async function main(): Promise<void> {
  console.log("=== On Location — caption generator ===\n");

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY in .env");
  }

  const client = new Anthropic();
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const countsPath = join(thisDir, "..", "public", "data", "counts.json");
  const counts: CountsData = JSON.parse(await readFile(countsPath, "utf-8"));

  const { min, max } = counts.metadata.dateRange;
  const months = generateMonths(min, max);

  const output: CaptionsOutput = {
    metadata: { generatedAt: new Date().toISOString(), model: MODEL },
    cd: {},
    zip: {},
  };

  // Generate captions for both unit modes
  for (const [unitLabel, data] of [
    ["cd", counts.byCommunityDistrict] as const,
    ["zip", counts.byZip] as const,
  ]) {
    console.log(`Generating ${unitLabel} captions…`);
    const BATCH_SIZE = 5;

    for (let i = 0; i < months.length; i += BATCH_SIZE) {
      const batch = months.slice(i, i + BATCH_SIZE);
      const batchData = batch.map((m) => ({
        month: m,
        formattedMonth: formatMonth(m),
        topAreas: topAreas(data, m, 5),
        totalCount: totalForMonth(data, m),
        prevTotalCount: months.indexOf(m) > 0
          ? totalForMonth(data, months[months.indexOf(m) - 1])
          : null,
      }));

      const captions = await generateCaptionBatch(client, batchData);
      for (const [month, caption] of Object.entries(captions)) {
        output[unitLabel][month] = caption;
      }

      console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(months.length / BATCH_SIZE)}`);
      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const outPath = join(thisDir, "..", "public", "data", "captions.json");
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error("Caption generation failed:", err);
  process.exit(1);
});

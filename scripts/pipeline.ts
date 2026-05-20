// Data pipeline — fetch, normalize, aggregate NYC film permit data.
// Run with: npm run data
//
// Source: NYC Open Data Film Permits, dataset tg4x-b46p.
// Coverage starts ~2023. The dataset has a ~3-month posting delay — this is
// publisher policy, not a bug.
//
// No production/film titles exist in this data by design (see SPEC.md non-goals).

import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SODA_BASE = "https://data.cityofnewyork.us/resource/tg4x-b46p.json";
const PAGE_SIZE = 50_000;

// Only fetch the fields we actually need.
const SELECT_FIELDS = [
  "eventid",
  "eventtype",
  "startdatetime",
  "borough",
  "communityboard_s",
  "zipcode_s",
  "category",
  "subcategoryname",
].join(",");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SodaPermitRow {
  eventid: string;
  eventtype: string;
  startdatetime?: string;
  borough?: string;
  communityboard_s?: string;
  zipcode_s?: string;
  category?: string;
  subcategoryname?: string;
}

/** Nested map: areaId → month → count */
type AreaMonthCounts = Map<string, Map<string, number>>;

interface CountsOutput {
  metadata: {
    generatedAt: string;
    totalShoots: number;
    dateRange: { min: string; max: string };
  };
  byZip: Record<string, Record<string, number>>;
  byCommunityDistrict: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a multi-value field into clean individual values.
 *
 * The SODA zip and community-board fields are messy: a single row can contain
 * comma-separated lists ("10001, 10002"), trailing commas ("10001,"), literal
 * "N/A" entries, and stray whitespace. This function normalizes all of that
 * into an array of usable values (or an empty array if nothing survives).
 */
function splitMultiValueField(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && s.toUpperCase() !== "N/A");
}

/** Extract YYYY-MM from an ISO-ish datetime string. */
function extractMonth(iso: string): string {
  return iso.slice(0, 7); // "2024-03-15T..." → "2024-03"
}

/**
 * Build a community-district key like "Manhattan-5" from a borough name and a
 * board string (which may be just a number, or prefixed text we strip).
 */
function buildCommunityDistrictId(
  borough: string,
  board: string,
): string | null {
  const num = board.replace(/\D/g, "");
  if (!num || !borough) return null;
  return `${borough}-${parseInt(num, 10)}`;
}

/** Increment a nested Map counter: map[areaId][month]++ */
function incrementCount(
  map: AreaMonthCounts,
  areaId: string,
  month: string,
): void {
  let months = map.get(areaId);
  if (!months) {
    months = new Map();
    map.set(areaId, months);
  }
  months.set(month, (months.get(month) ?? 0) + 1);
}

/** Convert nested Maps to sorted plain objects for deterministic JSON output. */
function mapOfMapsToRecord(
  map: AreaMonthCounts,
): Record<string, Record<string, number>> {
  const outer: Record<string, Record<string, number>> = {};
  const sortedAreaKeys = [...map.keys()].sort();
  for (const areaId of sortedAreaKeys) {
    const months = map.get(areaId)!;
    const inner: Record<string, number> = {};
    const sortedMonths = [...months.keys()].sort();
    for (const m of sortedMonths) {
      inner[m] = months.get(m)!;
    }
    outer[areaId] = inner;
  }
  return outer;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchAllPermits(): Promise<SodaPermitRow[]> {
  const token = process.env["NYC_APP_TOKEN"];
  if (!token) {
    throw new Error(
      "Missing NYC_APP_TOKEN environment variable. " +
        "Get one at https://data.cityofnewyork.us/profile/edit/developer_settings",
    );
  }

  const allRows: SodaPermitRow[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      $where: "eventtype='Shooting Permit'",
      $select: SELECT_FIELDS,
      $order: "eventid",
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
      $$app_token: token,
    });

    const url = `${SODA_BASE}?${params}`;
    console.log(`  Fetching offset=${offset} …`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SODA API error: ${res.status} ${res.statusText}`);
    }

    const page = (await res.json()) as SodaPermitRow[];
    if (page.length === 0) break;

    allRows.push(...page);
    offset += page.length;

    // If we got fewer rows than the page size, we've reached the end.
    if (page.length < PAGE_SIZE) break;
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

interface AggregateResult {
  byZip: AreaMonthCounts;
  byCommunityDistrict: AreaMonthCounts;
  totalShoots: number;
  minMonth: string;
  maxMonth: string;
}

function aggregate(rows: SodaPermitRow[]): AggregateResult {
  const byZip: AreaMonthCounts = new Map();
  const byCD: AreaMonthCounts = new Map();
  let totalShoots = 0;
  let minMonth = "9999-99";
  let maxMonth = "0000-00";

  for (const row of rows) {
    if (!row.startdatetime) continue;

    const month = extractMonth(row.startdatetime);
    totalShoots++;

    if (month < minMonth) minMonth = month;
    if (month > maxMonth) maxMonth = month;

    // Zip codes — a single permit can list multiple zips.
    const zips = splitMultiValueField(row.zipcode_s);
    for (const zip of zips) {
      // Only keep values that look like 5-digit US zip codes.
      if (/^\d{5}$/.test(zip)) {
        incrementCount(byZip, zip, month);
      }
    }

    // Community districts — combine borough + board number.
    const boards = splitMultiValueField(row.communityboard_s);
    const borough = row.borough?.trim();
    if (borough) {
      for (const board of boards) {
        const cdId = buildCommunityDistrictId(borough, board);
        if (cdId) {
          incrementCount(byCD, cdId, month);
        }
      }
    }
  }

  return {
    byZip,
    byCommunityDistrict: byCD,
    totalShoots,
    minMonth,
    maxMonth,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== On Location — data pipeline ===\n");

  // 1. Fetch
  console.log("Fetching shooting permits from SODA API…");
  const rows = await fetchAllPermits();
  console.log(`  ✓ ${rows.length} records fetched.\n`);

  // 2. Aggregate
  console.log("Aggregating counts…");
  const result = aggregate(rows);
  console.log(`  ✓ ${result.totalShoots} shoots (raw permit count).`);
  console.log(`  ✓ ${result.byZip.size} unique zip codes.`);
  console.log(
    `  ✓ ${result.byCommunityDistrict.size} unique community districts.`,
  );
  console.log(`  ✓ Date range: ${result.minMonth} → ${result.maxMonth}\n`);

  // 3. Build output
  const output: CountsOutput = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalShoots: result.totalShoots,
      dateRange: { min: result.minMonth, max: result.maxMonth },
    },
    byZip: mapOfMapsToRecord(result.byZip),
    byCommunityDistrict: mapOfMapsToRecord(result.byCommunityDistrict),
  };

  // 4. Write JSON
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const outPath = join(thisDir, "..", "public", "data", "counts.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${outPath}\n`);
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});

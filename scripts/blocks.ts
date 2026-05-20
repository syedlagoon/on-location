// Block-level data pipeline — geocode film permit locations to coordinates.
// Run with: npm run blocks
//
// Requires NYC_GEO_KEY environment variable (NYC Geoclient API subscription key).
// First run is slow (10-30 min for ~30K intersections) due to geocoding.
// Subsequent runs use the cache in scripts/.geocode-cache.json.
//
// Source: NYC Open Data Film Permits, dataset tg4x-b46p.

import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SODA_BASE = "https://data.cityofnewyork.us/resource/tg4x-b46p.json";
const PAGE_SIZE = 50_000;
const GEOCLIENT_BASE =
  "https://api.nyc.gov/geo/geoclient/v1/intersection.json";

// Concurrency controls for geocoding
const MAX_CONCURRENT = 5;
const DELAY_MS = 100;

// Coordinate precision — 4 decimals is ~11m, sufficient for block-level grid
const COORD_PRECISION = 4;

// Only fetch the fields we need for block-level data.
const SELECT_FIELDS = [
  "eventid",
  "eventtype",
  "startdatetime",
  "borough",
  "parkingheld",
].join(",");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SodaPermitRow {
  eventid: string;
  eventtype: string;
  startdatetime?: string;
  borough?: string;
  parkingheld?: string;
}

interface BlockSegment {
  street: string;
  crossA: string;
  crossB: string;
}

interface GeocodeCacheEntry {
  lat: number;
  lng: number;
}

/** lat,lng grid key -> month -> count */
type GridAggregation = Map<string, Map<string, number>>;

interface BlockPoint {
  lng: number;
  lat: number;
  months: Record<string, number>;
}

interface BlocksOutput {
  metadata: {
    generatedAt: string;
    totalPoints: number;
    geocodeHitRate: number;
  };
  points: BlockPoint[];
}

// ---------------------------------------------------------------------------
// Street name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize common street name abbreviations to their full forms.
 * This improves geocoding hit rate by standardizing how streets are named
 * across different permit records.
 *
 * We use word-boundary matching to avoid mangling street names like "STANTON"
 * or "AVERY" — only standalone abbreviations are expanded.
 */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bST\b\.?/g, "STREET"],
  [/\bAVE\b\.?/g, "AVENUE"],
  [/\bBLVD\b\.?/g, "BOULEVARD"],
  [/\bDR\b\.?/g, "DRIVE"],
  [/\bPL\b\.?/g, "PLACE"],
  [/\bRD\b\.?/g, "ROAD"],
  [/\bCT\b\.?/g, "COURT"],
  [/\bLN\b\.?/g, "LANE"],
  [/\bTER\b\.?/g, "TERRACE"],
  [/\bPKY\b\.?/g, "PARKWAY"],
  [/\bW\.?\b/g, "WEST"],
  [/\bE\.?\b/g, "EAST"],
  [/\bN\.?\b/g, "NORTH"],
  [/\bS\.?\b/g, "SOUTH"],
];

function normalizeStreetName(name: string): string {
  let result = name.trim().toUpperCase();
  for (const [pattern, replacement] of ABBREVIATIONS) {
    result = result.replace(pattern, replacement);
  }
  // Collapse multiple spaces that may result from replacements
  return result.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Parking-held segment parser
// ---------------------------------------------------------------------------

/**
 * Parse the `parkingheld` field into block segments.
 *
 * The field contains comma-separated entries like:
 *   "BROADWAY between WEST 42 STREET and WEST 43 STREET, 7 AVENUE between ..."
 *
 * We regex-match each segment for the "STREET between CROSS_A and CROSS_B" pattern.
 * Segments with "DEAD END" as a cross street are skipped — they can't be geocoded
 * as an intersection.
 */
function parseBlockSegments(parkingheld: string): BlockSegment[] {
  const segments: BlockSegment[] = [];
  // Split on comma, but the pattern itself may contain commas in street names
  // so we match the pattern globally on the full string instead.
  const regex = /([^,]+?)\s+between\s+(.+?)\s+and\s+(.+?)(?:,|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(parkingheld)) !== null) {
    const street = match[1].trim();
    const crossA = match[2].trim();
    const crossB = match[3].trim();

    // Skip segments with DEAD END — these can't be geocoded as intersections
    if (
      crossA.toUpperCase() === "DEAD END" ||
      crossB.toUpperCase() === "DEAD END"
    ) {
      continue;
    }

    if (street && crossA && crossB) {
      segments.push({ street, crossA, crossB });
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Geocode cache
// ---------------------------------------------------------------------------

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(THIS_DIR, ".geocode-cache.json");

let geocodeCache: Record<string, GeocodeCacheEntry> = {};

async function loadCache(): Promise<void> {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    geocodeCache = JSON.parse(raw) as Record<string, GeocodeCacheEntry>;
    console.log(
      `  Loaded geocode cache: ${Object.keys(geocodeCache).length} entries`,
    );
  } catch {
    // Cache doesn't exist yet — start fresh
    geocodeCache = {};
    console.log("  No geocode cache found, starting fresh.");
  }
}

async function saveCache(): Promise<void> {
  await writeFile(CACHE_PATH, JSON.stringify(geocodeCache));
  console.log(
    `  Saved geocode cache: ${Object.keys(geocodeCache).length} entries`,
  );
}

function cacheKey(
  street1: string,
  street2: string,
  borough: string,
): string {
  return `${normalizeStreetName(street1)}|${normalizeStreetName(street2)}|${borough.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// NYC Geoclient API
// ---------------------------------------------------------------------------

/**
 * Geocode a single intersection via the NYC Geoclient API.
 * Returns { lat, lng } on success, or null on failure.
 *
 * The API uses the Ocp-Apim-Subscription-Key header for authentication.
 */
async function geocodeIntersection(
  street1: string,
  street2: string,
  borough: string,
  apiKey: string,
): Promise<GeocodeCacheEntry | null> {
  const key = cacheKey(street1, street2, borough);
  if (geocodeCache[key]) return geocodeCache[key];

  const params = new URLSearchParams({
    crossStreetOne: normalizeStreetName(street1),
    crossStreetTwo: normalizeStreetName(street2),
    borough: borough,
  });

  const url = `${GEOCLIENT_BASE}?${params}`;

  try {
    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      intersection?: { latitude?: number; longitude?: number };
    };

    const lat = data.intersection?.latitude;
    const lng = data.intersection?.longitude;

    if (lat != null && lng != null && lat !== 0 && lng !== 0) {
      const entry: GeocodeCacheEntry = { lat, lng };
      geocodeCache[key] = entry;
      return entry;
    }
  } catch {
    // Network error — return null, will be counted as a miss
  }

  return null;
}

// ---------------------------------------------------------------------------
// Concurrent queue with rate limiting
// ---------------------------------------------------------------------------

/**
 * Process an array of tasks with bounded concurrency and inter-batch delay.
 *
 * Uses a simple semaphore pattern: maintains a pool of at most `concurrency`
 * in-flight promises, inserting a small delay between launches to avoid
 * overwhelming the API.
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      if (delayMs > 0 && idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      results[idx] = await fn(items[idx]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Fetch permits from SODA
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
    console.log(`  Fetching offset=${offset} ...`);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SODA API error: ${res.status} ${res.statusText}`);
    }

    const page = (await res.json()) as SodaPermitRow[];
    if (page.length === 0) break;

    allRows.push(...page);
    offset += page.length;

    if (page.length < PAGE_SIZE) break;
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Extract month from ISO datetime
// ---------------------------------------------------------------------------

function extractMonth(iso: string): string {
  return iso.slice(0, 7); // "2024-03-15T..." -> "2024-03"
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

interface GeoTask {
  street: string;
  crossStreet: string;
  borough: string;
}

async function main(): Promise<void> {
  console.log("=== On Location — block-level pipeline ===\n");

  const geoKey = process.env["NYC_GEO_KEY"];
  if (!geoKey) {
    throw new Error(
      "Missing NYC_GEO_KEY environment variable. " +
        "Register at https://api-portal.nyc.gov/ for a Geoclient API key.",
    );
  }

  // 1. Fetch permits
  console.log("Fetching shooting permits from SODA API...");
  const rows = await fetchAllPermits();
  console.log(`  ${rows.length} records fetched.\n`);

  // 2. Parse block segments from parkingheld
  console.log("Parsing parkingheld fields...");

  interface ParsedPermit {
    month: string;
    borough: string;
    segments: BlockSegment[];
  }

  const parsed: ParsedPermit[] = [];
  let totalSegments = 0;
  let skippedNoParking = 0;

  for (const row of rows) {
    if (!row.startdatetime || !row.borough || !row.parkingheld) {
      skippedNoParking++;
      continue;
    }

    const segments = parseBlockSegments(row.parkingheld);
    if (segments.length === 0) continue;

    totalSegments += segments.length;
    parsed.push({
      month: extractMonth(row.startdatetime),
      borough: row.borough.trim(),
      segments,
    });
  }

  console.log(`  ${parsed.length} permits with parseable segments.`);
  console.log(`  ${totalSegments} total block segments found.`);
  console.log(`  ${skippedNoParking} permits skipped (no parkingheld).\n`);

  // 3. Build unique geocoding tasks (deduplicate intersections)
  console.log("Building geocoding task list...");
  const uniqueTasks = new Map<string, GeoTask>();

  for (const permit of parsed) {
    for (const seg of permit.segments) {
      // For each segment, we need to geocode street+crossA and street+crossB
      // to get a midpoint. So we have two intersection lookups per segment.
      const keyA = cacheKey(seg.street, seg.crossA, permit.borough);
      if (!uniqueTasks.has(keyA)) {
        uniqueTasks.set(keyA, {
          street: seg.street,
          crossStreet: seg.crossA,
          borough: permit.borough,
        });
      }

      const keyB = cacheKey(seg.street, seg.crossB, permit.borough);
      if (!uniqueTasks.has(keyB)) {
        uniqueTasks.set(keyB, {
          street: seg.street,
          crossStreet: seg.crossB,
          borough: permit.borough,
        });
      }
    }
  }

  console.log(`  ${uniqueTasks.size} unique intersections to geocode.\n`);

  // 4. Load cache and geocode
  console.log("Loading geocode cache...");
  await loadCache();

  // Filter to only uncached tasks
  const uncachedTasks: GeoTask[] = [];
  for (const [key, task] of uniqueTasks) {
    if (!geocodeCache[key]) {
      uncachedTasks.push(task);
    }
  }

  console.log(
    `  ${uniqueTasks.size - uncachedTasks.length} already cached, ${uncachedTasks.length} need geocoding.\n`,
  );

  if (uncachedTasks.length > 0) {
    console.log(
      `Geocoding ${uncachedTasks.length} intersections (${MAX_CONCURRENT} concurrent, ${DELAY_MS}ms delay)...`,
    );
    console.log(
      "  This may take a while on first run (10-30 min for ~30K intersections).",
    );

    let completed = 0;
    const logInterval = Math.max(1, Math.floor(uncachedTasks.length / 20));

    await processWithConcurrency(
      uncachedTasks,
      MAX_CONCURRENT,
      DELAY_MS,
      async (task) => {
        const result = await geocodeIntersection(
          task.street,
          task.crossStreet,
          task.borough,
          geoKey,
        );
        completed++;
        if (completed % logInterval === 0 || completed === uncachedTasks.length) {
          const pct = ((completed / uncachedTasks.length) * 100).toFixed(1);
          console.log(`  Progress: ${completed}/${uncachedTasks.length} (${pct}%)`);
        }
        return result;
      },
    );

    // Save cache after geocoding
    await saveCache();
    console.log();
  }

  // 5. Aggregate: compute midpoints and snap to grid
  console.log("Aggregating block-level data...");

  const grid: GridAggregation = new Map();
  let geocodeHits = 0;
  let geocodeMisses = 0;

  for (const permit of parsed) {
    for (const seg of permit.segments) {
      const keyA = cacheKey(seg.street, seg.crossA, permit.borough);
      const keyB = cacheKey(seg.street, seg.crossB, permit.borough);

      const ptA = geocodeCache[keyA];
      const ptB = geocodeCache[keyB];

      if (!ptA || !ptB) {
        geocodeMisses++;
        continue;
      }

      geocodeHits++;

      // Midpoint of the two intersections, snapped to grid
      const lat = Number(((ptA.lat + ptB.lat) / 2).toFixed(COORD_PRECISION));
      const lng = Number(((ptA.lng + ptB.lng) / 2).toFixed(COORD_PRECISION));
      const gridKey = `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;

      let monthMap = grid.get(gridKey);
      if (!monthMap) {
        monthMap = new Map();
        grid.set(gridKey, monthMap);
      }
      monthMap.set(permit.month, (monthMap.get(permit.month) ?? 0) + 1);
    }
  }

  const totalAttempts = geocodeHits + geocodeMisses;
  const hitRate = totalAttempts > 0 ? geocodeHits / totalAttempts : 0;

  console.log(`  ${geocodeHits} segments geocoded successfully.`);
  console.log(`  ${geocodeMisses} segments failed geocoding.`);
  console.log(`  Hit rate: ${(hitRate * 100).toFixed(1)}%`);
  console.log(`  ${grid.size} unique grid points.\n`);

  // 6. Build output
  const points: BlockPoint[] = [];
  for (const [gridKey, monthMap] of grid) {
    const [latStr, lngStr] = gridKey.split(",");
    const months: Record<string, number> = {};
    // Sort months for deterministic output
    const sortedMonths = [...monthMap.keys()].sort();
    for (const m of sortedMonths) {
      months[m] = monthMap.get(m)!;
    }
    points.push({
      lat: Number(latStr),
      lng: Number(lngStr),
      months,
    });
  }

  // Sort points for deterministic output
  points.sort((a, b) => a.lat - b.lat || a.lng - b.lng);

  const output: BlocksOutput = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalPoints: points.length,
      geocodeHitRate: Number(hitRate.toFixed(4)),
    },
    points,
  };

  // 7. Write output
  const outPath = join(THIS_DIR, "..", "public", "data", "blocks.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output));
  const fileSize = Buffer.byteLength(JSON.stringify(output));
  console.log(`Wrote ${outPath} (${(fileSize / 1024).toFixed(0)} KB)`);
  console.log("\nDone.");
}

main().catch((err: unknown) => {
  console.error("Block pipeline failed:", err);
  process.exit(1);
});

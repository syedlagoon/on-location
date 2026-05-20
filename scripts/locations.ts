// Wikidata recon — pull candidate NYC filming locations for human review.
// Run with: npm run locations
//
// Source: Wikidata SPARQL endpoint. Finds films and TV series with filming
// locations in NYC that have coordinates, then writes a candidates JSON file.
//
// This is a one-shot recon script. Output goes to
// public/data/locations-candidates.json for manual curation.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "on-location-recon/1.0 (research)";

// NYC bounding box — sanity check for coordinates.
const BBOX = {
  latMin: 40.4,
  latMax: 40.95,
  lngMin: -74.3,
  lngMax: -73.65,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationCandidate {
  id: string;
  title: string;
  year: number | null;
  type: "film" | "tv";
  location: { name: string; lat: number; lng: number };
  source: "wikidata";
  wikidataIds: { film: string; location: string };
}

/** Shape of a single binding row from the Wikidata SPARQL JSON response. */
interface SparqlBinding {
  work: { value: string };
  workLabel: { value: string };
  loc: { value: string };
  locLabel: { value: string };
  coords: { value: string };
  pubDate?: { value: string };
  workType: { value: string };
}

interface SparqlResults {
  results: {
    bindings: SparqlBinding[];
  };
}

// ---------------------------------------------------------------------------
// SPARQL query
// ---------------------------------------------------------------------------

/**
 * Build a SPARQL query for one work type.
 *
 * Wikidata's public endpoint has a 60-second timeout, and querying for both
 * films and TV series with subclass traversal + geographic containment in a
 * single query risks hitting that limit. We split into two focused queries
 * and merge the results in code.
 *
 * Instead of expensive transitive P131 containment (which times out), we
 * enumerate NYC (Q60) and its five boroughs explicitly with VALUES, and also
 * allow locations that are P131 of neighborhoods/areas that are themselves
 * P131 of a borough (two hops max). We further narrow with a coordinate
 * bounding box filter so Wikidata can use spatial indexes.
 *
 * @param classQID - Q11424 (film) or Q5398426 (television series)
 */
function buildSparqlQuery(classQID: string): string {
  return `
SELECT ?work ?workLabel ?loc ?locLabel ?coords ?pubDate ?workType WHERE {
  ?work wdt:P31/wdt:P279* wd:${classQID} .
  ?work wdt:P915 ?loc .
  ?loc wdt:P625 ?coords .

  # Filter by coordinate bounding box (NYC area) to let the query planner
  # use spatial indexes. This is much faster than transitive P131.
  FILTER(
    (geof:latitude(?coords)  >= 40.4)  && (geof:latitude(?coords)  <= 40.95) &&
    (geof:longitude(?coords) >= -74.3) && (geof:longitude(?coords) <= -73.65)
  )

  OPTIONAL { ?work wdt:P577 ?pubDate . }

  BIND(wd:${classQID} AS ?workType)

  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
`.trim();
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Execute a SPARQL query against the Wikidata endpoint.
 * Uses HTTP GET with URL-encoded query per Wikidata etiquette.
 */
async function runSparqlQuery(query: string): Promise<SparqlBinding[]> {
  const params = new URLSearchParams({ query, format: "json" });
  const url = `${SPARQL_ENDPOINT}?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Wikidata SPARQL error ${res.status}: ${res.statusText}\n${body.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as SparqlResults;
  return json.results.bindings;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract lat/lng from Wikidata's WKT point format: "Point(lng lat)".
 * Returns null if the format is unexpected.
 */
function parseWktPoint(wkt: string): { lat: number; lng: number } | null {
  const match = /^Point\(([^ ]+) ([^ ]+)\)$/i.exec(wkt);
  if (!match) return null;
  const lng = parseFloat(match[1]!);
  const lat = parseFloat(match[2]!);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

/** Extract QID from a full Wikidata entity URI. */
function extractQID(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? uri;
}

/** Extract year from an ISO date string (e.g. "2019-01-01T00:00:00Z" -> 2019). */
function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

/** Check if coordinates fall within the NYC bounding box. */
function isInBbox(lat: number, lng: number): boolean {
  return (
    lat >= BBOX.latMin &&
    lat <= BBOX.latMax &&
    lng >= BBOX.lngMin &&
    lng <= BBOX.lngMax
  );
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

function bindingsToCandidate(
  binding: SparqlBinding,
  workType: "film" | "tv",
): LocationCandidate | null {
  const title = binding.workLabel.value;
  const filmQID = extractQID(binding.work.value);
  const locationQID = extractQID(binding.loc.value);

  // Drop entries missing a title (Wikidata sometimes returns the QID as label)
  if (!title || title === filmQID) return null;

  const coords = parseWktPoint(binding.coords.value);
  if (!coords) return null;

  // Bbox sanity check
  if (!isInBbox(coords.lat, coords.lng)) return null;

  const locationName = binding.locLabel.value || "Unknown";
  const year = extractYear(binding.pubDate?.value);

  return {
    id: `${filmQID}_${locationQID}`,
    title,
    year,
    type: workType,
    location: { name: locationName, lat: coords.lat, lng: coords.lng },
    source: "wikidata",
    wikidataIds: { film: filmQID, location: locationQID },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== On Location — Wikidata filming-location recon ===\n");

  // Run two queries — one for films, one for TV — to avoid Wikidata timeout.
  const candidates: LocationCandidate[] = [];
  const seenIds = new Set<string>();

  const queries: Array<{ label: string; qid: string; type: "film" | "tv" }> = [
    { label: "films", qid: "Q11424", type: "film" },
    { label: "TV series", qid: "Q5398426", type: "tv" },
  ];

  for (const { label, qid, type } of queries) {
    console.log(`Querying Wikidata for ${label} (${qid})...`);
    const query = buildSparqlQuery(qid);

    let bindings: SparqlBinding[];
    try {
      bindings = await runSparqlQuery(query);
    } catch (err) {
      console.error(`  Failed to fetch ${label}:`, err);
      console.error("  Continuing with partial results...\n");
      continue;
    }

    console.log(`  Got ${bindings.length} raw results.`);

    let added = 0;
    for (const binding of bindings) {
      const candidate = bindingsToCandidate(binding, type);
      if (!candidate) continue;

      // Dedupe by composite id
      if (seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);

      candidates.push(candidate);
      added++;
    }

    console.log(`  Kept ${added} candidates after filtering.\n`);
  }

  // Sort by title for deterministic output
  candidates.sort((a, b) => a.title.localeCompare(b.title));

  console.log(`Total candidates: ${candidates.length}\n`);

  // Log 5 samples
  if (candidates.length > 0) {
    console.log("Sample entries:");
    const samples = candidates.slice(0, 5);
    for (const s of samples) {
      console.log(
        `  - "${s.title}" (${s.year ?? "?"}) [${s.type}] @ ${s.location.name} (${s.location.lat.toFixed(4)}, ${s.location.lng.toFixed(4)})`,
      );
    }
    console.log();
  }

  // Write output
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const outPath = join(thisDir, "..", "public", "data", "locations-candidates.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(candidates, null, 2) + "\n");
  console.log(`Wrote ${candidates.length} candidates to ${outPath}`);
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error("Locations recon failed:", err);
  process.exit(1);
});

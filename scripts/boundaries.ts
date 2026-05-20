// Download NYC boundary GeoJSON files for the map layers.
// Run with: npm run boundaries
//
// Idempotent — skips any file that already exists on disk.

import { access, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(THIS_DIR, "..", "public", "data");

const BOUNDARIES = [
  {
    name: "MODZCTA (zip areas)",
    url: "https://data.cityofnewyork.us/api/geospatial/pri4-ifjk?method=export&format=GeoJSON",
    file: "zip-boundaries.geojson",
  },
  {
    name: "Community Districts (clipped to shoreline)",
    url: "https://data.cityofnewyork.us/api/geospatial/5crt-au7u?method=export&format=GeoJSON",
    file: "cd-boundaries.geojson",
  },
] as const;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("=== On Location — boundary download ===\n");

  await mkdir(DATA_DIR, { recursive: true });

  for (const boundary of BOUNDARIES) {
    const dest = join(DATA_DIR, boundary.file);

    if (await fileExists(dest)) {
      console.log(`  ⏭ ${boundary.name} — already exists, skipping.`);
      continue;
    }

    console.log(`  Downloading ${boundary.name}…`);
    const res = await fetch(boundary.url);
    if (!res.ok) {
      throw new Error(
        `Failed to download ${boundary.name}: ${res.status} ${res.statusText}`,
      );
    }

    const text = await res.text();
    await writeFile(dest, text);
    console.log(`  ✓ Saved ${dest}`);
  }

  console.log("\nDone.");
}

main().catch((err: unknown) => {
  console.error("Boundary download failed:", err);
  process.exit(1);
});

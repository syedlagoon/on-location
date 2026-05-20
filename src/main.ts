import "./style.css";
import { Deck } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// --- Types ---

interface CountsData {
  metadata: {
    generatedAt: string;
    totalShoots: number;
    dateRange: { min: string; max: string };
  };
  byZip: Record<string, Record<string, number>>;
  byCommunityDistrict: Record<string, Record<string, number>>;
}

interface CdProperties {
  boro_cd: string;
  shape_leng: string;
  shape_area: string;
}

type CdFeature = Feature<Geometry, CdProperties>;

// --- Constants ---

const BOROUGH_NAMES: Record<number, string> = {
  1: "Manhattan",
  2: "Bronx",
  3: "Brooklyn",
  4: "Queens",
  5: "Staten Island",
};

const INITIAL_VIEW_STATE = {
  longitude: -73.96,
  latitude: 40.72,
  zoom: 9.8,
  pitch: 45,
  bearing: 0,
};

const ELEVATION_SCALE = 150;
const COLOR_ZERO: [number, number, number] = [40, 40, 80];
const COLOR_MAX: [number, number, number] = [255, 200, 60];

// --- Helpers ---

/**
 * Convert a `boro_cd` string (e.g. "105") to a counts key (e.g. "Manhattan-5").
 * Returns null for Joint Interest Areas (CD number > 30).
 */
function cdKey(boro_cd: string): string | null {
  const num = parseInt(boro_cd, 10);
  if (isNaN(num)) return null;

  const boroughCode = Math.floor(num / 100);
  const cdNumber = num % 100;

  // JIAs have CD numbers above 30
  if (cdNumber > 30) return null;

  const boroughName = BOROUGH_NAMES[boroughCode];
  if (!boroughName) return null;

  return `${boroughName}-${cdNumber}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getColor(
  count: number,
  maxCount: number,
): [number, number, number, number] {
  if (maxCount === 0 || count === 0) return [...COLOR_ZERO, 200];
  const t = count / maxCount;
  return [
    Math.round(lerp(COLOR_ZERO[0], COLOR_MAX[0], t)),
    Math.round(lerp(COLOR_ZERO[1], COLOR_MAX[1], t)),
    Math.round(lerp(COLOR_ZERO[2], COLOR_MAX[2], t)),
    220,
  ];
}

// --- Main ---

async function main(): Promise<void> {
  const [counts, cdBoundaries] = await Promise.all([
    fetch("/data/counts.json").then((r) => r.json() as Promise<CountsData>),
    fetch("/data/cd-boundaries.geojson").then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, CdProperties>>,
    ),
  ]);

  const selectedMonth = counts.metadata.dateRange.max;

  // Compute max count for this month across all CDs
  let maxCount = 0;
  for (const monthCounts of Object.values(counts.byCommunityDistrict)) {
    const c = monthCounts[selectedMonth] ?? 0;
    if (c > maxCount) maxCount = c;
  }

  const cdLayer = new GeoJsonLayer<CdProperties>({
    id: "cd-layer",
    data: cdBoundaries,
    extruded: true,
    wireframe: false,
    pickable: true,
    getElevation: (f: CdFeature) => {
      const key = cdKey(f.properties.boro_cd);
      if (!key) return 0;
      return (counts.byCommunityDistrict[key]?.[selectedMonth] ?? 0) * ELEVATION_SCALE;
    },
    getFillColor: (f: CdFeature) => {
      const key = cdKey(f.properties.boro_cd);
      const count = key
        ? (counts.byCommunityDistrict[key]?.[selectedMonth] ?? 0)
        : 0;
      return getColor(count, maxCount);
    },
    getLineColor: [80, 80, 100, 200],
    material: { ambient: 0.6, diffuse: 0.6, shininess: 20 },
  });

  new Deck({
    parent: document.querySelector<HTMLDivElement>("#app")!,
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    layers: [cdLayer],
    getTooltip: ({ object }: { object?: CdFeature }) => {
      if (!object) return null;
      const key = cdKey(object.properties.boro_cd);
      if (!key) return null;

      const count =
        counts.byCommunityDistrict[key]?.[selectedMonth] ?? 0;
      const [borough, cdNum] = key.split("-");

      return {
        html: `<strong>${borough} CD ${cdNum}</strong><br/>Shoots in ${selectedMonth}: ${count}`,
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          padding: "8px 12px",
          background: "rgba(20, 20, 30, 0.92)",
          color: "#fafafa",
          borderRadius: "6px",
          lineHeight: "1.4",
          maxWidth: "240px",
        },
      };
    },
    style: { background: "transparent" },
  });
}

main();

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
    categories?: string[];
  };
  byZip: Record<string, Record<string, number>>;
  byCommunityDistrict: Record<string, Record<string, number>>;
  byCategory?: {
    byZip: Record<string, Record<string, Record<string, number>>>;
    byCommunityDistrict: Record<string, Record<string, Record<string, number>>>;
  };
}

interface CdProperties {
  boro_cd: string;
  shape_leng: string;
  shape_area: string;
}

interface ZipProperties {
  modzcta: string;
  label: string;
  zcta: string;
  pop_est: string;
}

type CdFeature = Feature<Geometry, CdProperties>;
type ZipFeature = Feature<Geometry, ZipProperties>;
type AreaFeature = CdFeature | ZipFeature;

type UnitMode = "cd" | "zip";

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

/** Generate inclusive array of "YYYY-MM" strings from min to max. */
function generateMonths(min: string, max: string): string[] {
  const months: string[] = [];
  let [year, month] = min.split("-").map(Number);
  const [maxYear, maxMonth] = max.split("-").map(Number);

  while (year < maxYear || (year === maxYear && month <= maxMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return months;
}

/** Compute the max shoot count across all CDs for a given month. */
function computeMaxCount(
  byCd: Record<string, Record<string, number>>,
  month: string,
): number {
  let max = 0;
  for (const monthCounts of Object.values(byCd)) {
    const c = monthCounts[month] ?? 0;
    if (c > max) max = c;
  }
  return max;
}

/** Format "YYYY-MM" → "Feb 2026" style label. */
function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split("-").map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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
  const [counts, cdBoundaries, zipBoundaries] = await Promise.all([
    fetch("/data/counts.json").then((r) => r.json() as Promise<CountsData>),
    fetch("/data/cd-boundaries.geojson").then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, CdProperties>>,
    ),
    fetch("/data/zip-boundaries.geojson").then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, ZipProperties>>,
    ),
  ]);

  const { min, max } = counts.metadata.dateRange;
  const months = generateMonths(min, max);
  let currentMonth = max;
  let currentUnit: UnitMode = "cd";
  let activeCategories: Set<string> | null = null;

  // --- Build controls UI ---
  const controls = document.createElement("div");
  controls.id = "controls";

  const unitToggle = document.createElement("button");
  unitToggle.id = "unit-toggle";
  unitToggle.textContent = "CD";

  const playBtn = document.createElement("button");
  playBtn.id = "play-btn";
  playBtn.textContent = "\u25B6";

  const slider = document.createElement("input");
  slider.id = "month-slider";
  slider.type = "range";
  slider.min = "0";
  slider.max = String(months.length - 1);
  slider.value = String(months.length - 1);

  const monthLabel = document.createElement("span");
  monthLabel.id = "month-label";
  monthLabel.textContent = formatMonth(currentMonth);

  controls.append(unitToggle, playBtn, slider, monthLabel);
  document.body.appendChild(controls);

  // --- Title overlay ---
  const titleOverlay = document.createElement("div");
  titleOverlay.id = "title-overlay";
  titleOverlay.innerHTML =
    `<h1>On Location</h1><p>NYC film &amp; TV permit activity, month by month</p>`;
  document.body.appendChild(titleOverlay);

  // --- Color legend ---
  const legend = document.createElement("div");
  legend.id = "legend";
  const legendGradient = document.createElement("div");
  legendGradient.id = "legend-gradient";
  const legendLabels = document.createElement("div");
  legendLabels.id = "legend-labels";
  const legendMin = document.createElement("span");
  legendMin.textContent = "0";
  const legendMax = document.createElement("span");
  legendMax.id = "legend-max";
  const initialMax = computeMaxCount(computeFilteredCounts(currentUnit, activeCategories), currentMonth);
  legendMax.textContent = String(initialMax);
  legendLabels.append(legendMin, legendMax);
  const legendTitle = document.createElement("div");
  legendTitle.id = "legend-title";
  legendTitle.textContent = "Shoots";
  legend.append(legendTitle, legendGradient, legendLabels);
  document.body.appendChild(legend);

  // --- Attribution ---
  const attribution = document.createElement("div");
  attribution.id = "attribution";
  attribution.innerHTML =
    `Data: <a href="https://data.cityofnewyork.us/City-Government/Film-Permits/tg4x-b46p" target="_blank" rel="noopener">NYC Open Data Film Permits</a>`;
  document.body.appendChild(attribution);

  // --- Category filter ---
  const filterBar = document.createElement("div");
  filterBar.id = "category-filter";

  if (counts.metadata.categories && counts.metadata.categories.length > 0) {
    const allBtn = document.createElement("button");
    allBtn.textContent = "All";
    allBtn.classList.add("cat-pill", "cat-active");
    allBtn.addEventListener("click", () => {
      activeCategories = null;
      filterBar.querySelectorAll(".cat-pill").forEach((el) => el.classList.remove("cat-active"));
      allBtn.classList.add("cat-active");
      updateLayers();
    });
    filterBar.appendChild(allBtn);

    for (const cat of counts.metadata.categories) {
      const pill = document.createElement("button");
      pill.textContent = cat;
      pill.classList.add("cat-pill");
      pill.addEventListener("click", () => {
        if (activeCategories === null) {
          activeCategories = new Set([cat]);
        } else if (activeCategories.has(cat)) {
          activeCategories.delete(cat);
          if (activeCategories.size === 0) activeCategories = null;
        } else {
          activeCategories.add(cat);
        }
        // Update pill active states
        filterBar.querySelectorAll(".cat-pill").forEach((el) => {
          const text = el.textContent;
          if (text === "All") {
            el.classList.toggle("cat-active", activeCategories === null);
          } else {
            el.classList.toggle("cat-active", activeCategories !== null && activeCategories.has(text!));
          }
        });
        updateLayers();
      });
      filterBar.appendChild(pill);
    }
    document.body.appendChild(filterBar);
  }

  // --- Resolve the counts key and display label for a feature ---
  function resolveFeature(
    f: AreaFeature,
    unit: UnitMode,
  ): { countsKey: string; label: string } | null {
    if (unit === "cd") {
      const props = f.properties as CdProperties;
      const key = cdKey(props.boro_cd);
      if (!key) return null;
      const [borough, cdNum] = key.split("-");
      return { countsKey: key, label: `${borough} CD ${cdNum}` };
    }
    const props = f.properties as ZipProperties;
    const zip = props.modzcta;
    if (!zip) return null;
    return { countsKey: zip, label: `Zip ${zip}` };
  }

  function computeFilteredCounts(
    unit: UnitMode,
    categories: Set<string> | null,
  ): Record<string, Record<string, number>> {
    if (categories === null || !counts.byCategory) {
      return unit === "cd" ? counts.byCommunityDistrict : counts.byZip;
    }
    const source = unit === "cd"
      ? counts.byCategory.byCommunityDistrict
      : counts.byCategory.byZip;
    const result: Record<string, Record<string, number>> = {};
    for (const cat of categories) {
      const catData = source[cat];
      if (!catData) continue;
      for (const [areaId, monthCounts] of Object.entries(catData)) {
        if (!result[areaId]) result[areaId] = {};
        for (const [month, count] of Object.entries(monthCounts)) {
          result[areaId][month] = (result[areaId][month] ?? 0) + count;
        }
      }
    }
    return result;
  }

  // --- Layer builder ---
  function buildLayer(month: string, unit: UnitMode): GeoJsonLayer {
    const countsMap = computeFilteredCounts(unit, activeCategories);
    const maxCount = computeMaxCount(countsMap, month);
    const data = unit === "cd" ? cdBoundaries : zipBoundaries;

    return new GeoJsonLayer({
      id: "area-layer",
      data,
      extruded: true,
      wireframe: false,
      pickable: true,
      getElevation: (f: AreaFeature) => {
        const resolved = resolveFeature(f, unit);
        if (!resolved) return 0;
        return (countsMap[resolved.countsKey]?.[month] ?? 0) * ELEVATION_SCALE;
      },
      getFillColor: (f: AreaFeature) => {
        const resolved = resolveFeature(f, unit);
        const count = resolved
          ? (countsMap[resolved.countsKey]?.[month] ?? 0)
          : 0;
        return getColor(count, maxCount);
      },
      getLineColor: [80, 80, 100, 200],
      material: { ambient: 0.6, diffuse: 0.6, shininess: 20 },
      transitions: {
        getElevation: { duration: 600, easing: (t: number) => t * (2 - t) },
        getFillColor: { duration: 600 },
      },
    });
  }

  const tooltipStyle = {
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
    padding: "8px 12px",
    background: "rgba(20, 20, 30, 0.92)",
    color: "#fafafa",
    borderRadius: "6px",
    lineHeight: "1.4",
    maxWidth: "240px",
  };

  // --- Deck instance ---
  const deck = new Deck({
    parent: document.querySelector<HTMLDivElement>("#app")!,
    initialViewState: INITIAL_VIEW_STATE,
    controller: true,
    layers: [buildLayer(currentMonth, currentUnit)],
    getTooltip: ({ object }: { object?: AreaFeature }) => {
      if (!object) return null;
      const resolved = resolveFeature(object, currentUnit);
      if (!resolved) return null;

      const countsMap = computeFilteredCounts(currentUnit, activeCategories);
      const count = countsMap[resolved.countsKey]?.[currentMonth] ?? 0;

      return {
        html: `<strong>${resolved.label}</strong><br/>Shoots in ${formatMonth(currentMonth)}: ${count}`,
        style: tooltipStyle,
      };
    },
    style: { background: "transparent" },
  });

  // --- Update layers ---
  function updateLayers(): void {
    monthLabel.textContent = formatMonth(currentMonth);
    const maxCount = computeMaxCount(computeFilteredCounts(currentUnit, activeCategories), currentMonth);
    legendMax.textContent = String(maxCount);
    deck.setProps({ layers: [buildLayer(currentMonth, currentUnit)] });
  }

  // --- Slider input ---
  slider.addEventListener("input", () => {
    currentMonth = months[slider.valueAsNumber];
    updateLayers();
    if (playing) stopPlayback();
  });

  // --- Unit toggle ---
  unitToggle.addEventListener("click", () => {
    currentUnit = currentUnit === "cd" ? "zip" : "cd";
    unitToggle.textContent = currentUnit === "cd" ? "CD" : "ZIP";
    updateLayers();
  });

  // --- Play/pause ---
  let playing = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function stopPlayback(): void {
    playing = false;
    playBtn.textContent = "\u25B6";
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function startPlayback(): void {
    playing = true;
    playBtn.textContent = "\u23F8";
    intervalId = setInterval(() => {
      let idx = slider.valueAsNumber + 1;
      if (idx >= months.length) {
        idx = 0; // wrap to start
      }
      slider.value = String(idx);
      currentMonth = months[idx];
      updateLayers();
    }, 1200);
  }

  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  // --- Keyboard shortcuts ---
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      if (playing) {
        stopPlayback();
      } else {
        startPlayback();
      }
    } else if (e.key === "ArrowLeft") {
      if (playing) stopPlayback();
      const idx = Math.max(0, slider.valueAsNumber - 1);
      slider.value = String(idx);
      currentMonth = months[idx];
      updateLayers();
    } else if (e.key === "ArrowRight") {
      if (playing) stopPlayback();
      const idx = Math.min(months.length - 1, slider.valueAsNumber + 1);
      slider.value = String(idx);
      currentMonth = months[idx];
      updateLayers();
    }
  });
}

main();

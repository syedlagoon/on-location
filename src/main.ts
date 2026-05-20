import "./style.css";
import { Deck } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Feature, FeatureCollection, Geometry, Position, Polygon, MultiPolygon } from "geojson";

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
type VizMode = "bars" | "circles";
type GrainMode = "area" | "block";

interface CircleDataPoint {
  position: [number, number];
  count: number;
  label: string;
  countsKey: string;
}

interface CaptionsData {
  metadata: { generatedAt: string; model: string };
  cd: Record<string, string>;
  zip: Record<string, string>;
}

interface BlockPoint {
  lng: number;
  lat: number;
  months: Record<string, number>;
}

interface BlocksData {
  metadata: { generatedAt: string; totalPoints: number; geocodeHitRate: number };
  points: BlockPoint[];
}

interface HeatmapDataPoint {
  position: [number, number];
  weight: number;
}


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

/** Top-down view for circles mode — no pitch, no bearing. */
const FLAT_VIEW_STATE = {
  longitude: -73.96,
  latitude: 40.72,
  zoom: 10,
  pitch: 0,
  bearing: 0,
};

const HERO_VIEW_STATE = {
  longitude: -73.98,
  latitude: 40.75,
  zoom: 12,
  pitch: 60,
  bearing: -10,
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

/** Compute centroid as arithmetic mean of outer ring vertices. */
function computeCentroid(geometry: Polygon | MultiPolygon): [number, number] {
  const coords: Position[] = [];
  if (geometry.type === "Polygon") {
    coords.push(...geometry.coordinates[0]);
  } else {
    for (const polygon of geometry.coordinates) {
      coords.push(...polygon[0]);
    }
  }
  let lng = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  return [lng / coords.length, lat / coords.length];
}

// --- Main ---

const BASE = import.meta.env.BASE_URL;

async function main(): Promise<void> {
  const [counts, cdBoundaries, zipBoundaries, captions] = await Promise.all([
    fetch(`${BASE}data/counts.json`).then((r) => r.json() as Promise<CountsData>),
    fetch(`${BASE}data/cd-boundaries.geojson`).then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, CdProperties>>,
    ),
    fetch(`${BASE}data/zip-boundaries.geojson`).then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, ZipProperties>>,
    ),
    fetch(`${BASE}data/captions.json`)
      .then((r) => r.ok ? r.json() as Promise<CaptionsData> : null)
      .catch(() => null),
  ]);

  const { min, max } = counts.metadata.dateRange;
  const months = generateMonths(min, max);
  let currentMonth = max;
  let currentUnit: UnitMode = "cd";
  let activeCategories: Set<string> | null = null;
  let currentVizMode: VizMode = "bars";
  let currentGrain: GrainMode = "area";
  let blocksData: BlocksData | null = null;
  let blocksLoading = false;

  // Track current month index for easier navigation
  let currentMonthIdx = months.indexOf(currentMonth);

  // --- Build toolbar card with descriptive toggle rows ---
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";

  // Helper: create a toolbar row with heading, description, and toggle button
  function createToolbarRow(
    heading: string,
    desc: string,
    initialLabel: string,
    ariaLabel: string,
  ): { row: HTMLDivElement; toggle: HTMLButtonElement } {
    const row = document.createElement("div");
    row.className = "toolbar-row";

    const info = document.createElement("div");
    info.className = "toolbar-info";
    const h = document.createElement("span");
    h.className = "toolbar-heading";
    h.textContent = heading;
    const d = document.createElement("span");
    d.className = "toolbar-desc";
    d.textContent = desc;
    info.append(h, d);

    const toggle = document.createElement("button");
    toggle.className = "toolbar-toggle";
    toggle.textContent = initialLabel;
    toggle.setAttribute("aria-label", ariaLabel);

    row.append(info, toggle);

    // Clicking anywhere on the row triggers the toggle
    row.addEventListener("click", () => toggle.click());

    return { row, toggle };
  }

  const { row: unitRow, toggle: unitToggle } = createToolbarRow(
    "Area",
    "Community districts or zip codes",
    "CD",
    "Toggle area type",
  );

  const { row: vizRow, toggle: vizToggle } = createToolbarRow(
    "Shape",
    "3D bars or proportional circles",
    "Bars",
    "Toggle visualization shape",
  );

  const { row: grainRow, toggle: grainToggle } = createToolbarRow(
    "Detail",
    "Area polygons or block heatmap",
    "Area",
    "Toggle block-level heatmap",
  );

  toolbar.append(unitRow, vizRow, grainRow);
  document.body.appendChild(toolbar);

  // --- Build notch timeline ---
  const timeline = document.createElement("div");
  timeline.id = "timeline";

  const timelineLabel = document.createElement("div");
  timelineLabel.id = "timeline-label";
  timelineLabel.textContent = formatMonth(currentMonth);

  const timelineTrack = document.createElement("div");
  timelineTrack.id = "timeline-track";
  timelineTrack.setAttribute("role", "slider");
  timelineTrack.setAttribute("aria-label", "Month timeline");
  timelineTrack.setAttribute("aria-valuemin", "0");
  timelineTrack.setAttribute("aria-valuemax", String(months.length - 1));
  timelineTrack.setAttribute("aria-valuenow", String(currentMonthIdx));
  timelineTrack.setAttribute("tabindex", "0");

  const notchElements: HTMLDivElement[] = [];

  function computeMonthTotals(): number[] {
    const countsMap = computeFilteredCounts(currentUnit, activeCategories);
    return months.map((m) => {
      let sum = 0;
      for (const areaCounts of Object.values(countsMap)) {
        sum += areaCounts[m] ?? 0;
      }
      return sum;
    });
  }

  function buildNotches(): void {
    timelineTrack.innerHTML = "";
    notchElements.length = 0;
    const totals = computeMonthTotals();
    const maxTotal = Math.max(...totals, 1);

    for (let i = 0; i < months.length; i++) {
      const notch = document.createElement("div");
      notch.className = "notch";
      const heightPct = Math.max(8, (totals[i] / maxTotal) * 100); // min 8% so empty months are still visible
      notch.style.height = `${heightPct}%`;

      // Hover tooltip (hidden by default, shown via CSS)
      const tooltip = document.createElement("div");
      tooltip.className = "notch-tooltip";
      tooltip.textContent = `${formatMonth(months[i])}: ${totals[i]}`;
      notch.appendChild(tooltip);

      if (i === currentMonthIdx) {
        notch.classList.add("notch-active");
      }

      const idx = i; // capture for closure
      notch.addEventListener("click", () => {
        currentMonthIdx = idx;
        currentMonth = months[idx];
        updateActiveNotch();
        updateLayers();
      });

      timelineTrack.appendChild(notch);
      notchElements.push(notch);
    }
  }

  // Year labels
  const yearLabels = document.createElement("div");
  yearLabels.id = "timeline-years";
  const seenYears = new Set<string>();
  for (let i = 0; i < months.length; i++) {
    const year = months[i].split("-")[0];
    if (!seenYears.has(year)) {
      seenYears.add(year);
      const label = document.createElement("span");
      label.className = "year-label";
      label.textContent = year;
      // Position proportionally
      label.style.left = `${(i / Math.max(months.length - 1, 1)) * 100}%`;
      yearLabels.appendChild(label);
    }
  }

  timeline.append(timelineLabel, timelineTrack, yearLabels);
  document.body.appendChild(timeline);

  buildNotches();

  function updateActiveNotch(): void {
    for (let i = 0; i < notchElements.length; i++) {
      notchElements[i].classList.toggle("notch-active", i === currentMonthIdx);
    }
    timelineLabel.textContent = formatMonth(currentMonth);
    timelineTrack.setAttribute("aria-valuenow", String(currentMonthIdx));
  }

  // --- Title overlay ---
  const titleOverlay = document.createElement("div");
  titleOverlay.id = "title-overlay";
  titleOverlay.innerHTML =
    `<h1>On Location</h1><span class="title-accent"></span><p>NYC film &amp; TV permit activity, month by month</p>`;
  document.body.appendChild(titleOverlay);

  // --- Caption ---
  const captionEl = document.createElement("div");
  captionEl.id = "caption";
  document.body.appendChild(captionEl);

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
      buildNotches();
      updateLayers();
    });
    filterBar.appendChild(allBtn);

    for (const cat of counts.metadata.categories) {
      const pill = document.createElement("button");
      pill.textContent = cat;
      pill.classList.add("cat-pill");
      pill.setAttribute("data-cat", cat);
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
        buildNotches();
        updateLayers();
      });
      filterBar.appendChild(pill);
    }
    document.body.appendChild(filterBar);
  }


  // --- Detail panel ---
  const detailPanel = document.createElement("div");
  detailPanel.id = "detail-panel";
  document.body.appendChild(detailPanel);
  let detailOpen = false;
  let detailAreaKey: string | null = null;

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

  // --- Base boundary layer: flat outline of NYC areas, always visible ---
  // Renders a subtle filled + stroked geography underneath the data layers
  // (bars, circles, or heatmap). Styling goal: clearly define NYC's shape
  // and area divisions without competing with the data on top.
  function buildBaseLayer(unit: UnitMode): GeoJsonLayer {
    const data = unit === "cd" ? cdBoundaries : zipBoundaries;

    // Dark navy fill — slightly lighter than the page background (#0a0a0a)
    // to make the NYC landmass visible against the void. The indigo tint
    // (blue channel higher) gives a subtle geographic feel.
    const fillColor: [number, number, number, number] = [12, 12, 28, 180];

    // Border lines — thin white at low opacity, matching the design system's
    // --color-border (rgba 255,255,255 @ 0.08–0.15). Zip codes get slightly
    // more transparent borders since there are many more of them (~180 vs ~59).
    const lineColor: [number, number, number, number] =
      unit === "cd" ? [255, 255, 255, 38] : [255, 255, 255, 25];
    //                 ~0.15 opacity (CD)    ~0.10 opacity (ZIP)

    // Line width: CDs get 1px borders, ZIPs get 0.5px to avoid visual noise
    // from the denser zip-code grid.
    const lineWidth = unit === "cd" ? 1 : 0.5;

    return new GeoJsonLayer({
      id: "base-boundary",
      data,
      extruded: false,
      // Not pickable — hover/click are handled by the data layers on top
      // (extruded bars, circles, or heatmap). Making this pickable would
      // cause confusing double-hover in bars mode (same polygons) or steal
      // events from circles/heatmap.
      pickable: false,
      stroked: true,
      filled: true,
      getFillColor: fillColor,
      getLineColor: lineColor,
      lineWidthMinPixels: lineWidth,
      updateTriggers: {
        // Rebuild when unit changes — different boundary GeoJSON,
        // different line colors, and different line widths.
        getFillColor: [unit],
        getLineColor: [unit],
      },
    });
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
      updateTriggers: {
        getElevation: [month, unit],
        getFillColor: [month, unit],
      },
      transitions: {
        getElevation: { duration: 600, easing: (t: number) => t * (2 - t) },
        getFillColor: { duration: 600 },
      },
    });
  }

  // --- Circle layer builder ---
  function buildCircleLayer(month: string, unit: UnitMode): ScatterplotLayer {
    const countsMap = computeFilteredCounts(unit, activeCategories);
    const maxCount = computeMaxCount(countsMap, month);
    const features = unit === "cd" ? cdBoundaries.features : zipBoundaries.features;

    const data: CircleDataPoint[] = [];
    for (const f of features) {
      const resolved = resolveFeature(f as AreaFeature, unit);
      if (!resolved) continue;
      const count = countsMap[resolved.countsKey]?.[month] ?? 0;
      const centroid = computeCentroid(f.geometry as Polygon | MultiPolygon);
      data.push({ position: centroid, count, label: resolved.label, countsKey: resolved.countsKey });
    }

    const MAX_RADIUS = 2000;
    const MIN_RADIUS = 200;

    return new ScatterplotLayer({
      id: "circle-layer",
      data,
      pickable: true,
      opacity: 0.8,
      stroked: true,
      filled: true,
      getPosition: (d: CircleDataPoint) => d.position,
      getRadius: (d: CircleDataPoint) => {
        if (maxCount === 0 || d.count === 0) return MIN_RADIUS;
        return MIN_RADIUS + Math.sqrt(d.count / maxCount) * (MAX_RADIUS - MIN_RADIUS);
      },
      getFillColor: (d: CircleDataPoint) => getColor(d.count, maxCount),
      getLineColor: [255, 255, 255, 80],
      lineWidthMinPixels: 1,
      radiusUnits: "meters" as const,
      updateTriggers: {
        getRadius: [month, unit],
        getFillColor: [month, unit],
      },
      transitions: {
        getRadius: { duration: 600, easing: (t: number) => t * (2 - t) },
        getFillColor: { duration: 600 },
      },
    });
  }

  /** Build all layers for the current viz mode. Base boundary always included. */
  function buildVisualizationLayers(month: string, unit: UnitMode): (GeoJsonLayer | ScatterplotLayer)[] {
    const base = buildBaseLayer(unit);
    if (currentVizMode === "bars") {
      return [base, buildLayer(month, unit)];
    }
    // Circles: base boundaries underneath, circles on top
    return [base, buildCircleLayer(month, unit)];
  }

  // --- Heatmap layer for block-level grain ---
  function buildHeatmapLayer(month: string): HeatmapLayer<HeatmapDataPoint> | null {
    if (!blocksData) return null;

    const data: HeatmapDataPoint[] = [];
    for (const pt of blocksData.points) {
      const weight = pt.months[month] ?? 0;
      if (weight > 0) {
        data.push({ position: [pt.lng, pt.lat], weight });
      }
    }

    return new HeatmapLayer<HeatmapDataPoint>({
      id: "block-heatmap",
      data,
      getPosition: (d: HeatmapDataPoint) => d.position,
      getWeight: (d: HeatmapDataPoint) => d.weight,
      radiusPixels: 40,
      intensity: 1,
      threshold: 0.05,
      colorRange: [
        [40, 40, 80],
        [80, 60, 120],
        [160, 100, 80],
        [220, 160, 60],
        [255, 200, 60],
        [255, 240, 140],
      ],
    });
  }

  /** Lazy-load blocks.json. Returns true if data is (now) available. */
  async function ensureBlocksData(): Promise<boolean> {
    if (blocksData) return true;
    if (blocksLoading) return false;
    blocksLoading = true;
    try {
      const res = await fetch(`${BASE}data/blocks.json`);
      if (!res.ok) {
        console.warn(`blocks.json not found (${res.status}). Run "npm run blocks" to generate it.`);
        blocksLoading = false;
        return false;
      }
      blocksData = (await res.json()) as BlocksData;
      console.log(
        `Loaded blocks.json: ${blocksData.metadata.totalPoints} points, ` +
        `${(blocksData.metadata.geocodeHitRate * 100).toFixed(1)}% hit rate`,
      );
      return true;
    } catch (err) {
      console.warn("Failed to load blocks.json:", err);
      blocksLoading = false;
      return false;
    }
  }

  /** Show/hide area-mode controls based on grain mode. */
  function setAreaControlsVisible(visible: boolean): void {
    unitRow.style.display = visible ? "" : "none";
    vizRow.style.display = visible ? "" : "none";
    legend.style.display = visible ? "block" : "none";
    filterBar.style.display = visible ? "flex" : "none";
  }

  const tooltipStyle = {
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: "12px",
    padding: "8px 12px",
    background: "rgba(15, 15, 25, 0.95)",
    color: "#f0f0f0",
    borderRadius: "8px",
    lineHeight: "1.5",
    maxWidth: "240px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(12px)",
  };

  // --- Deck instance ---
  // Lock map manipulation but keep picking active for tooltips and clicks
  const lockedController = {
    scrollZoom: false,
    dragPan: false,
    dragRotate: false,
    doubleClickZoom: false,
    touchZoom: false,
    touchRotate: false,
    keyboard: false,
  };

  const deck = new Deck({
    parent: document.querySelector<HTMLDivElement>("#app")!,
    initialViewState: heroSeen ? INITIAL_VIEW_STATE : HERO_VIEW_STATE,
    controller: lockedController,
    layers: buildVisualizationLayers(currentMonth, currentUnit),
    getTooltip: ({ object }: { object?: AreaFeature | CircleDataPoint }) => {
      // No tooltip in block heatmap mode
      if (currentGrain === "block") return null;
      if (!object) return null;

      let label: string;
      let count: number;

      if ("position" in object && "countsKey" in object) {
        // Circle mode data point
        const d = object as CircleDataPoint;
        label = d.label;
        count = d.count;
      } else {
        // Bar mode GeoJSON feature
        const resolved = resolveFeature(object as AreaFeature, currentUnit);
        if (!resolved) return null;
        const countsMap = computeFilteredCounts(currentUnit, activeCategories);
        count = countsMap[resolved.countsKey]?.[currentMonth] ?? 0;
        label = resolved.label;
      }

      return {
        html: `<strong>${label}</strong><br/><span style="font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums">${count}</span> shoots &middot; ${formatMonth(currentMonth)}`,
        style: tooltipStyle,
      };
    },
    onClick: ({ object }: { object?: AreaFeature | CircleDataPoint }) => {
      // No detail panel in block heatmap mode
      if (currentGrain === "block") return;
      if (!object) {
        if (detailOpen) closeDetail();
        return;
      }

      let countsKey: string;
      let label: string;
      let centroid: [number, number];

      if ("position" in object && "countsKey" in object) {
        const d = object as CircleDataPoint;
        countsKey = d.countsKey;
        label = d.label;
        centroid = d.position;
      } else {
        const resolved = resolveFeature(object as AreaFeature, currentUnit);
        if (!resolved) return;
        countsKey = resolved.countsKey;
        label = resolved.label;
        const feat = object as AreaFeature;
        centroid = computeCentroid(feat.geometry as Polygon | MultiPolygon);
      }

      openDetail(countsKey, label, centroid);
    },
    style: { background: "transparent" },
  });

  // (timeline notches already built above)

  // --- Stagger UI elements in after hero dismisses ---
  function revealUI(): void {
    const elements = [titleOverlay, captionEl, legend, filterBar, toolbar, timeline, attribution];
    elements.forEach((el, i) => {
      el.classList.add("ui-fade-in");
      el.style.animationDelay = `${200 + i * 80}ms`;
    });
  }

  // --- Hero dismiss (cinematic pull-back) ---
  function dismissHero(): void {
    if (heroDismissed) return;
    heroDismissed = true;
    sessionStorage.setItem("heroShown", "1");
    hero.classList.add("hero-fade");
    // Cinematic pull-back to overview
    deck.setProps({
      initialViewState: {
        ...INITIAL_VIEW_STATE,
        transitionDuration: 2000,
      },
    });
    // Stagger in UI elements
    revealUI();
    setTimeout(() => hero.remove(), 1200);
  }

  if (!heroSeen) {
    // If user already skipped (before deck was ready), trigger pull-back now
    if (heroDismissed) {
      deck.setProps({
        initialViewState: {
          ...INITIAL_VIEW_STATE,
          transitionDuration: 2000,
        },
      });
    } else {
      // Allow skip handler to trigger the pull-back
      onHeroSkip = dismissHero;
      // Auto-dismiss hero after 2s (map is already loaded at this point)
      setTimeout(dismissHero, 2000);
    }
  }

  function openDetail(countsKey: string, label: string, _centroid: [number, number]): void {
    detailAreaKey = countsKey;
    detailOpen = true;

    // Build panel content
    const countsMap = computeFilteredCounts(currentUnit, activeCategories);
    const areaCounts = countsMap[countsKey] ?? {};
    const currentCount = areaCounts[currentMonth] ?? 0;

    // Rank among all areas this month
    const allCounts: Array<{ key: string; count: number }> = [];
    for (const [key, mc] of Object.entries(countsMap)) {
      allCounts.push({ key, count: mc[currentMonth] ?? 0 });
    }
    allCounts.sort((a, b) => b.count - a.count);
    const rank = allCounts.findIndex((a) => a.key === countsKey) + 1;
    const totalAreas = allCounts.length;

    // Top 3 months for this area
    const monthEntries = Object.entries(areaCounts)
      .map(([m, c]) => ({ month: m, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Month-over-month trend
    const monthIdx = months.indexOf(currentMonth);
    const prevCount = monthIdx > 0 ? (areaCounts[months[monthIdx - 1]] ?? 0) : 0;
    const trendChar = currentCount > prevCount ? "\u2191" : currentCount < prevCount ? "\u2193" : "\u2192";
    const trendClass = currentCount > prevCount ? "trend-up" : currentCount < prevCount ? "trend-down" : "trend-flat";

    // Sparkline for this area across all months
    const areaTotals = months.map((m) => areaCounts[m] ?? 0);
    const areaMax = Math.max(...areaTotals, 1);
    const sparkW = 280;
    const sparkH = 56;
    const sparkPad = 4;
    const stepX = (sparkW - sparkPad * 2) / Math.max(months.length - 1, 1);
    const pts = areaTotals.map((t, i) => ({
      x: sparkPad + i * stepX,
      y: sparkH - sparkPad - (t / areaMax) * (sparkH - sparkPad * 2),
    }));
    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const areaPath = `${linePath} L${pts[pts.length - 1].x},${sparkH - sparkPad} L${pts[0].x},${sparkH - sparkPad} Z`;
    const ci = months.indexOf(currentMonth);
    const cx = ci >= 0 ? pts[ci].x : 0;
    const cy = ci >= 0 ? pts[ci].y : 0;

    detailPanel.innerHTML = `
      <button id="detail-close" aria-label="Close detail panel">\u2715</button>
      <h2>${label}</h2>
      <div class="detail-stat">
        <span class="detail-big">${currentCount}</span>
        <span class="detail-label">shoots in ${formatMonth(currentMonth)} <span class="${trendClass}">${trendChar}</span></span>
      </div>
      <div class="detail-stat">
        <span class="detail-rank">#${rank}</span>
        <span class="detail-label">of ${totalAreas} areas this month</span>
      </div>
      <div class="detail-section">
        <h3>Activity over time</h3>
        <div class="detail-sparkline">
          <svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}">
            <defs>
              <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffc83c" stop-opacity="0.2"/>
                <stop offset="100%" stop-color="#ffc83c" stop-opacity="0.02"/>
              </linearGradient>
            </defs>
            <path d="${areaPath}" fill="url(#spark-fill)"/>
            <path d="${linePath}" fill="none" stroke="#ffc83c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="${cx}" cy="${cy}" r="4" fill="#0a0a0a" stroke="#ffc83c" stroke-width="2"/>
          </svg>
        </div>
      </div>
      <div class="detail-section">
        <h3>Top months</h3>
        <ul class="detail-top-months">
          ${monthEntries.map((e) => `<li><span>${formatMonth(e.month)}</span><span style="font-family:var(--font-mono);color:var(--color-fg-muted)">${e.count}</span></li>`).join("")}
        </ul>
      </div>
    `;

    detailPanel.classList.add("open");

    // Close button handler
    detailPanel.querySelector("#detail-close")!.addEventListener("click", closeDetail);
  }

  function closeDetail(): void {
    if (!detailOpen) return;
    detailOpen = false;
    detailAreaKey = null;
    detailPanel.classList.remove("open");
  }


  // --- Update layers ---
  function updateLayers(): void {
    updateActiveNotch();

    if (currentGrain === "block") {
      // In block mode, hide captions and just render the heatmap
      captionEl.style.opacity = "0";
      const heatmap = buildHeatmapLayer(currentMonth);
      const base = buildBaseLayer(currentUnit);
      deck.setProps({ layers: heatmap ? [base, heatmap] : [base] });
      return;
    }

    // Area mode — original behavior
    const maxCount = computeMaxCount(computeFilteredCounts(currentUnit, activeCategories), currentMonth);
    legendMax.textContent = String(maxCount);
    if (captions) {
      const captionMap = currentUnit === "cd" ? captions.cd : captions.zip;
      const text = activeCategories === null ? (captionMap[currentMonth] ?? "") : "";
      captionEl.textContent = text;
      captionEl.style.opacity = text ? "1" : "0";
    }
    // Refresh detail panel if open
    if (detailOpen && detailAreaKey) {
      const countsMap = computeFilteredCounts(currentUnit, activeCategories);
      const areaCounts = countsMap[detailAreaKey] ?? {};
      const count = areaCounts[currentMonth] ?? 0;
      const bigEl = detailPanel.querySelector(".detail-big");
      const labelEl = detailPanel.querySelector(".detail-stat .detail-label");
      if (bigEl) bigEl.textContent = String(count);
      if (labelEl) {
        const mi = months.indexOf(currentMonth);
        const pc = mi > 0 ? (areaCounts[months[mi - 1]] ?? 0) : 0;
        const tChar = count > pc ? "\u2191" : count < pc ? "\u2193" : "\u2192";
        const tCls = count > pc ? "trend-up" : count < pc ? "trend-down" : "trend-flat";
        labelEl.innerHTML = `shoots in ${formatMonth(currentMonth)} <span class="${tCls}">${tChar}</span>`;
      }
    }

    deck.setProps({ layers: buildVisualizationLayers(currentMonth, currentUnit) });
  }

  // --- Unit toggle ---
  unitToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    currentUnit = currentUnit === "cd" ? "zip" : "cd";
    unitToggle.textContent = currentUnit === "cd" ? "CD" : "ZIP";
    buildNotches();
    updateLayers();
  });

  // --- Viz toggle ---
  vizToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    currentVizMode = currentVizMode === "bars" ? "circles" : "bars";
    vizToggle.textContent = currentVizMode === "bars" ? "Bars" : "Circles";

    // Transition camera: bars = isometric (pitch 45), circles = top-down (pitch 0)
    const targetView = currentVizMode === "bars" ? INITIAL_VIEW_STATE : FLAT_VIEW_STATE;
    deck.setProps({
      initialViewState: {
        ...targetView,
        transitionDuration: 800,
      },
    });

    updateLayers();
  });

  // --- Grain toggle (area <-> block heatmap) ---
  grainToggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (currentGrain === "area") {
      // Switch to block mode — lazy-load blocks.json
      const loaded = await ensureBlocksData();
      if (!loaded) return;

      currentGrain = "block";
      grainToggle.textContent = "Block";
      grainToggle.classList.add("toggle-active");

      // Heatmap looks best top-down
      deck.setProps({
        initialViewState: { ...FLAT_VIEW_STATE, transitionDuration: 800 },
      });

      // Hide area-mode-only controls
      setAreaControlsVisible(false);

      // Close detail panel if open (not applicable in block mode)
      if (detailOpen) closeDetail();

      updateLayers();
    } else {
      // Switch back to area mode
      currentGrain = "area";
      grainToggle.textContent = "Area";
      grainToggle.classList.remove("toggle-active");

      // Return to the appropriate camera for current viz mode
      const targetView = currentVizMode === "bars" ? INITIAL_VIEW_STATE : FLAT_VIEW_STATE;
      deck.setProps({
        initialViewState: { ...targetView, transitionDuration: 800 },
      });

      // Restore area-mode controls
      setAreaControlsVisible(true);

      updateLayers();
    }
  });

  // --- Keyboard shortcuts ---
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDetail();
      return;
    }

    if (e.key === "ArrowLeft") {
      if (currentMonthIdx > 0) {
        currentMonthIdx--;
        currentMonth = months[currentMonthIdx];
        updateActiveNotch();
        updateLayers();
      }
    } else if (e.key === "ArrowRight") {
      if (currentMonthIdx < months.length - 1) {
        currentMonthIdx++;
        currentMonth = months[currentMonthIdx];
        updateActiveNotch();
        updateLayers();
      }
    }
  });
}

// --- Hero intro setup (runs synchronously before main) ---

const heroSeen = sessionStorage.getItem("heroShown") === "1";
let heroDismissed = heroSeen;

// Callback set by main() once the deck is ready, so early skips can trigger the pull-back.
let onHeroSkip: (() => void) | null = null;

const hero = document.createElement("div");
hero.id = "hero";

if (!heroSeen) {
  hero.innerHTML = `
    <h1 class="hero-title">On Location</h1>
    <span class="hero-accent"></span>
    <p class="hero-subtitle">NYC film &amp; TV permit activity, month by month</p>
    <p class="hero-loading">Loading</p>
  `;
  document.body.appendChild(hero);

  // Skip hero on click or keypress
  function skipHero(): void {
    if (heroDismissed) return;
    heroDismissed = true;
    sessionStorage.setItem("heroShown", "1");
    hero.classList.add("hero-fade");
    setTimeout(() => hero.remove(), 800);
    hero.removeEventListener("click", skipHero);
    document.removeEventListener("keydown", skipHero);
    // Trigger pull-back if deck is ready
    if (onHeroSkip) onHeroSkip();
  }
  hero.addEventListener("click", skipHero);
  document.addEventListener("keydown", skipHero);
}

main();

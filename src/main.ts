import "./style.css";
import { Deck } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
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

async function main(): Promise<void> {
  const [counts, cdBoundaries, zipBoundaries, captions] = await Promise.all([
    fetch("/data/counts.json").then((r) => r.json() as Promise<CountsData>),
    fetch("/data/cd-boundaries.geojson").then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, CdProperties>>,
    ),
    fetch("/data/zip-boundaries.geojson").then(
      (r) => r.json() as Promise<FeatureCollection<Geometry, ZipProperties>>,
    ),
    fetch("/data/captions.json")
      .then((r) => r.ok ? r.json() as Promise<CaptionsData> : null)
      .catch(() => null),
  ]);

  const { min, max } = counts.metadata.dateRange;
  const months = generateMonths(min, max);
  let currentMonth = max;
  let currentUnit: UnitMode = "cd";
  let activeCategories: Set<string> | null = null;
  let currentVizMode: VizMode = "bars";

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

  const vizToggle = document.createElement("button");
  vizToggle.id = "viz-toggle";
  vizToggle.textContent = "|||";
  vizToggle.title = "Toggle bars / circles";

  controls.append(unitToggle, vizToggle, playBtn, slider, monthLabel);
  document.body.appendChild(controls);

  // --- Trends sparkline ---
  const trends = document.createElement("div");
  trends.id = "trends";
  document.body.appendChild(trends);

  const SPARK_W = 300;
  const SPARK_H = 40;
  const SPARK_PAD = 2;

  function buildSparkline(): void {
    const countsMap = computeFilteredCounts(currentUnit, activeCategories);
    // Compute total shoots per month across all areas
    const totals = months.map((m) => {
      let sum = 0;
      for (const areaCounts of Object.values(countsMap)) {
        sum += areaCounts[m] ?? 0;
      }
      return sum;
    });
    const maxTotal = Math.max(...totals, 1);
    const currentIdx = months.indexOf(currentMonth);

    const stepX = (SPARK_W - SPARK_PAD * 2) / Math.max(months.length - 1, 1);

    // Build SVG path for the area fill and line
    const points = totals.map((t, i) => {
      const x = SPARK_PAD + i * stepX;
      const y = SPARK_H - SPARK_PAD - ((t / maxTotal) * (SPARK_H - SPARK_PAD * 2));
      return { x, y };
    });

    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    const areaPath = `${linePath} L${points[points.length - 1].x},${SPARK_H - SPARK_PAD} L${points[0].x},${SPARK_H - SPARK_PAD} Z`;

    const cx = currentIdx >= 0 ? points[currentIdx].x : 0;
    const cy = currentIdx >= 0 ? points[currentIdx].y : 0;

    trends.innerHTML = `<svg width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}">
      <path d="${areaPath}" fill="#ffc83c" opacity="0.15"/>
      <path d="${linePath}" fill="none" stroke="#ffc83c" stroke-width="1.5"/>
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="#ffc83c"/>
    </svg>`;
  }

  // Click sparkline to scrub to that month
  trends.addEventListener("click", (e: MouseEvent) => {
    const rect = trends.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const stepX = (SPARK_W - SPARK_PAD * 2) / Math.max(months.length - 1, 1);
    const idx = Math.round((x - SPARK_PAD) / stepX);
    const clampedIdx = Math.max(0, Math.min(months.length - 1, idx));
    slider.value = String(clampedIdx);
    currentMonth = months[clampedIdx];
    if (playing) stopPlayback();
    updateLayers();
  });

  // --- Title overlay ---
  const titleOverlay = document.createElement("div");
  titleOverlay.id = "title-overlay";
  titleOverlay.innerHTML =
    `<h1>On Location</h1><p>NYC film &amp; TV permit activity, month by month</p>`;
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
      transitions: {
        getRadius: { duration: 600, easing: (t: number) => t * (2 - t) },
        getFillColor: { duration: 600 },
      },
    });
  }

  function buildVisualizationLayer(month: string, unit: UnitMode): GeoJsonLayer | ScatterplotLayer {
    return currentVizMode === "bars"
      ? buildLayer(month, unit)
      : buildCircleLayer(month, unit);
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
    layers: [buildVisualizationLayer(currentMonth, currentUnit)],
    getTooltip: ({ object }: { object?: AreaFeature | CircleDataPoint }) => {
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
        html: `<strong>${label}</strong><br/>Shoots in ${formatMonth(currentMonth)}: ${count}`,
        style: tooltipStyle,
      };
    },
    onClick: ({ object }: { object?: AreaFeature | CircleDataPoint }) => {
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

  // Build initial sparkline
  buildSparkline();

  function openDetail(countsKey: string, label: string, centroid: [number, number]): void {
    detailAreaKey = countsKey;
    detailOpen = true;

    // Fly to the area
    deck.setProps({
      initialViewState: {
        longitude: centroid[0],
        latitude: centroid[1],
        zoom: 13,
        pitch: 45,
        bearing: 0,
        transitionDuration: 1200,
      },
    });

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
    const trend = currentCount > prevCount ? "\u2191" : currentCount < prevCount ? "\u2193" : "\u2192";

    // Sparkline for this area across all months
    const areaTotals = months.map((m) => areaCounts[m] ?? 0);
    const areaMax = Math.max(...areaTotals, 1);
    const sparkW = 260;
    const sparkH = 50;
    const sparkPad = 2;
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
      <button id="detail-close">\u2715</button>
      <h2>${label}</h2>
      <div class="detail-stat">
        <span class="detail-big">${currentCount}</span>
        <span class="detail-label">shoots in ${formatMonth(currentMonth)} ${trend}</span>
      </div>
      <div class="detail-stat">
        <span class="detail-rank">#${rank}</span>
        <span class="detail-label">of ${totalAreas} areas</span>
      </div>
      <div class="detail-section">
        <h3>Activity over time</h3>
        <svg width="${sparkW}" height="${sparkH}" viewBox="0 0 ${sparkW} ${sparkH}">
          <path d="${areaPath}" fill="#ffc83c" opacity="0.15"/>
          <path d="${linePath}" fill="none" stroke="#ffc83c" stroke-width="1.5"/>
          <circle cx="${cx}" cy="${cy}" r="3.5" fill="#ffc83c"/>
        </svg>
      </div>
      <div class="detail-section">
        <h3>Top months</h3>
        <ul class="detail-top-months">
          ${monthEntries.map((e) => `<li><strong>${formatMonth(e.month)}</strong> \u2014 ${e.count} shoots</li>`).join("")}
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

    // Fly back to overview
    deck.setProps({
      initialViewState: {
        ...INITIAL_VIEW_STATE,
        transitionDuration: 1000,
      },
    });
  }


  // --- Update layers ---
  function updateLayers(): void {
    monthLabel.textContent = formatMonth(currentMonth);
    const maxCount = computeMaxCount(computeFilteredCounts(currentUnit, activeCategories), currentMonth);
    legendMax.textContent = String(maxCount);
    if (captions) {
      const captionMap = currentUnit === "cd" ? captions.cd : captions.zip;
      const text = activeCategories === null ? (captionMap[currentMonth] ?? "") : "";
      captionEl.textContent = text;
      captionEl.style.opacity = text ? "1" : "0";
    }
    buildSparkline();
    // Refresh detail panel if open
    if (detailOpen && detailAreaKey) {
      const countsMap = computeFilteredCounts(currentUnit, activeCategories);
      const areaCounts = countsMap[detailAreaKey] ?? {};
      const count = areaCounts[currentMonth] ?? 0;
      const bigEl = detailPanel.querySelector(".detail-big");
      const labelEl = detailPanel.querySelector(".detail-stat .detail-label");
      if (bigEl) bigEl.textContent = String(count);
      if (labelEl) {
        const monthIdx = months.indexOf(currentMonth);
        const prevCount = monthIdx > 0 ? (areaCounts[months[monthIdx - 1]] ?? 0) : 0;
        const trend = count > prevCount ? "\u2191" : count < prevCount ? "\u2193" : "\u2192";
        labelEl.textContent = `shoots in ${formatMonth(currentMonth)} ${trend}`;
      }
    }

    deck.setProps({ layers: [buildVisualizationLayer(currentMonth, currentUnit)] });
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

  // --- Viz toggle ---
  vizToggle.addEventListener("click", () => {
    currentVizMode = currentVizMode === "bars" ? "circles" : "bars";
    vizToggle.textContent = currentVizMode === "bars" ? "|||" : "\u25CF";
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
    if (e.key === "Escape") {
      closeDetail();
      return;
    }

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

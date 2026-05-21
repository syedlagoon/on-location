import "./style.css";
import { Deck } from "@deck.gl/core";
import type { MapViewState } from "@deck.gl/core";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { createEffectsSystem } from "./effects";
import type { Feature, FeatureCollection, Geometry, Position, Polygon, MultiPolygon } from "geojson";

// --- Types ---

interface CountsData {
  metadata: {
    generatedAt: string;
    totalShoots: number;
    dateRange: { min: string; max: string };
    categories: string[];
  };
  byZip: Record<string, Record<string, number>>;
  byCommunityDistrict: Record<string, Record<string, number>>;
  byCategory: {
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
  formalLabel: string;
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

interface LocationFilmEntry {
  filmId: string;
  title: string;
  year: number | null;
  type: "film" | "tv";
  director?: string;
  genres?: string[];
  imdbId?: string;
  imageUrl?: string;
}

interface CuratedLocation {
  locationId: string;
  name: string;
  lat: number;
  lng: number;
  cdKey: string | null;
  zipKey: string | null;
  films: LocationFilmEntry[];
}

interface LocationsData {
  metadata: {
    generatedAt: string;
    totalLocations: number;
    totalFilms: number;
    enrichedAt?: string;
    enrichedFilms?: number;
  };
  locations: CuratedLocation[];
}

interface DiaryMatch {
  filmTitle: string;
  filmYear: number | null;
  rating: number | null;
  watchedDate: string | null;
  letterboxdUrl: string;
  locationIds: string[];
}

interface DiaryData {
  metadata: { user: string; matchedFilms: number; matchedLocations: number };
  matches: DiaryMatch[];
}

interface DiaryPinData {
  position: [number, number];
  locationId: string;
  name: string;
  filmLabel: string;
  location: CuratedLocation;
}


// --- Constants ---

const BOROUGH_NAMES: Record<number, string> = {
  1: "Manhattan",
  2: "Bronx",
  3: "Brooklyn",
  4: "Queens",
  5: "Staten Island",
};

/** Colloquial neighborhood names for each community district.
 *  Keys match the counts-key format ("Borough-N"). */
const CD_NEIGHBORHOOD_NAMES: Record<string, string> = {
  "Manhattan-1": "Financial District / Tribeca",
  "Manhattan-2": "Lower East Side / Chinatown",
  "Manhattan-3": "East Village / Lower East Side",
  "Manhattan-4": "Chelsea / Clinton",
  "Manhattan-5": "Midtown",
  "Manhattan-6": "Stuyvesant Town / Turtle Bay",
  "Manhattan-7": "Upper West Side",
  "Manhattan-8": "Upper East Side",
  "Manhattan-9": "Morningside Heights / Hamilton Heights",
  "Manhattan-10": "Central Harlem",
  "Manhattan-11": "East Harlem",
  "Manhattan-12": "Washington Heights / Inwood",
  "Bronx-1": "Mott Haven / Melrose",
  "Bronx-2": "Hunts Point / Longwood",
  "Bronx-3": "Morrisania / Crotona",
  "Bronx-4": "Highbridge / Concourse",
  "Bronx-5": "Fordham / University Heights",
  "Bronx-6": "Belmont / East Tremont",
  "Bronx-7": "Kingsbridge / Riverdale",
  "Bronx-8": "Throgs Neck / Pelham Bay",
  "Bronx-9": "Parkchester / Soundview",
  "Bronx-10": "Co-op City / Eastchester",
  "Bronx-11": "Morris Park / Pelham Parkway",
  "Bronx-12": "Williamsbridge / Baychester",
  "Brooklyn-1": "Williamsburg / Greenpoint",
  "Brooklyn-2": "Downtown Brooklyn / Fort Greene",
  "Brooklyn-3": "Bedford-Stuyvesant",
  "Brooklyn-4": "Bushwick",
  "Brooklyn-5": "East New York / Starrett City",
  "Brooklyn-6": "Park Slope / Carroll Gardens",
  "Brooklyn-7": "Sunset Park",
  "Brooklyn-8": "Crown Heights North",
  "Brooklyn-9": "Crown Heights South / Prospect Lefferts",
  "Brooklyn-10": "Bay Ridge",
  "Brooklyn-11": "Bensonhurst",
  "Brooklyn-12": "Borough Park",
  "Brooklyn-13": "Coney Island",
  "Brooklyn-14": "Flatbush / Midwood",
  "Brooklyn-15": "Sheepshead Bay",
  "Brooklyn-16": "Brownsville",
  "Brooklyn-17": "East Flatbush",
  "Brooklyn-18": "Canarsie / Flatlands",
  "Queens-1": "Astoria / Long Island City",
  "Queens-2": "Woodside / Sunnyside",
  "Queens-3": "Jackson Heights / East Elmhurst",
  "Queens-4": "Elmhurst / Corona",
  "Queens-5": "Ridgewood / Maspeth",
  "Queens-6": "Forest Hills / Rego Park",
  "Queens-7": "Flushing",
  "Queens-8": "Fresh Meadows / Hillcrest",
  "Queens-9": "Woodhaven / Richmond Hill",
  "Queens-10": "Howard Beach / Ozone Park",
  "Queens-11": "Bayside / Little Neck",
  "Queens-12": "Jamaica / St. Albans",
  "Queens-13": "Queens Village / Bellerose",
  "Queens-14": "Rockaway / Broad Channel",
  "Staten Island-1": "North Shore",
  "Staten Island-2": "Mid-Island",
  "Staten Island-3": "South Shore",
};

const ZIP_NEIGHBORHOOD_NAMES: Record<string, string> = {
  // --- Manhattan ---
  "10001": "Chelsea",
  "10002": "Lower East Side",
  "10003": "East Village",
  "10004": "Financial District",
  "10005": "Financial District",
  "10006": "Financial District",
  "10007": "Tribeca / City Hall",
  "10009": "East Village",
  "10010": "Gramercy Park / Flatiron",
  "10011": "Chelsea",
  "10012": "SoHo / NoHo",
  "10013": "Tribeca / Chinatown",
  "10014": "West Village",
  "10016": "Murray Hill",
  "10017": "Turtle Bay / Midtown East",
  "10018": "Garment District / Midtown",
  "10019": "Hell's Kitchen / Midtown West",
  "10020": "Rockefeller Center / Midtown",
  "10021": "Upper East Side",
  "10022": "Midtown East",
  "10023": "Upper West Side",
  "10024": "Upper West Side",
  "10025": "Upper West Side",
  "10026": "Central Harlem",
  "10027": "Central Harlem",
  "10028": "Upper East Side",
  "10029": "East Harlem",
  "10030": "Central Harlem",
  "10031": "Hamilton Heights",
  "10032": "Washington Heights",
  "10033": "Washington Heights",
  "10034": "Inwood",
  "10035": "East Harlem",
  "10036": "Times Square / Midtown",
  "10037": "Central Harlem",
  "10038": "Seaport / Civic Center",
  "10039": "Central Harlem",
  "10040": "Fort George / Washington Heights",
  "10041": "Financial District",
  "10044": "Roosevelt Island",
  "10045": "Financial District",
  "10048": "World Trade Center",
  "10065": "Upper East Side",
  "10069": "Upper West Side",
  "10075": "Upper East Side",
  "10080": "Lower Manhattan",
  "10103": "Midtown",
  "10105": "Midtown",
  "10106": "Midtown",
  "10110": "Midtown",
  "10111": "Rockefeller Center",
  "10112": "Rockefeller Center",
  "10115": "Morningside Heights",
  "10118": "Midtown / Penn Station",
  "10119": "Midtown",
  "10120": "Midtown",
  "10121": "Midtown",
  "10128": "Upper East Side",
  "10152": "Midtown East",
  "10154": "Midtown East",
  "10155": "Midtown East",
  "10158": "Grand Central / Midtown",
  "10165": "Midtown East",
  "10167": "Midtown East",
  "10168": "Grand Central / Midtown",
  "10169": "Midtown East",
  "10170": "Grand Central / Midtown",
  "10171": "Midtown East",
  "10172": "Grand Central / Midtown",
  "10173": "Midtown East",
  "10174": "Grand Central / Midtown",
  "10175": "Midtown East",
  "10176": "Midtown East",
  "10177": "Midtown East",
  "10178": "Grand Central / Midtown",
  "10271": "Financial District",
  "10278": "Financial District",
  "10279": "Financial District",
  "10280": "Battery Park City",
  "10281": "Battery Park City",
  "10282": "Battery Park City",

  // --- Bronx ---
  "10451": "Mott Haven",
  "10452": "Highbridge",
  "10453": "Morris Heights",
  "10454": "Mott Haven / Port Morris",
  "10455": "Longwood / Hunts Point",
  "10456": "Morrisania",
  "10457": "Tremont",
  "10458": "Belmont / Fordham",
  "10459": "Longwood",
  "10460": "West Farms / Tremont",
  "10461": "Morris Park / Pelham Parkway",
  "10462": "Parkchester / Van Nest",
  "10463": "Kingsbridge / Riverdale",
  "10464": "City Island / Pelham Bay",
  "10465": "Throgs Neck",
  "10466": "Wakefield / Williamsbridge",
  "10467": "Norwood / Bedford Park",
  "10468": "Fordham / University Heights",
  "10469": "Eastchester / Baychester",
  "10470": "Woodlawn",
  "10471": "Riverdale / Fieldston",
  "10472": "Soundview",
  "10473": "Soundview / Clason Point",
  "10474": "Hunts Point",
  "10475": "Co-op City",

  // --- Staten Island ---
  "10301": "St. George / Tompkinsville",
  "10302": "Port Richmond",
  "10303": "Mariners Harbor",
  "10304": "Stapleton / Grymes Hill",
  "10305": "South Beach / Rosebank",
  "10306": "Midland Beach / New Dorp",
  "10307": "Tottenville",
  "10308": "Great Kills",
  "10309": "Charleston / Pleasant Plains",
  "10310": "West New Brighton",
  "10312": "Annadale / Eltingville",
  "10314": "Travis / New Springville",

  // --- Brooklyn ---
  "11201": "Downtown Brooklyn / Brooklyn Heights",
  "11203": "East Flatbush",
  "11204": "Bensonhurst",
  "11205": "Fort Greene / Clinton Hill",
  "11206": "Williamsburg / Bedford-Stuyvesant",
  "11207": "East New York",
  "11208": "East New York / Cypress Hills",
  "11209": "Bay Ridge",
  "11210": "Flatbush / Midwood",
  "11211": "Williamsburg",
  "11212": "Brownsville",
  "11213": "Crown Heights",
  "11214": "Bensonhurst / Bath Beach",
  "11215": "Park Slope",
  "11216": "Bedford-Stuyvesant",
  "11217": "Park Slope / Prospect Heights",
  "11218": "Kensington / Windsor Terrace",
  "11219": "Borough Park",
  "11220": "Sunset Park",
  "11221": "Bushwick / Bedford-Stuyvesant",
  "11222": "Greenpoint",
  "11223": "Gravesend",
  "11224": "Coney Island / Brighton Beach",
  "11225": "Crown Heights / Prospect Lefferts",
  "11226": "Flatbush",
  "11228": "Dyker Heights",
  "11229": "Sheepshead Bay / Homecrest",
  "11230": "Midwood",
  "11231": "Carroll Gardens / Red Hook",
  "11232": "Sunset Park / Industry City",
  "11233": "Brownsville / Ocean Hill",
  "11234": "Canarsie / Mill Basin",
  "11235": "Brighton Beach / Sheepshead Bay",
  "11236": "Canarsie / Flatlands",
  "11237": "Bushwick",
  "11238": "Prospect Heights",
  "11239": "East New York / Starrett City",
  "11249": "Williamsburg",
  "11251": "Downtown Brooklyn",

  // --- Queens ---
  "11004": "Glen Oaks / Bellerose",
  "11038": "Fresh Meadows",
  "11040": "New Hyde Park / Bellerose",
  "11101": "Long Island City",
  "11102": "Astoria",
  "11103": "Astoria",
  "11104": "Sunnyside / Woodside",
  "11105": "Astoria / Ditmars",
  "11106": "Astoria",
  "11109": "Long Island City",
  "11354": "Flushing",
  "11355": "Flushing",
  "11356": "College Point",
  "11357": "Whitestone",
  "11358": "Auburndale / Flushing",
  "11359": "Bayside",
  "11360": "Bayside",
  "11361": "Bayside / Little Neck",
  "11362": "Little Neck",
  "11363": "Douglaston",
  "11364": "Oakland Gardens / Bayside",
  "11365": "Fresh Meadows",
  "11366": "Fresh Meadows / Hillcrest",
  "11367": "Kew Gardens Hills",
  "11368": "Corona",
  "11369": "East Elmhurst",
  "11370": "Jackson Heights",
  "11371": "LaGuardia Airport",
  "11372": "Jackson Heights",
  "11373": "Elmhurst",
  "11374": "Rego Park",
  "11375": "Forest Hills",
  "11377": "Woodside",
  "11378": "Maspeth",
  "11379": "Middle Village",
  "11385": "Ridgewood / Glendale",
  "11411": "Cambria Heights",
  "11412": "St. Albans",
  "11413": "Springfield Gardens / Laurelton",
  "11414": "Howard Beach",
  "11415": "Kew Gardens",
  "11416": "Ozone Park",
  "11417": "Ozone Park / Woodhaven",
  "11418": "Richmond Hill",
  "11419": "South Richmond Hill",
  "11420": "South Ozone Park",
  "11421": "Woodhaven",
  "11423": "Hollis",
  "11426": "Bellerose / Glen Oaks",
  "11427": "Queens Village",
  "11429": "Queens Village",
  "11432": "Jamaica",
  "11433": "Jamaica",
  "11434": "Jamaica / Rochdale",
  "11435": "Jamaica / Briarwood",
  "11436": "South Ozone Park",
  "11691": "Far Rockaway",
  "11692": "Arverne / Edgemere",
  "11693": "Rockaway Beach",
  "11694": "Rockaway Park / Belle Harbor",
  "11697": "Breezy Point / Roxbury",
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

/** Escape HTML special characters to prevent XSS from user-controlled data. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Convert a 0.5–5.0 rating to Unicode stars: full ★ for whole, ½ for remainder. */
function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  return "\u2605".repeat(full) + (hasHalf ? "\u00BD" : "");
}

/** Format "YYYY-MM-DD" → "Mar 15, 2024" style label. */
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const [counts, cdBoundaries, zipBoundaries, captions, locationsData, diaryData] = await Promise.all([
    fetch(`${BASE}data/counts.json`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load counts.json (${r.status})`);
      return r.json() as Promise<CountsData>;
    }),
    fetch(`${BASE}data/cd-boundaries.geojson`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load cd-boundaries.geojson (${r.status})`);
      return r.json() as Promise<FeatureCollection<Geometry, CdProperties>>;
    }),
    fetch(`${BASE}data/zip-boundaries.geojson`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load zip-boundaries.geojson (${r.status})`);
      return r.json() as Promise<FeatureCollection<Geometry, ZipProperties>>;
    }),
    fetch(`${BASE}data/captions.json`)
      .then((r) => r.ok ? r.json() as Promise<CaptionsData> : null)
      .catch(() => null),
    fetch(`${BASE}data/locations.json`)
      .then((r) => r.ok ? r.json() as Promise<LocationsData> : null)
      .catch(() => null),
    fetch(`${BASE}data/diary.json`)
      .then((r) => r.ok ? r.json() as Promise<DiaryData> : null)
      .catch(() => null),
  ]);

  // --- Diary lookup maps ---
  // Map locationId -> DiaryMatch[] for O(1) access when rendering location details.
  // Set of matched locationIds for fast pin highlighting.
  const diaryByLocation = new Map<string, DiaryMatch[]>();
  const matchedLocationIds = new Set<string>();
  // Map normalized film title -> DiaryMatch for inline badges in area detail panels.
  const diaryByTitle = new Map<string, DiaryMatch>();

  if (diaryData && diaryData.matches.length > 0) {
    for (const match of diaryData.matches) {
      for (const locId of match.locationIds) {
        matchedLocationIds.add(locId);
        if (!diaryByLocation.has(locId)) diaryByLocation.set(locId, []);
        diaryByLocation.get(locId)!.push(match);
      }
      // Key by normalized title+year for area detail matching
      const normKey = `${match.filmTitle.toLowerCase().trim()}::${match.filmYear ?? "?"}`;
      if (!diaryByTitle.has(normKey)) diaryByTitle.set(normKey, match);
    }
  }

  const { min, max } = counts.metadata.dateRange;
  const months = generateMonths(min, max);
  let blocksData: BlocksData | null = null;

  // --- Permalink: hash-based URL state ---
  // We use hash params (e.g. #month=2025-06&unit=cd&viz=bars&grain=area&cats=Television,Film)
  // instead of query params because hash changes don't trigger server requests.
  // This is critical for static-site deploys on GitHub Pages, which would otherwise
  // try to route query-parameterized URLs to a server that doesn't exist.

  /** Parse the URL hash into a key-value map. */
  function parseHash(): Map<string, string> {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new Map<string, string>();
    if (!hash) return params;
    for (const pair of hash.split("&")) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eqIdx));
      const value = decodeURIComponent(pair.slice(eqIdx + 1));
      params.set(key, value);
    }
    return params;
  }

  /**
   * Parse URL hash params and return validated initial state values.
   * Invalid or missing params silently fall back to defaults.
   * Called once before state variables are declared so the returned
   * values can be used directly as initializers (avoiding TS narrowing issues).
   */
  function readHashState(): {
    month: string;
    monthIdx: number;
    unit: UnitMode;
    vizMode: VizMode;
    grain: GrainMode;
    categories: Set<string> | null;
    showLocations: boolean;
    decade: number | null;
  } {
    const params = parseHash();

    // month — must be a valid entry in the months array
    let month = max;
    let monthIdx = months.indexOf(max);
    const monthParam = params.get("month");
    if (monthParam && months.includes(monthParam)) {
      month = monthParam;
      monthIdx = months.indexOf(monthParam);
    }

    // unit — must be "cd" or "zip"
    let unit: UnitMode = "cd";
    const unitParam = params.get("unit");
    if (unitParam === "cd" || unitParam === "zip") {
      unit = unitParam;
    }

    // viz — must be "bars" or "circles"
    let vizMode: VizMode = "bars";
    const vizParam = params.get("viz");
    if (vizParam === "bars" || vizParam === "circles") {
      vizMode = vizParam;
    }

    // grain — must be "area" or "block"
    let grain: GrainMode = "area";
    const grainParam = params.get("grain");
    if (grainParam === "area" || grainParam === "block") {
      grain = grainParam;
    }

    // cats — comma-separated category names, or omit/empty for "all"
    let categories: Set<string> | null = null;
    const catsParam = params.get("cats");
    if (catsParam !== undefined && catsParam !== "") {
      const validCategories = counts.metadata.categories;
      const requested = catsParam.split(",").filter((c) => validCategories.includes(c));
      if (requested.length > 0) {
        categories = new Set(requested);
      }
    }

    // loc — "1" means locations layer on
    const showLocations = params.get("loc") === "1" && locationsData !== null;

    // decade — must be a valid decade number
    let decade: number | null = null;
    const decadeParam = params.get("decade");
    if (decadeParam) {
      const d = parseInt(decadeParam, 10);
      if (!isNaN(d) && d >= 1800 && d <= 2100 && d % 10 === 0) {
        decade = d;
      }
    }

    return { month, monthIdx, unit, vizMode, grain, categories, showLocations, decade };
  }

  // Restore state from URL hash before declaring state variables.
  // Using the returned values as initializers avoids TS6's aggressive
  // control-flow narrowing of `let` variables with literal defaults.
  const hashState = readHashState();
  let currentMonth = hashState.month;
  let currentUnit: UnitMode = hashState.unit;
  let activeCategories: Set<string> | null = hashState.categories;
  let currentVizMode: VizMode = hashState.vizMode;
  let currentGrain: GrainMode = hashState.grain;
  let currentMonthIdx = hashState.monthIdx;
  let showLocations = hashState.showLocations;
  let currentDecade: number | null = hashState.decade;
  let diaryMode = false;

  /** Serialize current state to the URL hash via replaceState (no history entry). */
  function updateHash(): void {
    const pairs: string[] = [];
    pairs.push(`month=${encodeURIComponent(currentMonth)}`);
    pairs.push(`unit=${encodeURIComponent(currentUnit)}`);
    pairs.push(`viz=${encodeURIComponent(currentVizMode)}`);
    pairs.push(`grain=${encodeURIComponent(currentGrain)}`);
    if (activeCategories !== null && activeCategories.size > 0) {
      pairs.push(`cats=${encodeURIComponent([...activeCategories].sort().join(","))}`);
    }
    if (showLocations) {
      pairs.push("loc=1");
    }
    if (currentDecade !== null) {
      pairs.push(`decade=${currentDecade}`);
    }
    const newHash = `#${pairs.join("&")}`;
    // replaceState avoids polluting the browser's back/forward history
    history.replaceState(null, "", newHash);
  }

  /** Debounced version of updateHash — collapses rapid state changes (e.g. play
   *  animation ticking through months) into a single URL update after 300ms. */
  let hashDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedUpdateHash(): void {
    if (hashDebounceTimer !== null) {
      clearTimeout(hashDebounceTimer);
    }
    hashDebounceTimer = setTimeout(() => {
      hashDebounceTimer = null;
      updateHash();
    }, 300);
  }

  // --- Semantic landmarks ---
  const appEl = document.getElementById("app");
  if (appEl) appEl.setAttribute("role", "main");

  // --- Build toolbar card with descriptive toggle rows ---
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";
  toolbar.setAttribute("role", "region");
  toolbar.setAttribute("aria-label", "Visualization controls");

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
    toggle.type = "button";
    toggle.className = "toolbar-toggle";
    toggle.textContent = initialLabel;
    toggle.setAttribute("aria-label", ariaLabel);

    row.append(info, toggle);

    // Clicking anywhere on the row triggers the toggle, but avoid
    // double-firing when the toggle button itself is clicked (the
    // click would bubble up to the row and call toggle.click() again).
    row.addEventListener("click", (ev) => {
      if (ev.target !== toggle) toggle.click();
    });

    return { row, toggle };
  }

  const { row: unitRow, toggle: unitToggle } = createToolbarRow(
    "Area",
    "Community districts or zip codes",
    currentUnit === "cd" ? "CD" : "ZIP",
    "Toggle area type",
  );

  const { row: vizRow, toggle: vizToggle } = createToolbarRow(
    "Shape",
    "3D bars or proportional circles",
    currentVizMode === "bars" ? "Bars" : "Circles",
    "Toggle visualization shape",
  );

  // --- Type accordion (category filter inside toolbar) ---
  const typeRow = document.createElement("div");
  typeRow.className = "toolbar-row";
  const typeInfo = document.createElement("div");
  typeInfo.className = "toolbar-info";
  const typeHeading = document.createElement("span");
  typeHeading.className = "toolbar-heading";
  typeHeading.textContent = "Type";
  const typeDesc = document.createElement("span");
  typeDesc.className = "toolbar-desc";
  typeDesc.textContent = "Filter by permit category";
  typeInfo.append(typeHeading, typeDesc);
  const typeChevron = document.createElement("button");
  typeChevron.type = "button";
  typeChevron.className = "toolbar-toggle toolbar-toggle-chevron";
  typeChevron.textContent = "All";
  typeChevron.setAttribute("aria-label", "Toggle category filter");
  typeRow.append(typeInfo, typeChevron);
  const typeExpandable = document.createElement("div");
  typeExpandable.className = "toolbar-expandable";
  typeExpandable.id = "type-expandable";
  const typeInner = document.createElement("div");
  typeInner.className = "toolbar-expandable-inner";
  typeExpandable.appendChild(typeInner);

  // ARIA: link the chevron button to the expandable panel it controls
  typeChevron.setAttribute("aria-expanded", "false");
  typeChevron.setAttribute("aria-controls", "type-expandable");

  typeRow.addEventListener("click", (ev) => {
    if (ev.target !== typeChevron) typeChevron.click();
  });
  typeChevron.addEventListener("click", (e) => {
    e.stopPropagation();
    const isExpanded = typeExpandable.classList.toggle("expanded");
    typeChevron.classList.toggle("chevron-up");
    typeChevron.setAttribute("aria-expanded", String(isExpanded));
  });

  // --- Landmarks accordion (toggle + decade pills inside toolbar) ---
  let landmarksRow: HTMLDivElement | null = null;
  let landmarksToggle: HTMLButtonElement | null = null;
  let landmarksExpandable: HTMLDivElement | null = null;
  const decadePillsContainer = document.createElement("div");
  decadePillsContainer.className = "toolbar-expandable-inner decades-grid";

  const availableDecades: number[] = [];
  if (locationsData) {
    const decadeSet = new Set<number>();
    for (const loc of locationsData.locations) {
      for (const f of loc.films) {
        if (f.year !== null) decadeSet.add(Math.floor(f.year / 10) * 10);
      }
    }
    availableDecades.push(...[...decadeSet].sort((a, b) => a - b));

    landmarksRow = document.createElement("div");
    landmarksRow.className = "toolbar-row";
    const lmInfo = document.createElement("div");
    lmInfo.className = "toolbar-info";
    const lmHeading = document.createElement("span");
    lmHeading.className = "toolbar-heading";
    lmHeading.textContent = "Landmarks";
    const lmDesc = document.createElement("span");
    lmDesc.className = "toolbar-desc";
    lmDesc.textContent = "Filming location pins";
    lmInfo.append(lmHeading, lmDesc);

    landmarksToggle = document.createElement("button");
    landmarksToggle.type = "button";
    landmarksToggle.className = "toolbar-toggle";
    landmarksToggle.textContent = showLocations ? "On" : "Off";
    landmarksToggle.setAttribute("aria-label", "Toggle filming landmarks");
    landmarksToggle.setAttribute("aria-pressed", String(showLocations));
    if (showLocations) landmarksToggle.classList.add("toggle-active");
    landmarksRow.append(lmInfo, landmarksToggle);

    landmarksRow.addEventListener("click", (ev) => {
      if (ev.target !== landmarksToggle) landmarksToggle!.click();
    });

    landmarksExpandable = document.createElement("div");
    landmarksExpandable.className = "toolbar-expandable";
    landmarksExpandable.id = "landmarks-expandable";
    if (showLocations) landmarksExpandable.classList.add("expanded");
    landmarksExpandable.appendChild(decadePillsContainer);

    // ARIA: link the landmarks toggle to the expandable panel it controls
    landmarksToggle.setAttribute("aria-expanded", String(showLocations));
    landmarksToggle.setAttribute("aria-controls", "landmarks-expandable");
  }

  // --- Diary toggle row (only shown when diary has matches) ---
  let diaryRow: HTMLDivElement | null = null;
  let diaryToggle: HTMLButtonElement | null = null;
  const hasDiaryData = diaryData !== null && diaryData.matches.length > 0;

  if (hasDiaryData) {
    const result = createToolbarRow(
      "Diary",
      "Films you\u2019ve watched",
      "Off",
      "Toggle diary mode",
    );
    diaryRow = result.row;
    diaryToggle = result.toggle;
    diaryRow.classList.add("toolbar-row-diary");
  }

  // Assemble toolbar
  if (diaryRow) toolbar.append(diaryRow);
  toolbar.append(unitRow, vizRow, typeRow, typeExpandable);
  if (landmarksRow && landmarksExpandable) {
    toolbar.append(landmarksRow, landmarksExpandable);
  }
  document.body.appendChild(toolbar);

  function buildDecadePills(): void {
    decadePillsContainer.innerHTML = "";
    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.textContent = "All";
    allPill.classList.add("decade-pill");
    if (currentDecade === null) allPill.classList.add("decade-active");
    allPill.addEventListener("click", () => {
      currentDecade = null;
      effectsSystem.setDecadeGrade(null);
      updateDecadePillStates();
      updateLayers();
    });
    decadePillsContainer.appendChild(allPill);

    for (const d of availableDecades) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.textContent = `${d}s`;
      pill.classList.add("decade-pill");
      pill.setAttribute("data-decade", String(d));
      if (currentDecade === d) pill.classList.add("decade-active");
      pill.addEventListener("click", () => {
        currentDecade = currentDecade === d ? null : d;
        effectsSystem.setDecadeGrade(currentDecade);
        updateDecadePillStates();
        updateLayers();
      });
      decadePillsContainer.appendChild(pill);
    }
  }

  function updateDecadePillStates(): void {
    decadePillsContainer.querySelectorAll(".decade-pill").forEach((el) => {
      const decadeAttr = el.getAttribute("data-decade");
      if (decadeAttr === null) {
        el.classList.toggle("decade-active", currentDecade === null);
      } else {
        el.classList.toggle("decade-active", currentDecade === parseInt(decadeAttr, 10));
      }
    });
  }

  if (availableDecades.length > 0) {
    buildDecadePills();
  }

  // --- Build notch timeline ---
  const timeline = document.createElement("div");
  timeline.id = "timeline";
  timeline.setAttribute("role", "region");
  timeline.setAttribute("aria-label", "Month timeline");

  const timelineLabel = document.createElement("div");
  timelineLabel.id = "timeline-label";
  timelineLabel.textContent = formatMonth(currentMonth);
  timelineLabel.setAttribute("aria-live", "polite");
  timelineLabel.setAttribute("aria-atomic", "true");

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

  /** Tooltip elements paired with notch elements, for in-place text updates. */
  const notchTooltips: HTMLDivElement[] = [];

  /** Create notch DOM elements once. Subsequent updates use updateNotchHeights. */
  function buildNotches(): void {
    const needsCreate = notchElements.length === 0;
    if (needsCreate) {
      timelineTrack.innerHTML = "";
      notchElements.length = 0;
      notchTooltips.length = 0;

      for (let i = 0; i < months.length; i++) {
        const notch = document.createElement("div");
        notch.className = "notch";

        // Hover tooltip (hidden by default, shown via CSS)
        const tooltip = document.createElement("div");
        tooltip.className = "notch-tooltip";
        notch.appendChild(tooltip);

        if (i === currentMonthIdx) {
          notch.classList.add("notch-active");
        }

        const idx = i; // capture for closure
        notch.addEventListener("click", () => {
          currentMonthIdx = idx;
          currentMonth = months[idx];
          updateLayers();
        });

        timelineTrack.appendChild(notch);
        notchElements.push(notch);
        notchTooltips.push(tooltip);
      }
    }
    // Update heights and tooltips in-place (no DOM teardown)
    updateNotchHeights();
  }

  /** Update notch heights and tooltip text in-place using scaleY for GPU compositing. */
  function updateNotchHeights(): void {
    const totals = computeMonthTotals();
    const maxTotal = Math.max(...totals, 1);
    for (let i = 0; i < notchElements.length; i++) {
      const scale = Math.max(0.08, totals[i] / maxTotal); // min 8% so empty months visible
      notchElements[i].style.transform = `scaleY(${scale})`;
      // Inverse scale used by tooltip to counter the parent's scaleY
      notchElements[i].style.setProperty("--notch-scale-inv", String(1 / scale));
      notchTooltips[i].textContent = `${formatMonth(months[i])}: ${totals[i]}`;
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
  const diaryCountHtml = diaryData && diaryData.matches.length > 0
    ? `<div class="diary-count">\uD83C\uDFAC ${diaryData.matches.length} ${diaryData.matches.length === 1 ? "film" : "films"} you've watched ${diaryData.matches.length === 1 ? "was" : "were"} shot in NYC</div>`
    : "";
  titleOverlay.innerHTML =
    `<h1>On Location</h1><span class="title-accent"></span><p>New York City&#x27;s filming landscape, mapped</p>${diaryCountHtml}`;
  document.body.appendChild(titleOverlay);

  // --- Caption ---
  const captionEl = document.createElement("div");
  captionEl.id = "caption";
  document.body.appendChild(captionEl);

  // --- Color legend ---
  const legend = document.createElement("div");
  legend.id = "legend";
  legend.setAttribute("role", "img");
  legend.setAttribute("aria-label", "Color legend: shoot count from low to high");
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

  // --- Map control hint (auto-hides after 5s) ---
  const controlHint = document.createElement("div");
  controlHint.id = "control-hint";
  controlHint.textContent = "Right-drag to rotate · Ctrl-drag to pitch · Scroll to zoom";
  document.body.appendChild(controlHint);

  // --- Diary stats card (replaces timeline when diary mode is active) ---
  const diaryStatsCard = document.createElement("div");
  diaryStatsCard.id = "diary-stats-card";
  diaryStatsCard.setAttribute("role", "region");
  diaryStatsCard.setAttribute("aria-label", "Your NYC film diary");

  if (hasDiaryData && diaryData) {
    const sortedMatches = [...diaryData.matches].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const totalLocations = matchedLocationIds.size;
    const filmListHtml = sortedMatches.map((m) => {
      const starsHtml = m.rating !== null ? renderStars(m.rating) : "";
      const yearHtml = m.filmYear !== null ? ` <span class="diary-stats-year">(${m.filmYear})</span>` : "";
      return `<div class="diary-stats-film" data-film-title="${escapeHtml(m.filmTitle)}">${starsHtml ? `<span class="diary-stats-stars">${starsHtml}</span>` : ""}<span class="diary-stats-title">${escapeHtml(m.filmTitle)}${yearHtml}</span></div>`;
    }).join("");
    diaryStatsCard.innerHTML = `
      <div class="diary-stats-header">YOUR NYC FILM MAP</div>
      <div class="diary-stats-summary">${sortedMatches.length} films \u00B7 ${totalLocations} locations</div>
      <div class="diary-stats-list">${filmListHtml}</div>
    `;
  }
  document.body.appendChild(diaryStatsCard);

  // --- Category filter pills (inside toolbar "Type" expandable) ---
  /** Update the type chevron label to reflect current selection. */
  function updateTypeLabel(): void {
    if (activeCategories === null) {
      typeChevron.textContent = "All";
    } else {
      typeChevron.textContent = `${activeCategories.size}`;
    }
  }

  if (counts.metadata.categories && counts.metadata.categories.length > 0) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = "All";
    allBtn.classList.add("cat-pill", "cat-active");
    allBtn.addEventListener("click", () => {
      activeCategories = null;
      typeInner.querySelectorAll(".cat-pill").forEach((el) => el.classList.remove("cat-active"));
      allBtn.classList.add("cat-active");
      updateTypeLabel();
      buildNotches();
      updateLayers();
    });
    typeInner.appendChild(allBtn);

    for (const cat of counts.metadata.categories) {
      const pill = document.createElement("button");
      pill.type = "button";
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
        typeInner.querySelectorAll(".cat-pill").forEach((el) => {
          const pillText = el.textContent ?? "";
          if (pillText === "All") {
            el.classList.toggle("cat-active", activeCategories === null);
          } else {
            el.classList.toggle("cat-active", activeCategories !== null && activeCategories.has(pillText));
          }
        });
        updateTypeLabel();
        buildNotches();
        updateLayers();
      });
      typeInner.appendChild(pill);
    }
  }


  // --- Detail panel ---
  const detailPanel = document.createElement("div");
  detailPanel.id = "detail-panel";
  detailPanel.setAttribute("role", "complementary");
  detailPanel.setAttribute("aria-label", "Area detail panel");
  document.body.appendChild(detailPanel);
  let detailOpen = false;
  let detailAreaKey: string | null = null;
  let detailAreaLabel: string | null = null;

  // --- Spring physics for detail panel ---
  // Damped spring solver replaces CSS transition for a natural, alive feel.
  // The spring drives --panel-offset (0 = fully open, 100 = fully closed).
  // CSS maps this to translateX (desktop) or translateY (mobile).

  interface SpringState {
    value: number;
    velocity: number;
    target: number;
  }

  const panelSpring: SpringState = { value: 100, velocity: 0, target: 100 };
  let panelRaf: number | null = null;

  // Stiffness controls snap speed; damping controls overshoot.
  // These values give a quick snap with ~10% overshoot — perceptible but not sloppy.
  const SPRING_STIFFNESS = 180;
  const SPRING_DAMPING = 22;

  function stepSpring(s: SpringState, dt: number): boolean {
    const displacement = s.value - s.target;
    const springForce = -SPRING_STIFFNESS * displacement;
    const dampingForce = -SPRING_DAMPING * s.velocity;
    s.velocity += (springForce + dampingForce) * dt;
    s.value += s.velocity * dt;

    // Settle when both position and velocity are negligible
    if (Math.abs(displacement) < 0.1 && Math.abs(s.velocity) < 0.5) {
      s.value = s.target;
      s.velocity = 0;
      return false; // settled
    }
    return true; // still animating
  }

  function animatePanel(): void {
    const animating = stepSpring(panelSpring, 1 / 60);
    detailPanel.style.setProperty("--panel-offset", String(panelSpring.value));

    if (animating) {
      panelRaf = requestAnimationFrame(animatePanel);
    } else {
      panelRaf = null;
      // When fully closed, clean up DOM state
      if (panelSpring.value >= 99) {
        detailPanel.classList.remove("open", "no-animate");
      }
    }
  }

  function openPanelSpring(): void {
    panelSpring.target = 0;
    if (panelRaf === null) {
      panelRaf = requestAnimationFrame(animatePanel);
    }
  }

  function closePanelSpring(): void {
    panelSpring.target = 100;
    if (panelRaf === null) {
      panelRaf = requestAnimationFrame(animatePanel);
    }
  }

  // --- Resolve the counts key and display label for a feature ---
  function resolveFeature(
    f: AreaFeature,
    unit: UnitMode,
  ): { countsKey: string; label: string; formalLabel: string } | null {
    if (unit === "cd") {
      const props = f.properties as CdProperties;
      const key = cdKey(props.boro_cd);
      if (!key) return null;
      const [borough, cdNum] = key.split("-");
      const formalLabel = `${borough} CD ${cdNum}`;
      const label = CD_NEIGHBORHOOD_NAMES[key] ?? formalLabel;
      return { countsKey: key, label, formalLabel };
    }
    const props = f.properties as ZipProperties;
    const zip = props.modzcta;
    if (!zip) return null;
    const formalLabel = `Zip ${zip}`;
    const label = ZIP_NEIGHBORHOOD_NAMES[zip] ?? formalLabel;
    return { countsKey: zip, label, formalLabel };
  }

  function computeFilteredCounts(
    unit: UnitMode,
    categories: Set<string> | null,
  ): Record<string, Record<string, number>> {
    // When no categories are selected, return the pre-aggregated totals.
    // This ensures backwards compatibility and avoids summing all byCategory
    // entries (which would be equivalent but slower).
    if (categories === null) {
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

  /** Serialize activeCategories into a stable string for updateTriggers. */
  function categoryTrigger(): string {
    if (activeCategories === null) return "all";
    return [...activeCategories].sort().join(",");
  }

  // --- Layer builder ---
  function buildLayer(month: string, unit: UnitMode, countsMap: Record<string, Record<string, number>>): GeoJsonLayer {
    const maxCount = computeMaxCount(countsMap, month);
    const data = unit === "cd" ? cdBoundaries : zipBoundaries;
    const catTrigger = categoryTrigger();

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
        getElevation: [month, unit, catTrigger],
        getFillColor: [month, unit, catTrigger],
      },
      transitions: {
        getElevation: { duration: 700, easing: (t: number) => 1 - Math.pow(1 - t, 3) },
        getFillColor: { duration: 700 },
      },
    });
  }

  // --- Circle layer builder ---
  function buildCircleLayer(month: string, unit: UnitMode, countsMap: Record<string, Record<string, number>>): ScatterplotLayer {
    const maxCount = computeMaxCount(countsMap, month);
    const features = unit === "cd" ? cdBoundaries.features : zipBoundaries.features;

    const data: CircleDataPoint[] = [];
    for (const f of features) {
      const resolved = resolveFeature(f as AreaFeature, unit);
      if (!resolved) continue;
      const count = countsMap[resolved.countsKey]?.[month] ?? 0;
      const centroid = computeCentroid(f.geometry as Polygon | MultiPolygon);
      data.push({ position: centroid, count, label: resolved.label, formalLabel: resolved.formalLabel, countsKey: resolved.countsKey });
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
        getRadius: [month, unit, categoryTrigger()],
        getFillColor: [month, unit, categoryTrigger()],
      },
      transitions: {
        getRadius: { duration: 800, easing: (t: number) => t < 1 ? 1 - Math.pow(1 - t, 4) : 1 },
        getFillColor: { duration: 700 },
      },
    });
  }

  /** Build all layers for the current viz mode. Base boundary always included. */
  function buildVisualizationLayers(month: string, unit: UnitMode, countsMap: Record<string, Record<string, number>>): (GeoJsonLayer | ScatterplotLayer)[] {
    const base = buildBaseLayer(unit);
    if (currentVizMode === "bars") {
      return [base, buildLayer(month, unit, countsMap)];
    }
    // Circles: base boundaries underneath, circles on top
    return [base, buildCircleLayer(month, unit, countsMap)];
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

  // --- Locations layer (curated landmark pins) ---
  function filterLocationsByDecade(locations: CuratedLocation[], decade: number | null): CuratedLocation[] {
    if (decade === null) return locations;
    return locations.filter((loc) =>
      loc.films.some((f) => f.year !== null && Math.floor(f.year / 10) * 10 === decade),
    );
  }

  function buildLocationsLayer(locations: CuratedLocation[], decade: number | null): ScatterplotLayer {
    const filtered = filterLocationsByDecade(locations, decade);
    const hasDiaryMatches = matchedLocationIds.size > 0;
    return new ScatterplotLayer({
      id: "locations-layer",
      data: filtered,
      pickable: true,
      opacity: 0.9,
      stroked: true,
      filled: true,
      getPosition: (d: CuratedLocation) => [d.lng, d.lat],
      getRadius: (d: CuratedLocation) =>
        hasDiaryMatches && matchedLocationIds.has(d.locationId) ? 7 : 6,
      radiusMinPixels: 5,
      radiusMaxPixels: (hasDiaryMatches ? 12 : 10),
      radiusUnits: "pixels" as const,
      getFillColor: (d: CuratedLocation): [number, number, number, number] =>
        hasDiaryMatches && matchedLocationIds.has(d.locationId)
          ? [0, 224, 84, 240]     // Letterboxd green
          : [255, 200, 60, 220],  // regular amber
      getLineColor: (d: CuratedLocation): [number, number, number, number] =>
        hasDiaryMatches && matchedLocationIds.has(d.locationId)
          ? [255, 255, 255, 240]
          : [255, 255, 255, 200],
      lineWidthMinPixels: (hasDiaryMatches ? 2 : 1.5),
      updateTriggers: {
        getPosition: [decade],
        getFillColor: [hasDiaryMatches],
        getRadius: [hasDiaryMatches],
      },
    });
  }

  // --- Diary mode layers (clean pins, no labels/glow) ---
  // Glow rings and text labels were removed to fix dense-area clutter
  // (e.g. midtown Manhattan where 12+ pins cluster). Location names and
  // film titles appear on hover via the deck.gl tooltip instead.
  function buildDiaryLayers(): ScatterplotLayer[] {
    if (!locationsData) return [];

    // Build data: only diary-matched locations
    const pinData: DiaryPinData[] = [];
    for (const loc of locationsData.locations) {
      if (!matchedLocationIds.has(loc.locationId)) continue;
      const matches = diaryByLocation.get(loc.locationId);
      if (!matches) continue;
      const titles = matches.map((m) => m.filmTitle);
      const filmLabel = titles.length <= 2
        ? titles.join(", ")
        : `${titles[0]} +${titles.length - 1}`;
      pinData.push({
        position: [loc.lng, loc.lat],
        locationId: loc.locationId,
        name: loc.name,
        filmLabel,
        location: loc,
      });
    }

    // Solid pins — prominent green dots with crisp white stroke.
    // Larger than before (glow/labels removed) so they're easy to
    // hover and click. Tooltip provides all detail on interaction.
    const pins = new ScatterplotLayer({
      id: "diary-pins",
      data: pinData,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      getPosition: (d: DiaryPinData) => d.position,
      getRadius: 8,
      radiusMinPixels: 6,
      radiusMaxPixels: 14,
      radiusUnits: "pixels" as const,
      getFillColor: [0, 224, 84, 230],
      getLineColor: [255, 255, 255, 220],
      lineWidthMinPixels: 2,
    });

    return [pins];
  }

  // Tooltip styling is handled by the `.deck-tooltip` CSS class in style.css.
  // deck.gl applies this class automatically to tooltip elements.

  // --- Deck instance ---
  // Allow pan and zoom but constrain to NYC area so the map can't be dragged off-screen.
  // Rotation stays locked to preserve the isometric/top-down camera angles.
  const NYC_BOUNDS = {
    minLng: -74.35,
    maxLng: -73.65,
    minLat: 40.45,
    maxLat: 40.95,
    minZoom: 9,
    maxZoom: 16,
  };

  const boundedController = {
    scrollZoom: true,
    dragPan: true,
    dragRotate: true,
    doubleClickZoom: true,
    touchZoom: true,
    touchRotate: true,
    keyboard: false, // arrow keys used for timeline slider
  };

  /** Clamp a view state to NYC bounds so the map can't be dragged away. */
  function clampViewState<T extends MapViewState>(viewState: T): T {
    return {
      ...viewState,
      longitude: Math.max(NYC_BOUNDS.minLng, Math.min(NYC_BOUNDS.maxLng, viewState.longitude)),
      latitude: Math.max(NYC_BOUNDS.minLat, Math.min(NYC_BOUNDS.maxLat, viewState.latitude)),
      zoom: Math.max(NYC_BOUNDS.minZoom, Math.min(NYC_BOUNDS.maxZoom, viewState.zoom)),
      pitch: Math.max(0, Math.min(75, viewState.pitch ?? 0)),
    };
  }

  // Choose initial camera based on restored viz/grain mode.
  // Circles and block heatmap look best top-down; bars use isometric pitch.
  const needsFlatView = currentVizMode !== "bars" || currentGrain !== "area";
  const restoredViewState = needsFlatView ? FLAT_VIEW_STATE : INITIAL_VIEW_STATE;

  // If categories were restored from hash, update pill active states.
  // Use a non-narrowing check so TS doesn't infer `never` inside the callback.
  if (activeCategories !== null && activeCategories.size > 0) {
    const restoredCats = activeCategories;
    typeInner.querySelectorAll(".cat-pill").forEach((el) => {
      const pillText = el.textContent ?? "";
      if (pillText === "All") {
        el.classList.toggle("cat-active", false);
      } else {
        el.classList.toggle("cat-active", restoredCats.has(pillText));
      }
    });
    updateTypeLabel();
  }

  // --- Post-processing effects pipeline ---
  const effectsSystem = createEffectsSystem();
  // Apply initial decade grading if restored from URL hash
  effectsSystem.setDecadeGrade(currentDecade);

  const deck = new Deck({
    parent: document.querySelector<HTMLDivElement>("#app")!,
    initialViewState: heroSeen ? restoredViewState : HERO_VIEW_STATE,
    controller: boundedController,
    effects: effectsSystem.effects,
    onViewStateChange: <T extends MapViewState>({ viewState }: { viewState: T }) => {
      return clampViewState(viewState);
    },
    layers: buildVisualizationLayers(currentMonth, currentUnit, computeFilteredCounts(currentUnit, activeCategories)),
    getTooltip: ({ object }: { object?: AreaFeature | CircleDataPoint | CuratedLocation | DiaryPinData }) => {
      // No tooltip in block heatmap mode
      if (currentGrain === "block") return null;
      if (!object) return null;

      // Diary pin tooltip — location name + film titles below
      if ("filmLabel" in object) {
        const d = object as DiaryPinData;
        const matches = diaryByLocation.get(d.locationId) ?? [];
        const filmLines = matches.map((m) => {
          const stars = m.rating !== null ? ` ${renderStars(m.rating)}` : "";
          return `<span style="color:#00e054">${escapeHtml(m.filmTitle)}${stars}</span>`;
        }).join("<br/>");
        return {
          html: `<strong>${escapeHtml(d.name)}</strong><br/>${filmLines}`,
        };
      }

      // Location pin tooltip
      if ("locationId" in object) {
        const loc = object as CuratedLocation;
        const filmCount = loc.films.length;
        const filmWord = filmCount === 1 ? "film" : "films";
        return {
          html: `<strong>${escapeHtml(loc.name)}</strong><br/><span class="tooltip-count">${filmCount}</span> ${filmWord}`,
        };
      }

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
        html: `<strong>${label}</strong><br/><span class="tooltip-count">${count}</span> shoots &middot; ${formatMonth(currentMonth)}`,
      };
    },
    onClick: ({ object }: { object?: AreaFeature | CircleDataPoint | CuratedLocation | DiaryPinData }) => {
      // No detail panel in block heatmap mode
      if (currentGrain === "block") return;
      if (!object) {
        if (detailOpen) closeDetail();
        return;
      }

      // Diary pin click — open location detail for the underlying location
      if ("filmLabel" in object) {
        const d = object as DiaryPinData;
        openLocationDetail(d.location);
        return;
      }

      // Location pin click — open location detail
      if ("locationId" in object) {
        openLocationDetail(object as CuratedLocation);
        return;
      }

      let countsKey: string;
      let label: string;
      let formalLabel: string;
      let centroid: [number, number];

      if ("position" in object && "countsKey" in object) {
        const d = object as CircleDataPoint;
        countsKey = d.countsKey;
        label = d.label;
        formalLabel = d.formalLabel;
        centroid = d.position;
      } else {
        const resolved = resolveFeature(object as AreaFeature, currentUnit);
        if (!resolved) return;
        countsKey = resolved.countsKey;
        label = resolved.label;
        formalLabel = resolved.formalLabel;
        const feat = object as AreaFeature;
        centroid = computeCentroid(feat.geometry as Polygon | MultiPolygon);
      }

      openDetail(countsKey, label, formalLabel, centroid);
    },
    style: { background: "transparent" },
  });

  // (timeline notches already built above)

  // Set initial hash so the URL always reflects the current state,
  // even on a fresh visit with no hash params.
  updateHash();

  // --- Stagger UI elements in after hero dismisses ---
  function revealUI(): void {
    const elements = [titleOverlay, captionEl, legend, timeline, toolbar, attribution, controlHint];
    elements.forEach((el, i) => {
      el.classList.add("ui-fade-in");
      el.style.animationDelay = `${200 + i * 80}ms`;
    });
    // Auto-hide control hint after 5 seconds
    setTimeout(() => controlHint.classList.add("control-hint-hidden"), 5000);
  }

  // --- Hero dismiss (cinematic pull-back) ---
  function dismissHero(): void {
    if (heroDismissed) return;
    heroDismissed = true;
    try { sessionStorage.setItem("heroShown", "1"); } catch { /* sandboxed */ }
    hero.classList.add("hero-fade");
    // Cinematic pull-back to overview — use the restored view state so
    // permalink-specified viz/grain modes get the correct camera angle.
    deck.setProps({
      initialViewState: {
        ...restoredViewState,
        transitionDuration: 2000,
      },
    });
    // Stagger in UI elements
    revealUI();
    setTimeout(() => hero.remove(), 1200);
  }

  if (heroSeen) {
    // Hero was already shown in a previous session — reveal UI immediately
    revealUI();
  } else {
    // If user already skipped (before deck was ready), trigger pull-back now
    if (heroDismissed) {
      deck.setProps({
        initialViewState: {
          ...restoredViewState,
          transitionDuration: 2000,
        },
      });
      revealUI();
    } else {
      // Allow skip handler to trigger the pull-back
      onHeroSkip = dismissHero;
      // Auto-dismiss hero after 2s (map is already loaded at this point)
      setTimeout(dismissHero, 2000);
    }
  }

  let detailAreaFormalLabel: string | null = null;

  function openDetail(countsKey: string, label: string, formalLabel: string, _centroid: [number, number]): void {
    // Track whether this is a refresh (panel already open) vs first open.
    // When refreshing, suppress the entrance animation to avoid flickering.
    const isRefresh = detailOpen && detailPanel.classList.contains("open");

    detailAreaKey = countsKey;
    detailAreaLabel = label;
    detailAreaFormalLabel = formalLabel;
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

    // Build "Notable films" section if locations data has films matching this area
    let notableFilmsHtml = "";
    if (locationsData && showLocations) {
      const areaKey = currentUnit === "cd" ? "cdKey" : "zipKey";
      const matchingLocations = locationsData.locations.filter(
        (loc) => loc[areaKey] === countsKey,
      );
      // Flatten films across matched locations
      const areaFilms: Array<{ title: string; year: number | null; locationName: string }> = [];
      for (const loc of matchingLocations) {
        const films = currentDecade !== null
          ? loc.films.filter((f) => f.year !== null && Math.floor(f.year / 10) * 10 === currentDecade)
          : loc.films;
        for (const f of films) {
          areaFilms.push({ title: f.title, year: f.year, locationName: loc.name });
        }
      }
      if (areaFilms.length > 0) {
        const MAX_DISPLAY = 10;
        const displayed = areaFilms.slice(0, MAX_DISPLAY);
        const remaining = areaFilms.length - displayed.length;
        const filmListHtml = displayed.map((f) => {
          // Check if this film was watched (diary match)
          const normKey = `${f.title.toLowerCase().trim()}::${f.year ?? "?"}`;
          const diaryMatch = diaryByTitle.get(normKey);
          const watchedBadge = diaryMatch
            ? `<span class="diary-inline-badge">Watched${diaryMatch.rating !== null ? ` ${renderStars(diaryMatch.rating)}` : ""}</span>`
            : "";
          return `<li class="notable-film-item">${escapeHtml(f.title)} (${f.year ?? "?"})${watchedBadge} <span class="notable-film-location">@ ${escapeHtml(f.locationName)}</span></li>`;
        }).join("");
        const moreHtml = remaining > 0
          ? `<li class="notable-film-more">and ${remaining} more</li>` : "";
        notableFilmsHtml = `
          <div class="detail-section">
            <h3>Notable films</h3>
            <ul class="notable-films-list">${filmListHtml}${moreHtml}</ul>
          </div>`;
      }
    }

    const formalSubtitle = formalLabel !== label
      ? `<span class="detail-formal-label">${escapeHtml(formalLabel)}</span>` : "";

    detailPanel.innerHTML = `
      <button type="button" id="detail-close" aria-label="Close detail panel">\u2715</button>
      <h2>${escapeHtml(label)}</h2>
      ${formalSubtitle}
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
      ${notableFilmsHtml}
    `;

    if (isRefresh) {
      // Suppress child entrance animation during month-change refresh
      detailPanel.classList.add("no-animate");
    } else {
      detailPanel.classList.remove("no-animate");
    }

    detailPanel.classList.add("open");
    openPanelSpring();

    // Close button handler
    detailPanel.querySelector("#detail-close")?.addEventListener("click", closeDetail);
  }

  function closeDetail(): void {
    if (!detailOpen) return;
    detailOpen = false;
    detailAreaKey = null;
    detailAreaLabel = null;
    detailAreaFormalLabel = null;
    // Spring animates the panel out; the animation callback removes
    // the "open" class once the spring settles at 100%.
    closePanelSpring();
  }

  /** Open detail panel for a curated filming location pin. */
  function openLocationDetail(location: CuratedLocation): void {
    detailOpen = true;
    detailAreaKey = null;
    detailAreaLabel = null;

    // Filter films by active decade if set
    const films = currentDecade !== null
      ? location.films.filter((f) => f.year !== null && Math.floor(f.year / 10) * 10 === currentDecade)
      : location.films;

    // Build film list HTML — escape all user-controlled strings from Wikidata
    const filmListHtml = films.map((f) => {
      const safeTitle = escapeHtml(f.title);
      const typeBadge = f.type === "tv"
        ? `<span class="detail-film-badge badge-tv">TV</span>`
        : `<span class="detail-film-badge badge-film">Film</span>`;
      const directorHtml = f.director
        ? `<span class="detail-film-meta">Dir: ${escapeHtml(f.director)}</span>` : "";
      const genreHtml = f.genres && f.genres.length > 0
        ? `<span class="detail-film-meta">${f.genres.map(escapeHtml).slice(0, 3).join(", ")}</span>` : "";
      const imdbHtml = f.imdbId
        ? `<a class="detail-film-imdb" href="https://www.imdb.com/title/${encodeURIComponent(f.imdbId)}/" target="_blank" rel="noopener">IMDb</a>` : "";
      const posterHtml = f.imageUrl
        ? `<img class="detail-film-poster" src="${escapeHtml(f.imageUrl)}" alt="${safeTitle}" loading="lazy" onerror="this.style.display='none'" />` : "";

      return `
        <div class="detail-film-entry">
          <div class="detail-film-header">
            <span class="detail-film-title">${safeTitle}</span>
            <span class="detail-film-year">${f.year ?? "?"}</span>
            ${typeBadge}
          </div>
          <div class="detail-film-body">
            ${posterHtml}
            <div class="detail-film-info">
              ${directorHtml}
              ${genreHtml}
              ${imdbHtml}
            </div>
          </div>
        </div>`;
    }).join("");

    // Build diary "You watched this" section if this location has matches
    let diaryHtml = "";
    const locDiaryMatches = diaryByLocation.get(location.locationId);
    if (locDiaryMatches && locDiaryMatches.length > 0) {
      const entriesHtml = locDiaryMatches.map((m) => {
        const starsHtml = m.rating !== null
          ? `<span class="diary-stars">${renderStars(m.rating)}</span>` : "";
        const dateHtml = m.watchedDate
          ? `<span class="diary-date">${formatDate(m.watchedDate)}</span>` : "";
        const titleHtml = locDiaryMatches.length > 1
          ? `<span class="diary-film-title">${escapeHtml(m.filmTitle)}</span>` : "";
        return `
          <div class="diary-match-entry">
            ${titleHtml}
            ${starsHtml}
            ${dateHtml}
            <a class="diary-link" href="${escapeHtml(m.letterboxdUrl)}" target="_blank" rel="noopener">Letterboxd \u2192</a>
          </div>`;
      }).join("");

      diaryHtml = `
        <div class="diary-match-section">
          <div class="diary-match-header">
            <span class="diary-badge">You watched this</span>
          </div>
          ${entriesHtml}
        </div>`;
    }

    detailPanel.innerHTML = `
      <button type="button" id="detail-close" aria-label="Close detail panel">\u2715</button>
      <h2>${escapeHtml(location.name)}</h2>
      ${diaryHtml}
      <div class="detail-stat">
        <span class="detail-big">${films.length}</span>
        <span class="detail-label">${films.length === 1 ? "film" : "films"} shot here${currentDecade !== null ? ` (${currentDecade}s)` : ""}</span>
      </div>
      <div class="detail-section">
        <h3>Films</h3>
        <div class="detail-films-list">
          ${filmListHtml || '<span class="detail-film-meta">No films match the current decade filter.</span>'}
        </div>
      </div>
    `;

    detailPanel.classList.remove("no-animate");
    detailPanel.classList.add("open");
    openPanelSpring();
    detailPanel.querySelector("#detail-close")?.addEventListener("click", closeDetail);
  }


  // --- Update layers ---
  function updateLayers(): void {
    updateActiveNotch();

    // Diary mode: dim base boundary + diary glow/pins/labels only
    if (diaryMode) {
      captionEl.style.opacity = "0";
      // Dimmer base for diary — let the green pins be the visual focus
      const dimBase = new GeoJsonLayer({
        id: "base-boundary",
        data: currentUnit === "cd" ? cdBoundaries : zipBoundaries,
        extruded: false,
        pickable: false,
        stroked: true,
        filled: true,
        getFillColor: [8, 8, 16, 160],
        getLineColor: [255, 255, 255, 15],
        lineWidthMinPixels: 0.5,
      });
      const diaryLayers = buildDiaryLayers();
      deck.setProps({ layers: [dimBase, ...diaryLayers] });
      return;
    }

    if (currentGrain === "block") {
      // In block mode, hide captions and just render the heatmap
      captionEl.style.opacity = "0";
      const heatmap = buildHeatmapLayer(currentMonth);
      const base = buildBaseLayer(currentUnit);
      const blockLayers: (GeoJsonLayer | ScatterplotLayer | HeatmapLayer<HeatmapDataPoint>)[] =
        heatmap ? [base, heatmap] : [base];
      if (showLocations && locationsData) {
        blockLayers.push(buildLocationsLayer(locationsData.locations, currentDecade));
      }
      deck.setProps({ layers: blockLayers });
      debouncedUpdateHash();
      return;
    }

    // Area mode — compute filtered counts once and reuse across layer builders and legend
    const countsMap = computeFilteredCounts(currentUnit, activeCategories);
    const maxCount = computeMaxCount(countsMap, currentMonth);
    legendMax.textContent = String(maxCount);
    if (captions) {
      const captionMap = currentUnit === "cd" ? captions.cd : captions.zip;
      const text = activeCategories === null ? (captionMap[currentMonth] ?? "") : "";
      captionEl.textContent = text;
      captionEl.style.opacity = text ? "1" : "0";
    }
    // Refresh detail panel if open — full re-render so sparkline, rank,
    // and top months all stay in sync with the current month.
    if (detailOpen && detailAreaKey && detailAreaLabel && detailAreaFormalLabel) {
      openDetail(detailAreaKey, detailAreaLabel, detailAreaFormalLabel, [0, 0]);
    }

    const layers: (GeoJsonLayer | ScatterplotLayer)[] = buildVisualizationLayers(currentMonth, currentUnit, countsMap);
    if (showLocations && locationsData) {
      layers.push(buildLocationsLayer(locationsData.locations, currentDecade));
    }
    deck.setProps({ layers });

    debouncedUpdateHash();
  }

  // --- Unit toggle ---
  unitToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    currentUnit = currentUnit === "cd" ? "zip" : "cd";
    unitToggle.textContent = currentUnit === "cd" ? "CD" : "ZIP";
    // Close detail panel — area keys are unit-specific and won't match after switch
    if (detailOpen) closeDetail();
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

  // --- Locations toggle (in toolbar landmarks row) ---
  if (landmarksToggle && landmarksExpandable) {
    landmarksToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      showLocations = !showLocations;
      landmarksToggle!.classList.toggle("toggle-active", showLocations);
      landmarksToggle!.textContent = showLocations ? "On" : "Off";
      landmarksToggle!.setAttribute("aria-pressed", String(showLocations));
      landmarksToggle!.setAttribute("aria-expanded", String(showLocations));
      landmarksExpandable!.classList.toggle("expanded", showLocations);
      if (!showLocations) {
        currentDecade = null;
        effectsSystem.setDecadeGrade(null);
        updateDecadePillStates();
      }
      updateLayers();
    });
  }

  // --- Diary mode toggle ---
  /** Show/hide UI elements when entering or exiting diary mode. */
  function setDiaryModeUI(active: boolean): void {
    // Elements to hide in diary mode
    const hideEls = [timeline, legend, unitRow, vizRow, typeRow, typeExpandable];
    if (landmarksRow) hideEls.push(landmarksRow);
    if (landmarksExpandable) hideEls.push(landmarksExpandable);

    for (const el of hideEls) {
      (el as HTMLElement).classList.toggle("diary-hidden", active);
    }

    captionEl.classList.toggle("diary-hidden", active);
    diaryStatsCard.classList.toggle("diary-active", active);
  }

  if (diaryToggle) {
    diaryToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      diaryMode = !diaryMode;
      diaryToggle!.textContent = diaryMode ? "On" : "Off";
      diaryToggle!.classList.toggle("toggle-active-diary", diaryMode);
      diaryToggle!.setAttribute("aria-pressed", String(diaryMode));

      // Close any open detail panel when toggling
      if (detailOpen) closeDetail();

      setDiaryModeUI(diaryMode);

      // Camera: diary mode = flat top-down (zoomed to Manhattan where most pins are),
      // exit = restore based on current viz mode
      const diaryView = { ...FLAT_VIEW_STATE, zoom: 11.5, latitude: 40.755 };
      const targetView = diaryMode
        ? diaryView
        : currentVizMode === "bars" ? INITIAL_VIEW_STATE : FLAT_VIEW_STATE;
      deck.setProps({
        initialViewState: {
          ...targetView,
          transitionDuration: 1000,
        },
      });

      updateLayers();
    });
  }

  // --- Diary stats card: click a film row to fly-to its first location ---
  if (hasDiaryData && locationsData && diaryData) {
    diaryStatsCard.addEventListener("click", (e) => {
      const filmEl = (e.target as HTMLElement).closest(".diary-stats-film");
      if (!filmEl) return;
      const title = filmEl.getAttribute("data-film-title");
      if (!title) return;
      const match = diaryData!.matches.find((m) => m.filmTitle === title);
      if (!match || match.locationIds.length === 0) return;
      // Find the first location with coordinates
      const loc = locationsData!.locations.find((l) => match.locationIds.includes(l.locationId));
      if (!loc) return;
      // Fly camera to this location
      deck.setProps({
        initialViewState: {
          ...FLAT_VIEW_STATE,
          longitude: loc.lng,
          latitude: loc.lat,
          zoom: 14,
          transitionDuration: 1200,
        },
      });
      // Open the location detail panel
      openLocationDetail(loc);
    });
  }

  // --- Slider arrow-key handler (scoped to timeline track for proper ARIA) ---
  function handleSliderArrow(e: KeyboardEvent): void {
    if (e.key === "ArrowLeft") {
      if (currentMonthIdx > 0) {
        currentMonthIdx--;
        currentMonth = months[currentMonthIdx];
        updateLayers();
      }
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      if (currentMonthIdx < months.length - 1) {
        currentMonthIdx++;
        currentMonth = months[currentMonthIdx];
        updateLayers();
      }
      e.preventDefault();
    }
  }
  // Primary: scoped to the slider element for correct ARIA role="slider" semantics
  timelineTrack.addEventListener("keydown", handleSliderArrow);

  // --- Drag-to-scrub with magnetic snapping ---
  // Adds continuous drag interaction (mouse + touch) on the timeline track.
  // While dragging, the scrubber gently snaps toward peak-activity months —
  // months in the top 30% of total shoots — creating a tactile "gravity well"
  // that guides exploration toward interesting dates.

  let isScrubbing = false;

  /** Apply gravitational pull toward nearby peak months.
   *  Returns a fractional index biased toward peaks within ±2 months. */
  function applyMagneticPull(rawIndex: number, totals: number[]): number {
    const maxTotal = Math.max(...totals);
    if (maxTotal === 0) return rawIndex;

    let pull = 0;
    const pullRange = 2;     // months of gravitational influence
    const pullStrength = 0.3; // max pull per peak (0–1)
    const threshold = 0.7;    // only snap to top 30% months

    for (let i = 0; i < totals.length; i++) {
      const dist = Math.abs(rawIndex - i);
      if (dist > 0 && dist <= pullRange) {
        const prominence = totals[i] / maxTotal;
        if (prominence >= threshold) {
          const force = pullStrength * prominence * (1 - dist / pullRange);
          pull += (i - rawIndex) * force;
        }
      }
    }
    return rawIndex + pull;
  }

  function scrubToPosition(clientX: number): void {
    const rect = timelineTrack.getBoundingClientRect();
    const rawRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawIndex = rawRatio * (months.length - 1);

    const totals = computeMonthTotals();
    const snapped = Math.round(applyMagneticPull(rawIndex, totals));
    const clampedIdx = Math.max(0, Math.min(months.length - 1, snapped));

    if (clampedIdx !== currentMonthIdx) {
      currentMonthIdx = clampedIdx;
      currentMonth = months[currentMonthIdx];
      updateLayers();
    }
  }

  timelineTrack.addEventListener("mousedown", (e) => {
    isScrubbing = true;
    scrubToPosition(e.clientX);
    e.preventDefault(); // prevent text selection during drag
  });

  window.addEventListener("mousemove", (e) => {
    if (!isScrubbing) return;
    scrubToPosition(e.clientX);
  });

  window.addEventListener("mouseup", () => {
    isScrubbing = false;
  });

  // Touch support for mobile scrubbing
  timelineTrack.addEventListener("touchstart", (e) => {
    isScrubbing = true;
    if (e.touches.length > 0) scrubToPosition(e.touches[0].clientX);
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!isScrubbing) return;
    if (e.touches.length > 0) scrubToPosition(e.touches[0].clientX);
  }, { passive: true });

  window.addEventListener("touchend", () => {
    isScrubbing = false;
  });

  // --- Global keyboard shortcuts ---
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      closeDetail();
      return;
    }
    // Convenience: global arrow keys when no input is focused
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (document.activeElement === timelineTrack) return; // already handled above
      handleSliderArrow(e);
    }
  });
}

// --- Hero intro setup (runs synchronously before main) ---

// Wrap sessionStorage access in try-catch for restricted environments (sandboxed iframes)
let heroSeen = false;
try { heroSeen = sessionStorage.getItem("heroShown") === "1"; } catch { /* sandboxed */ }
let heroDismissed = heroSeen;

// Callback set by main() once the deck is ready, so early skips can trigger the pull-back.
let onHeroSkip: (() => void) | null = null;

const hero = document.createElement("div");
hero.id = "hero";

if (!heroSeen) {
  hero.innerHTML = `
    <h1 class="hero-title">On Location</h1>
    <span class="hero-accent"></span>
    <p class="hero-subtitle">New York City&#x27;s filming landscape, mapped</p>
    <p class="hero-loading">Loading</p>
  `;
  document.body.appendChild(hero);

  // Skip hero on click or keypress
  function skipHero(): void {
    if (heroDismissed) return;
    heroDismissed = true;
    try { sessionStorage.setItem("heroShown", "1"); } catch { /* sandboxed */ }
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

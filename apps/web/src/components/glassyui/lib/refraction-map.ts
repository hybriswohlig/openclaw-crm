import { SLAB_AIR_GAP, SLAB_MAX_SLOPE, SLAB_MIN_RISE, SLAB_RISE_SPAN } from './slab-optics';

export type GeneratedRefractionStrength = 'soft' | 'strong';

type RefractionPreset = {
  centerNeutralRatio: number;
  defaultDisplacement: number;
  edgeBandRatio: number;
  edgeWidth: number;
  /** Rim pull at the default displacement, as a share of the edge band. */
  rimPull: number;
};

export type RefractionMapOptions = {
  devicePixelRatio?: number;
  displacement?: number;
  height: number;
  radius: number;
  strength: GeneratedRefractionStrength;
  thickness?: number;
  width: number;
};

export type RefractionMapMetrics = {
  cacheKey: string;
  dispersion: number;
  edgeBand: number;
  /** Corner radius of the bend field, never tighter than the edge band. */
  fieldRadius: number;
  filterBlur: number;
  filterPadding: number;
  filterScale: number;
  height: number;
  mapHeight: number;
  mapPixels: number;
  mapWidth: number;
  paddedHeight: number;
  paddedWidth: number;
  /** Inward offset at the rim, in CSS pixels. */
  pull: number;
  radius: number;
  width: number;
};

export type RefractionMapBuildResult = {
  href: string;
  metrics: RefractionMapMetrics;
};

export const MAX_REFRACTION_MAP_PIXELS = 160000;

const REFRACTION_PRESETS: Record<GeneratedRefractionStrength, RefractionPreset> = {
  soft: {
    centerNeutralRatio: 0.68,
    defaultDisplacement: 72,
    edgeBandRatio: 0.18,
    edgeWidth: 1.08,
    rimPull: 0.22,
  },
  strong: {
    centerNeutralRatio: 0.58,
    defaultDisplacement: 112,
    edgeBandRatio: 0.2,
    edgeWidth: 1.22,
    rimPull: 0.34,
  },
};

/**
 * Scene blur under the rim, in CSS pixels. Chromium and Firefox sample the bend
 * nearest-neighbour, so the magnified rim would stair-step at 1x pixel density. The
 * map's blue channel keeps the blur off the flat centre.
 */
const RIM_BLUR = 0.8;

/**
 * The bend falls off as (1 - t)^2 across the edge band, steepest at the rim. Any pull
 * under half the band keeps each sample further in than its outer neighbour, so the rim
 * compresses the view like thick glass and never mirrors it. The base pull is 0.34;
 * even the furthest colour stays below 0.4 to leave room for the map's 8-bit rounding.
 */
const MAX_RIM_PULL = 0.34;

const MAX_CHROMATIC_RIM_PULL = 0.4;

const refractionMapCache = new Map<string, string>();

const maxCachedRefractionMaps = 48;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1);

  return t * t * (3 - 2 * t);
}

type Edge = { distance: number; normalX: number; normalY: number };

// Distance to a rounded rectangle plus its outward unit normal.
function roundedRectEdge(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  edge: Edge,
) {
  const px = x - width / 2;
  const py = y - height / 2;
  const qx = Math.abs(px) - (width / 2 - radius);
  const qy = Math.abs(py) - (height / 2 - radius);
  const signX = px < 0 ? -1 : 1;
  const signY = py < 0 ? -1 : 1;

  if (qx > 0 && qy > 0) {
    const length = Math.hypot(qx, qy);

    edge.distance = length - radius;
    edge.normalX = (signX * qx) / length;
    edge.normalY = (signY * qy) / length;
  } else if (qx > qy) {
    edge.distance = qx - radius;
    edge.normalX = signX;
    edge.normalY = 0;
  } else {
    edge.distance = qy - radius;
    edge.normalX = 0;
    edge.normalY = signY;
  }

  return edge;
}

function fitMapSize(width: number, height: number, pixelRatio: number) {
  let mapWidth = clamp(Math.round(width * pixelRatio), 32, 1800);
  let mapHeight = clamp(Math.round(height * pixelRatio), 32, 1200);

  const pixels = mapWidth * mapHeight;

  if (pixels <= MAX_REFRACTION_MAP_PIXELS) {
    return { mapWidth, mapHeight };
  }

  const ratio = Math.sqrt(MAX_REFRACTION_MAP_PIXELS / pixels);
  mapWidth = Math.max(32, Math.floor(mapWidth * ratio));
  mapHeight = Math.max(32, Math.floor(mapHeight * ratio));

  while (mapWidth * mapHeight > MAX_REFRACTION_MAP_PIXELS) {
    if (mapWidth >= mapHeight) {
      mapWidth -= 1;
    } else {
      mapHeight -= 1;
    }
  }

  return { mapWidth, mapHeight };
}

export function computeRefractionMapMetrics(options: RefractionMapOptions): RefractionMapMetrics {
  const preset = REFRACTION_PRESETS[options.strength];
  const width = Math.max(0, options.width);
  const height = Math.max(0, options.height);
  const minDimension = Math.min(width, height);
  const radius = clamp(options.radius, 0, minDimension / 2);
  const displacement = clamp(options.displacement ?? preset.defaultDisplacement, 0, 196);
  const thickness = clamp(options.thickness ?? 1, 0.1, 4);
  const rimWidth = 0.6 + 0.4 * thickness;
  const dispersion = clamp((thickness - 1) * 0.2, 0, 0.6);
  const blueFactor = 1 + dispersion / 2;
  const neutralInset = (minDimension * (1 - preset.centerNeutralRatio)) / 2;

  const edgeBand = clamp(
    Math.min(minDimension * preset.edgeBandRatio, neutralInset) * preset.edgeWidth * rimWidth,
    6,
    Math.min(72 * rimWidth, (radius || 56) * 1.15 * rimWidth, minDimension * 0.48),
  );

  // Inside a tighter corner the inset contours would turn sharp and pinch the bend.
  const fieldRadius = clamp(Math.max(radius, edgeBand), 0, minDimension / 2);

  const pull =
    edgeBand *
    Math.min(
      MAX_RIM_PULL,
      MAX_CHROMATIC_RIM_PULL / blueFactor,
      (preset.rimPull * displacement) / preset.defaultDisplacement,
    );

  // WebKit shifts a clipped, filtered scene unless the filter region reaches past the
  // box as far as the primitives read: the blue pull plus three blur deviations.
  const filterPadding = Math.ceil(pull * blueFactor + RIM_BLUR * 3) + 2;
  const paddedWidth = width + filterPadding * 2;
  const paddedHeight = height + filterPadding * 2;
  const targetRatio = clamp((options.devicePixelRatio ?? 1) * 1.12, 1.15, 2.1);
  const targetPixels = paddedWidth * paddedHeight * targetRatio * targetRatio;

  const pixelRatio =
    targetPixels > MAX_REFRACTION_MAP_PIXELS
      ? Math.max(1, targetRatio * Math.sqrt(MAX_REFRACTION_MAP_PIXELS / targetPixels))
      : targetRatio;

  const { mapWidth, mapHeight } = fitMapSize(paddedWidth, paddedHeight, pixelRatio);

  const cacheKey = [
    mapWidth,
    mapHeight,
    Math.round(width),
    Math.round(height),
    Math.round(fieldRadius * 10),
    Math.round(edgeBand * 10),
    filterPadding,
  ].join(':');

  return {
    cacheKey,
    dispersion,
    edgeBand,
    fieldRadius,
    filterBlur: RIM_BLUR,
    filterPadding,
    // Map channels hold a unit offset; the scale turns it into CSS pixels.
    filterScale: Math.round(pull * 2 * 100) / 100,
    height,
    mapHeight,
    mapPixels: mapWidth * mapHeight,
    mapWidth,
    paddedHeight,
    paddedWidth,
    pull,
    radius,
    width,
  };
}

/**
 * Encodes a unit rim field: R/G = 0.5 + 0.5 * inward offset. Past the field's edge the
 * rim offset carries on unchanged, so the map stays smooth across the clipped border.
 * B is the share of softened scene: full through the outer half of the band, which
 * holds every point the steep rim samples, and gone by the flat centre.
 */
export async function buildRefractionMapDataUrl(
  options: RefractionMapOptions,
): Promise<RefractionMapBuildResult> {
  const metrics = computeRefractionMapMetrics(options);
  const cached = refractionMapCache.get(metrics.cacheKey);

  if (cached) return { href: cached, metrics };

  if (typeof document === 'undefined') {
    throw new Error('Refraction maps require a browser document');
  }

  const canvas = document.createElement('canvas');
  canvas.width = metrics.mapWidth;
  canvas.height = metrics.mapHeight;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const {
    edgeBand,
    fieldRadius,
    filterPadding,
    height,
    mapHeight,
    mapWidth,
    paddedHeight,
    paddedWidth,
    width,
  } = metrics;

  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const edge: Edge = { distance: 0, normalX: 0, normalY: 0 };

  for (let yIndex = 0; yIndex < mapHeight; yIndex += 1) {
    const y = ((yIndex + 0.5) / mapHeight) * paddedHeight - filterPadding;

    for (let xIndex = 0; xIndex < mapWidth; xIndex += 1) {
      const x = ((xIndex + 0.5) / mapWidth) * paddedWidth - filterPadding;
      const index = (yIndex * mapWidth + xIndex) * 4;
      roundedRectEdge(x, y, width, height, fieldRadius, edge);
      const depth = clamp(-edge.distance / edgeBand, 0, 1);
      const falloff = (1 - depth) ** 2;
      const offsetX = -edge.normalX * falloff;
      const offsetY = -edge.normalY * falloff;

      data[index] = Math.round((0.5 + offsetX / 2) * 255);
      data[index + 1] = Math.round((0.5 + offsetY / 2) * 255);
      data[index + 2] = Math.round((1 - smoothstep(0.5, 1, depth)) * 255);
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(new ImageData(data, mapWidth, mapHeight), 0, 0);
  const href = canvas.toDataURL('image/png');
  refractionMapCache.set(metrics.cacheKey, href);

  if (refractionMapCache.size > maxCachedRefractionMaps) {
    const oldestKey = refractionMapCache.keys().next().value;

    if (oldestKey) refractionMapCache.delete(oldestKey);
  }

  return { href, metrics };
}

/** Corner radii in CSS pixels, clockwise from the top left. */
export type LensRadii = readonly [number, number, number, number];

export type LensMapOptions = {
  /** Width of the curved rim in CSS pixels. */
  bevel: number;
  /** Multiplies how far the rim bends the backdrop. 0 leaves it flat. */
  depth: number;
  devicePixelRatio?: number;
  height: number;
  /** Refractive index of the glass. */
  ior: number;
  radii: LensRadii;
  /** Height of the slab in CSS pixels. Thicker glass bends further. */
  thickness: number;
  width: number;
};

export type LensMapMetrics = {
  bevel: number;
  cacheKey: string;
  height: number;
  mapHeight: number;
  mapWidth: number;
  /** The furthest the rim reads the backdrop from, in CSS pixels. */
  reach: number;
  width: number;
};

export type LensMapBuildResult = {
  href: string;
  metrics: LensMapMetrics;
};

const MAX_LENS_MAP_PIXELS = 420000;

export const MAX_LENS_SURFACE_AREA = 720000;

// The rim reads the backdrop from no further than this share of its width, and
// the point it reads from advances by at least a quarter of every pixel across
// the rim, so the view compresses toward the edge and never folds back on itself.
const LENS_REACH = 0.7;

const LENS_FOLD = 0.75;

const LENS_PROFILE_STEPS = 512;

// The rim and the flat top are the same frosted glass, but smoked glass lets more
// light through its rim. Blue holds the share of the rim's light: all of it near
// the edge, none past four fifths of the rim or a sixth of the surface, whichever
// comes first, so small pieces keep the top's shade in the middle.
const LENS_RIM_LIGHT = 0.8;

const LENS_RIM_LIGHT_SURFACE = 0.16;

const LENS_RIM_LIGHT_FALLOFF = 0.45;

const lensMapCache = new Map<string, LensMapBuildResult>();

const maxCachedLensMaps = 32;

// Native byte order keeps the neutral RGBA pixel identical on every platform.
const FLAT_LENS_PIXEL = new Uint32Array(new Uint8Array([128, 128, 0, 255]).buffer)[0];

/**
 * How far inward a view ray lands on the backdrop after it crosses a slab of glass
 * whose top curves down into a rim, s pixels in from the edge. The top follows
 * (1 - (1 - u)^4)^(1/4) across the rim, Snell's law bends the ray into the glass and
 * again out of its flat underside, and it crosses an air gap to the backdrop. This is
 * the WebGL scene's `through()`, for a ray straight down.
 */
function slabOffset(s: number, bevel: number, thickness: number, ior: number) {
  const u = s / bevel;
  const v = 1 - Math.max(u, 0.002);
  let rise = 1;
  let steepness = 0;

  if (u < 1) {
    const v4 = v ** 4;

    rise = (1 - v4) ** 0.25;
    steepness = v ** 3 * Math.max(1 - v4, 1e-6) ** -0.75;
  }

  const slope = Math.min(((SLAB_RISE_SPAN * thickness) / bevel) * steepness, SLAB_MAX_SLOPE);
  const height = thickness * (SLAB_MIN_RISE + SLAB_RISE_SPAN * rise);
  const tilt = Math.hypot(slope, 1);
  const sinTilt = slope / tilt;
  const cosTilt = 1 / tilt;
  const eta = 1 / ior;
  const root = Math.sqrt(Math.max(1 - eta * eta * sinTilt * sinTilt, 0));
  const bend = eta * cosTilt - root;
  const along = bend * sinTilt;
  const down = Math.max(eta - bend * cosTilt, 0.05);
  const sinOut = ior * Math.abs(along);
  const cosOut = Math.sqrt(Math.max(1 - sinOut * sinOut, 0));
  const leaving = (ior * along) / Math.max(sinOut, 1);

  return -(along * (height / down) + leaving * (SLAB_AIR_GAP / Math.max(cosOut, 0.1)));
}

/**
 * The inward offset across the rim, from the edge to its inner boundary. The physical
 * offset is softly capped, then limited so it never falls faster than the pixels it
 * crosses, which would fold the view back on itself.
 */
function lensProfile(bevel: number, thickness: number, ior: number, depth: number) {
  const cap = LENS_REACH * bevel;
  const step = bevel / LENS_PROFILE_STEPS;
  const offsets = new Float32Array(LENS_PROFILE_STEPS + 1);

  for (let index = 0; index < LENS_PROFILE_STEPS; index += 1) {
    offsets[index] =
      cap * Math.tanh((depth * slabOffset(index * step, bevel, thickness, ior)) / cap);
  }

  for (let index = LENS_PROFILE_STEPS - 1; index >= 0; index -= 1) {
    offsets[index] = Math.min(offsets[index], offsets[index + 1] + LENS_FOLD * step);
  }

  return { offsets, reach: Math.max(...offsets, 0.01) };
}

// Distance to a rounded rectangle with its own radius in every corner, plus its outward unit normal.
function roundedBoxEdge(
  x: number,
  y: number,
  width: number,
  height: number,
  radii: LensRadii,
  edge: Edge,
) {
  const px = x - width / 2;
  const py = y - height / 2;
  const radius = px < 0 ? (py < 0 ? radii[0] : radii[3]) : py < 0 ? radii[1] : radii[2];
  const qx = Math.abs(px) - (width / 2 - radius);
  const qy = Math.abs(py) - (height / 2 - radius);
  const signX = px < 0 ? -1 : 1;
  const signY = py < 0 ? -1 : 1;

  if (qx > 0 && qy > 0) {
    const length = Math.hypot(qx, qy);

    edge.distance = length - radius;
    edge.normalX = (signX * qx) / length;
    edge.normalY = (signY * qy) / length;
  } else if (qx > qy) {
    edge.distance = qx - radius;
    edge.normalX = signX;
    edge.normalY = 0;
  } else {
    edge.distance = qy - radius;
    edge.normalX = 0;
    edge.normalY = signY;
  }

  return edge;
}

function computeLensMapMetrics(options: LensMapOptions) {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const bevel = clamp(options.bevel, 1, Math.min(width, height) / 2);
  const pixelRatio = clamp(options.devicePixelRatio ?? 1, 1, 2);
  let mapWidth = clamp(Math.round(width * pixelRatio), 32, 1800);
  let mapHeight = clamp(Math.round(height * pixelRatio), 32, 1200);

  if (mapWidth * mapHeight > MAX_LENS_MAP_PIXELS) {
    const ratio = Math.sqrt(MAX_LENS_MAP_PIXELS / (mapWidth * mapHeight));

    mapWidth = Math.max(32, Math.floor(mapWidth * ratio));
    mapHeight = Math.max(32, Math.floor(mapHeight * ratio));
  }

  const cacheKey = [
    mapWidth,
    mapHeight,
    Math.round(width),
    Math.round(height),
    ...options.radii.map((radius) => Math.round(radius * 10)),
    Math.round(bevel * 10),
    Math.round(options.thickness * 10),
    Math.round(options.ior * 100),
    Math.round(options.depth * 100),
  ].join(':');

  return { bevel, cacheKey, height, mapHeight, mapWidth, width };
}

/**
 * Encodes the rim of a slab of glass as a displacement field: R/G = 0.5 + 0.5 * the
 * offset the backdrop is read from, as a share of `reach`. The SVG feDisplacementMap
 * scale of twice `reach` turns it back into CSS pixels. B is the share of the rim's
 * light, which smoked glass dims less than its top. The field is flat past the rim.
 */
export function buildLensMapDataUrl(options: LensMapOptions): LensMapBuildResult {
  const base = computeLensMapMetrics(options);
  const cached = lensMapCache.get(base.cacheKey);

  if (cached) {
    lensMapCache.delete(base.cacheKey);
    lensMapCache.set(base.cacheKey, cached);

    return cached;
  }

  if (typeof document === 'undefined') {
    throw new Error('Lens maps require a browser document');
  }

  const canvas = document.createElement('canvas');
  canvas.width = base.mapWidth;
  canvas.height = base.mapHeight;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const { bevel, height, mapHeight, mapWidth, width } = base;
  const { offsets, reach } = lensProfile(bevel, options.thickness, options.ior, options.depth);

  const litTo = Math.min(
    LENS_RIM_LIGHT,
    (LENS_RIM_LIGHT_SURFACE * Math.min(width, height)) / bevel,
  );

  const litFrom = litTo * LENS_RIM_LIGHT_FALLOFF;
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const pixels = new Uint32Array(data.buffer);
  const edge: Edge = { distance: 0, normalX: 0, normalY: 0 };
  // Beyond every corner and the bevel, the map is exactly neutral. Keep a full
  // texel inside that rectangle so fractional dimensions cannot round a rim in.
  const flatInset = Math.max(bevel, ...options.radii);
  const flatLeft = Math.min(mapWidth, Math.ceil((flatInset / width) * mapWidth + 0.5));
  const flatRight = Math.max(flatLeft, Math.floor(((width - flatInset) / width) * mapWidth - 0.5));
  const flatTop = Math.ceil((bevel / height) * mapHeight + 0.5);
  const flatBottom = Math.floor(((height - bevel) / height) * mapHeight - 0.5);

  for (let yIndex = 0; yIndex < mapHeight; yIndex += 1) {
    const y = ((yIndex + 0.5) / mapHeight) * height;
    const flatRow = yIndex >= flatTop && yIndex < flatBottom;

    for (let xIndex = 0; xIndex < mapWidth; xIndex += 1) {
      if (flatRow && xIndex === flatLeft && flatRight > flatLeft) {
        pixels.fill(FLAT_LENS_PIXEL, yIndex * mapWidth + flatLeft, yIndex * mapWidth + flatRight);
        xIndex = flatRight - 1;

        continue;
      }

      const x = ((xIndex + 0.5) / mapWidth) * width;
      const index = (yIndex * mapWidth + xIndex) * 4;
      roundedBoxEdge(x, y, width, height, options.radii, edge);
      const inset = Math.max(-edge.distance, 0);
      let offset = 0;

      if (inset < bevel) {
        const position = (inset / bevel) * LENS_PROFILE_STEPS;
        const lower = Math.floor(position);
        const fraction = position - lower;

        offset = offsets[lower] * (1 - fraction) + offsets[lower + 1] * fraction;
      }

      data[index] = Math.round(clamp(0.5 - (offset * edge.normalX) / (2 * reach), 0, 1) * 255);
      data[index + 1] = Math.round(clamp(0.5 - (offset * edge.normalY) / (2 * reach), 0, 1) * 255);
      data[index + 2] = Math.round((1 - smoothstep(litFrom, litTo, inset / bevel)) * 255);
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(new ImageData(data, mapWidth, mapHeight), 0, 0);

  const result = {
    href: canvas.toDataURL('image/png'),
    metrics: { ...base, reach },
  };

  lensMapCache.set(base.cacheKey, result);

  if (lensMapCache.size > maxCachedLensMaps) {
    const oldestKey = lensMapCache.keys().next().value;

    if (oldestKey) lensMapCache.delete(oldestKey);
  }

  return result;
}

export type MagnifierMapOptions = {
  devicePixelRatio?: number;
  size: number;
};

export type MagnifierMapMetrics = {
  /** Width of the ring that bends, in CSS pixels. */
  band: number;
  cacheKey: string;
  /** Outward offset at the rim, in CSS pixels. */
  depth: number;
  mapSize: number;
  size: number;
};

export type MagnifierMapBuildResult = {
  href: string;
  metrics: MagnifierMapMetrics;
};

const magnifierMapCache = new Map<string, string>();

const maxCachedMagnifierMaps = 8;

export function computeMagnifierMapMetrics(options: MagnifierMapOptions): MagnifierMapMetrics {
  const size = Math.max(1, options.size);
  const radius = size / 2;
  const mapSize = clamp(Math.round(size * clamp(options.devicePixelRatio ?? 1, 1, 2)), 32, 400);

  return {
    band: radius * 0.46,
    cacheKey: [mapSize, Math.round(size * 10)].join(':'),
    depth: radius * 0.5,
    mapSize,
    size,
  };
}

/**
 * Encodes an outward offset that grows toward the rim of a circle:
 * R/G = 0.5 + 0.5 * offset / depth. Each pixel samples a little further out than its
 * inner neighbour, so the view compresses into the rim like thick glass and never folds
 * back on itself, even over sharp text.
 */
export function buildMagnifierMapDataUrl(options: MagnifierMapOptions): MagnifierMapBuildResult {
  const metrics = computeMagnifierMapMetrics(options);
  const cached = magnifierMapCache.get(metrics.cacheKey);

  if (cached) return { href: cached, metrics };

  if (typeof document === 'undefined') {
    throw new Error('Magnifier maps require a browser document');
  }

  const canvas = document.createElement('canvas');
  canvas.width = metrics.mapSize;
  canvas.height = metrics.mapSize;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const { band, mapSize, size } = metrics;
  const radius = size / 2;
  const data = new Uint8ClampedArray(mapSize * mapSize * 4);

  for (let yIndex = 0; yIndex < mapSize; yIndex += 1) {
    const dy = ((yIndex + 0.5) / mapSize) * size - radius;

    for (let xIndex = 0; xIndex < mapSize; xIndex += 1) {
      const dx = ((xIndex + 0.5) / mapSize) * size - radius;
      const index = (yIndex * mapSize + xIndex) * 4;
      const distance = Math.hypot(dx, dy) || 1;
      // Flat in the centre, cubic through the ring so the bend starts without a crease.
      const rim = clamp((distance - (radius - band)) / band, 0, 1) ** 3;

      data[index] = Math.round((0.5 + (0.5 * rim * dx) / distance) * 255);
      data[index + 1] = Math.round((0.5 + (0.5 * rim * dy) / distance) * 255);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(new ImageData(data, mapSize, mapSize), 0, 0);
  const href = canvas.toDataURL('image/png');
  magnifierMapCache.set(metrics.cacheKey, href);

  if (magnifierMapCache.size > maxCachedMagnifierMaps) {
    const oldestKey = magnifierMapCache.keys().next().value;

    if (oldestKey) magnifierMapCache.delete(oldestKey);
  }

  return { href, metrics };
}

export type CapsuleLensMapOptions = {
  devicePixelRatio?: number;
  height: number;
  /** Multiple of regular glass: a thicker capsule bends further at its rim. */
  thickness?: number;
  width: number;
};

type CapsuleLensMapMetrics = {
  /** Width of the band inside the rim that bends, in CSS pixels. */
  band: number;
  cacheKey: string;
  /** Outward offset at the rim, in CSS pixels. */
  depth: number;
  height: number;
  mapHeight: number;
  mapWidth: number;
  width: number;
};

export type CapsuleLensMapBuildResult = {
  href: string;
  metrics: CapsuleLensMapMetrics;
};

// The lens itself shows its scene evenly, a little smaller; only a thin band at the rim bends.
const CAPSULE_BAND = 0.3;

const CAPSULE_DEPTH = 0.25;

const capsuleLensMapCache = new Map<string, string>();

const maxCachedCapsuleLensMaps = 8;

function computeCapsuleLensMapMetrics(options: CapsuleLensMapOptions): CapsuleLensMapMetrics {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const radius = Math.min(width, height) / 2;
  const thickness = clamp(options.thickness ?? 1, 0.1, 4);
  // The map is drawn at twice the device scale, so the bend stays smooth on a small knob.
  const scale = clamp(options.devicePixelRatio ?? 1, 1, 2) * 2;
  const mapWidth = clamp(Math.round(width * scale), 32, 400);
  const mapHeight = clamp(Math.round(height * scale), 32, 400);
  const band = radius * CAPSULE_BAND;
  const depth = radius * CAPSULE_DEPTH * thickness;

  return {
    band,
    cacheKey: [mapWidth, mapHeight, Math.round(width * 10), Math.round(height * 10)].join(':'),
    depth,
    height,
    mapHeight,
    mapWidth,
    width,
  };
}

/**
 * The rim's field for a capsule lens, such as a switch knob: R/G = 0.5 + 0.5 * the outward
 * offset as a share of `depth`, along the outward normal of the nearest rim. It is flat in
 * the middle and grows cubically through a thin band, so each pixel there samples a little
 * further out than its inner neighbour: the view compresses into the rim like thick glass
 * and never folds back on itself. The ends and the straight sides meet without a crease.
 * B rises through the band, so the filter softens only the scene the rim bends and the
 * middle stays sharp.
 */
export function buildCapsuleLensMapDataUrl(
  options: CapsuleLensMapOptions,
): CapsuleLensMapBuildResult {
  const metrics = computeCapsuleLensMapMetrics(options);
  const cached = capsuleLensMapCache.get(metrics.cacheKey);

  if (cached) return { href: cached, metrics };

  if (typeof document === 'undefined') {
    throw new Error('Lens maps require a browser document');
  }

  const canvas = document.createElement('canvas');
  canvas.width = metrics.mapWidth;
  canvas.height = metrics.mapHeight;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const { band, height, mapHeight, mapWidth, width } = metrics;
  const radius = Math.min(width, height) / 2;
  const radii: LensRadii = [radius, radius, radius, radius];
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const edge: Edge = { distance: 0, normalX: 0, normalY: 0 };

  for (let yIndex = 0; yIndex < mapHeight; yIndex += 1) {
    const y = ((yIndex + 0.5) / mapHeight) * height;

    for (let xIndex = 0; xIndex < mapWidth; xIndex += 1) {
      const x = ((xIndex + 0.5) / mapWidth) * width;
      const index = (yIndex * mapWidth + xIndex) * 4;
      roundedBoxEdge(x, y, width, height, radii, edge);
      const inBand = clamp((band + edge.distance) / band, 0, 1);
      const rim = inBand ** 3;

      data[index] = Math.round((0.5 + 0.5 * rim * edge.normalX) * 255);
      data[index + 1] = Math.round((0.5 + 0.5 * rim * edge.normalY) * 255);
      data[index + 2] = Math.round(inBand * 255);
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(new ImageData(data, mapWidth, mapHeight), 0, 0);
  const href = canvas.toDataURL('image/png');
  capsuleLensMapCache.set(metrics.cacheKey, href);

  if (capsuleLensMapCache.size > maxCachedCapsuleLensMaps) {
    const oldestKey = capsuleLensMapCache.keys().next().value;

    if (oldestKey) capsuleLensMapCache.delete(oldestKey);
  }

  return { href, metrics };
}

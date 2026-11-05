'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import {
  buildCapsuleLensMapDataUrl,
  buildLensMapDataUrl,
  buildMagnifierMapDataUrl,
  buildRefractionMapDataUrl,
  clamp,
  computeMagnifierMapMetrics,
  MAX_LENS_SURFACE_AREA,
  type CapsuleLensMapBuildResult,
  type GeneratedRefractionStrength,
  type LensMapMetrics,
  type LensRadii,
  type MagnifierMapBuildResult,
  type RefractionMapMetrics,
} from './refraction-map';

// Chromium's scroll-driven ViewTimeline is not in TypeScript's DOM lib yet.
interface LgViewTimeline extends AnimationTimeline {
  readonly source: Element | null;
  readonly startOffset: CSSNumericValue;
  readonly endOffset: CSSNumericValue;
}

declare const ViewTimeline: {
  new (options: { axis: 'block'; subject: Element }): LgViewTimeline;
};

type RefractionFilterOptions = {
  displacement?: number;
  enabled: boolean;
  reduceTransparency?: boolean;
  strength: GeneratedRefractionStrength;
  thickness?: number;
  viewportAligned?: boolean;
};

type RefractionFilterState = {
  href: string | null;
  metrics: RefractionMapMetrics | null;
};

function isProductionRuntime() {
  // SAFETY: only Node and bundler shims define `process`, so every step of the probe stays optional.
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: { NODE_ENV?: string } };
  };

  return runtime.process?.env?.NODE_ENV === 'production';
}

function parseRadiusValue(value: string, width: number, height: number) {
  const [first] = value.trim().split(/\s+/);
  const maxRadius = Math.min(width, height) / 2;

  const parsed = Number.parseFloat(first);

  if (first.endsWith('%')) {
    return clamp((parsed / 100) * Math.min(width, height), 0, maxRadius);
  }

  return clamp(Number.isFinite(parsed) ? parsed : maxRadius, 0, maxRadius);
}

function readUniformRadius(el: HTMLElement, width: number, height: number) {
  const style = window.getComputedStyle(el);

  const rawRadii = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ];

  const radii = rawRadii.map((value) => parseRadiusValue(value, width, height));
  const first = radii[0];
  const mixed = radii.some((radius) => Math.abs(radius - first) > 0.5);

  return mixed ? null : first;
}

function readCornerRadii(style: CSSStyleDeclaration, width: number, height: number): LensRadii {
  return [
    parseRadiusValue(style.borderTopLeftRadius, width, height),
    parseRadiusValue(style.borderTopRightRadius, width, height),
    parseRadiusValue(style.borderBottomRightRadius, width, height),
    parseRadiusValue(style.borderBottomLeftRadius, width, height),
  ];
}

/**
 * A scroll event reaches script a frame after the compositor has scrolled, so a scene moved from
 * script trails the page. Chromium filters a composited layer on its compositor, which lets a
 * scroll-driven animation carry the scene in step with the scroll and still bend it. WebKit leaves
 * a scene on its own compositing layer out of the SVG filter and Gecko has no scroll timelines, so
 * both keep moving the scene from script. Only Chromium has userAgentData.
 */
function supportsCompositedSceneScroll() {
  return (
    typeof ViewTimeline !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'userAgentData' in navigator
  );
}

// Across the timeline the scene moves down exactly as far as the scroll carries the surface up.
const sceneScrollKeyframes = (span: number): Keyframe[] => [
  { translate: '0px 0px' },
  { translate: `0px ${span}px` },
];

/**
 * A view timeline places its subject where it would sit if nothing were fixed or stuck, so it runs
 * on while such a surface stands still. Those surfaces keep following the scroll from script.
 */
function standsStillWhileScrolling(el: Element, source: Element) {
  for (let node: Element | null = el; node && node !== source; node = node.parentElement) {
    const { position } = window.getComputedStyle(node);

    if (position === 'fixed' || position === 'sticky') {
      return true;
    }
  }

  return false;
}

export function useRefractionFilter(
  surfaceRef: RefObject<HTMLElement | null>,
  {
    displacement,
    enabled,
    reduceTransparency = false,
    strength,
    thickness,
    viewportAligned = false,
  }: RefractionFilterOptions,
) {
  const rawId = useId().replaceAll(':', '');
  const filterId = `lg-refraction-${rawId}`;
  const generationRef = useRef(0);
  const warnedMixedRadiusRef = useRef(false);
  const [state, setState] = useState<RefractionFilterState>({ href: null, metrics: null });
  const sceneRef = useRef<HTMLDivElement | null>(null);
  // Set while the scene is kept aligned, so a scene that mounts is aligned before it first paints.
  const alignSceneNowRef = useRef<(() => void) | null>(null);

  const setScene = useCallback((node: HTMLDivElement | null) => {
    sceneRef.current = node;
    alignSceneNowRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || reduceTransparency || !viewportAligned) {
      return;
    }

    const el = surfaceRef.current;

    if (!el) {
      return;
    }

    let alignmentFrame = 0;
    let disposed = false;
    // Aligning a scene that no one can see only costs a layout, a style pass and a repaint on
    // every scroll frame, so it waits until the surface is within a quarter screen of the viewport.
    let nearViewport = true;

    const timeline = supportsCompositedSceneScroll()
      ? new ViewTimeline({ axis: 'block', subject: el })
      : null;

    let sceneScroll: Animation | null = null;
    let sceneScrollSpan = Number.NaN;

    // Keeps the scene's scroll-driven animation spanning the timeline and returns how far along
    // the block axis it has carried the scene, which the offset below then leaves out. Past
    // either end of the timeline the animation holds still, but the unclamped distance keeps the
    // offset constant, so plain scrolling rewrites nothing and the scene never waits on script.
    const followScroll = () => {
      const scene = sceneRef.current;
      const source = timeline?.source ?? null;

      if (
        !timeline ||
        !scene ||
        !source ||
        timeline.currentTime === null ||
        standsStillWhileScrolling(el, source)
      ) {
        sceneScroll?.cancel();
        sceneScroll = null;

        return 0;
      }

      const start = timeline.startOffset.to('px').value;
      const span = timeline.endOffset.to('px').value - start;

      if (sceneScroll?.effect instanceof KeyframeEffect && sceneScroll.effect.target === scene) {
        if (span !== sceneScrollSpan) {
          sceneScroll.effect.setKeyframes(sceneScrollKeyframes(span));
        }
      } else {
        sceneScroll?.cancel();
        sceneScroll = scene.animate(sceneScrollKeyframes(span), { fill: 'both', timeline });
      }

      sceneScrollSpan = span;

      return source.scrollTop - start;
    };

    const writeProperty = (property: string, value: string) => {
      if (el.style.getPropertyValue(property) !== value) {
        el.style.setProperty(property, value);
      }
    };

    const alignScene = () => {
      alignmentFrame = 0;

      if (disposed) {
        return;
      }

      const followed = followScroll();
      const rect = el.getBoundingClientRect();
      writeProperty('--lg-refraction-scene-x', `${-(rect.left + el.clientLeft)}px`);
      writeProperty('--lg-refraction-scene-y', `${-(rect.top + el.clientTop) - followed}px`);
      writeProperty('--lg-refraction-scene-width', `${document.documentElement.clientWidth}px`);
      writeProperty('--lg-refraction-scene-height', `${document.documentElement.clientHeight}px`);
    };

    const scheduleAlignment = () => {
      if (nearViewport && !alignmentFrame) {
        alignmentFrame = requestAnimationFrame(alignScene);
      }
    };

    alignSceneNowRef.current = () => {
      cancelAnimationFrame(alignmentFrame);
      alignScene();
    };

    const visibilityObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              const wasNear = nearViewport;
              nearViewport = entries[entries.length - 1]?.isIntersecting ?? true;

              // Coming into range aligns at once, in this task. A frame asked for from here would run
              // after whatever the page queued for the next frame, and that could read the scene
              // where it still was.
              if (nearViewport && !wasNear) {
                cancelAnimationFrame(alignmentFrame);
                alignScene();
              }
            },
            { rootMargin: '25% 0px' },
          );

    visibilityObserver?.observe(el);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleAlignment);

    for (let ancestor: HTMLElement | null = el; ancestor; ancestor = ancestor.parentElement) {
      resizeObserver?.observe(ancestor);
    }

    const readExternalStyleSignature = () => {
      const declarations: string[] = [];

      for (let index = 0; index < el.style.length; index += 1) {
        const property = el.style.item(index);

        if (property.startsWith('--lg-refraction-scene-')) {
          continue;
        }

        declarations.push(
          `${property}:${el.style.getPropertyValue(property)}:${el.style.getPropertyPriority(property)}`,
        );
      }

      return declarations.sort().join(';');
    };

    let externalStyleSignature = readExternalStyleSignature();

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            const hasExternalMutation = records.some((record) => {
              if (
                record.type === 'attributes' &&
                record.target === el &&
                record.attributeName === 'style'
              ) {
                const nextExternalStyleSignature = readExternalStyleSignature();

                if (nextExternalStyleSignature === externalStyleSignature) {
                  return false;
                }

                externalStyleSignature = nextExternalStyleSignature;
              }

              return true;
            });

            if (hasExternalMutation) {
              scheduleAlignment();
            }
          });

    mutationObserver?.observe(document.body, {
      attributeFilter: ['class', 'hidden', 'open', 'style'],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    document.addEventListener('scroll', scheduleAlignment, {
      capture: true,
      passive: true,
    });
    document.addEventListener('load', scheduleAlignment, {
      capture: true,
      passive: true,
    });
    document.fonts?.addEventListener('loadingdone', scheduleAlignment);
    window.addEventListener('resize', scheduleAlignment, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleAlignment, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleAlignment, { passive: true });
    scheduleAlignment();

    return () => {
      disposed = true;
      alignSceneNowRef.current = null;
      cancelAnimationFrame(alignmentFrame);
      sceneScroll?.cancel();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      visibilityObserver?.disconnect();
      document.removeEventListener('scroll', scheduleAlignment, { capture: true });
      document.removeEventListener('load', scheduleAlignment, { capture: true });
      document.fonts?.removeEventListener('loadingdone', scheduleAlignment);
      window.removeEventListener('resize', scheduleAlignment);
      window.visualViewport?.removeEventListener('resize', scheduleAlignment);
      window.visualViewport?.removeEventListener('scroll', scheduleAlignment);
      el.style.removeProperty('--lg-refraction-scene-height');
      el.style.removeProperty('--lg-refraction-scene-width');
      el.style.removeProperty('--lg-refraction-scene-x');
      el.style.removeProperty('--lg-refraction-scene-y');
    };
  }, [enabled, reduceTransparency, surfaceRef, viewportAligned]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;

    if (!enabled || reduceTransparency || typeof ResizeObserver === 'undefined') {
      queueMicrotask(() => {
        if (generationRef.current === generation) {
          setState({ href: null, metrics: null });
        }
      });

      return;
    }

    const el = surfaceRef.current;

    if (!el) {
      queueMicrotask(() => {
        if (generationRef.current === generation) {
          setState({ href: null, metrics: null });
        }
      });

      return;
    }

    let raf = 0;
    let disposed = false;

    const clear = () => {
      if (generationRef.current === generation) {
        setState({ href: null, metrics: null });
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const width = Math.max(0, rect.width);
        const height = Math.max(0, rect.height);

        if (!width || !height) {
          clear();

          return;
        }

        const radius = readUniformRadius(el, width, height);

        if (radius === null) {
          if (!isProductionRuntime() && !warnedMixedRadiusRef.current) {
            console.warn(
              'Glassy UI supplied-background refraction currently supports uniform rounded rectangles only.',
            );
            warnedMixedRadiusRef.current = true;
          }

          clear();

          return;
        }

        void buildRefractionMapDataUrl({
          devicePixelRatio: window.devicePixelRatio || 1,
          displacement,
          height,
          radius,
          strength,
          thickness,
          width,
        })
          .then((result) => {
            if (!disposed && generationRef.current === generation) {
              setState({ href: result.href, metrics: result.metrics });
            }
          })
          .catch(() => {
            if (!disposed) {
              clear();
            }
          });
      });
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [displacement, enabled, reduceTransparency, strength, surfaceRef, thickness]);

  const filterElement = useMemo(() => {
    if (!state.href || !state.metrics) return null;

    const {
      dispersion,
      filterBlur,
      filterPadding,
      filterScale,
      height,
      paddedHeight,
      paddedWidth,
      width,
    } = state.metrics;

    // Every colour follows the same two-axis rim normal, so the sides split as much as the ends.
    const channel = (name: string, matrix: string, factor: number) => (
      <>
        <feDisplacementMap
          in="scene"
          in2="map"
          scale={Math.round(filterScale * factor * 100) / 100}
          xChannelSelector="R"
          yChannelSelector="G"
          result={`${name}-scene`}
        />
        <feColorMatrix in={`${name}-scene`} type="matrix" values={matrix} result={`${name}-bent`} />
      </>
    );

    return (
      <svg aria-hidden="true" className="lg-refraction-filter" focusable="false" viewBox="0 0 0 0">
        <defs>
          <filter
            id={filterId}
            x={-filterPadding}
            y={-filterPadding}
            width={paddedWidth}
            height={paddedHeight}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={filterBlur} result="blurred" />
            <feImage
              href={state.href}
              x={-filterPadding}
              y={-filterPadding}
              width={width + filterPadding * 2}
              height={height + filterPadding * 2}
              preserveAspectRatio="none"
              result="map"
            />
            {/* The map's blue channel softens only the scene the rim magnifies. */}
            <feColorMatrix
              in="map"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"
              result="rim"
            />
            <feComposite in="blurred" in2="rim" operator="in" result="softRim" />
            <feComposite in="softRim" in2="SourceGraphic" operator="over" result="scene" />
            {dispersion > 0 ? (
              <>
                {channel('red', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1', 1 - dispersion / 2)}
                {channel('green', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1', 1)}
                {channel('blue', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 1', 1 + dispersion / 2)}
                <feBlend in="red-bent" in2="green-bent" mode="screen" result="red-green" />
                <feBlend in="red-green" in2="blue-bent" mode="screen" result="rgb" />
                {/* Combine opaque colour, then restore coverage once so translucent scenes stay translucent. */}
                <feComposite in="rgb" in2="green-scene" operator="in" />
              </>
            ) : (
              <feDisplacementMap
                in="scene"
                in2="map"
                scale={filterScale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            )}
          </filter>
        </defs>
      </svg>
    );
  }, [filterId, state.href, state.metrics]);

  return {
    active: Boolean(state.href && state.metrics),
    filterElement,
    filterStyle: state.href ? `url(#${filterId})` : undefined,
    sceneRef: setScene,
  };
}

type LensFilterOptions = {
  enabled: boolean;
  /** Changes whenever theme, mode, quality or variant tokens may have changed. */
  signature?: string;
};

type LensFilterState = {
  blur: number;
  bodyBrightness: number;
  dispersion: number;
  href: string;
  metrics: LensMapMetrics;
  rimBrightness: number;
  saturation: number;
};

/**
 * Only Chromium renders SVG references inside backdrop-filter. WebKit and
 * Gecko drop the whole declaration when url() is present, and CSS.supports()
 * reports true everywhere, so the engine is detected explicitly.
 */
function supportsBackdropLens() {
  return (
    typeof navigator !== 'undefined' &&
    'userAgentData' in navigator &&
    typeof ResizeObserver !== 'undefined'
  );
}

function readNumberToken(style: CSSStyleDeclaration, name: string) {
  const value = Number.parseFloat(style.getPropertyValue(name));

  return Number.isFinite(value) ? value : 0;
}

function readTokenOr(style: CSSStyleDeclaration, name: string, fallback: number) {
  const value = Number.parseFloat(style.getPropertyValue(name));

  return Number.isFinite(value) ? value : fallback;
}

function sameLens(previous: LensFilterState | null, next: LensFilterState) {
  return (
    previous !== null &&
    previous.href === next.href &&
    previous.blur === next.blur &&
    previous.bodyBrightness === next.bodyBrightness &&
    previous.dispersion === next.dispersion &&
    previous.rimBrightness === next.rimBrightness &&
    previous.saturation === next.saturation
  );
}

// A rim as wide as the corners are round, up to a little wider than the WebGL scene's default.
const LENS_BEVEL = 36;

// Slab height per pixel of rim, as in the scene (40 px of glass under a 28 px rim).
const LENS_THICKNESS_RATIO = 1.4;

// The least frost the lens reads through, so bent edges never stair-step.
const MIN_FROST = 0.5;

// Each colour follows the same rim normal: red bends least and blue most.
// Both live-backdrop glass and the magnifier use this material pass.
function refractColours(source: string, map: string, scale: number, dispersion: number) {
  if (dispersion <= 0.005) {
    return (
      <feDisplacementMap
        in={source}
        in2={map}
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
        result="bent"
      />
    );
  }

  const channel = (name: string, matrix: string, factor: number) => (
    <>
      <feDisplacementMap
        in={source}
        in2={map}
        scale={Math.round(scale * factor * 100) / 100}
        xChannelSelector="R"
        yChannelSelector="G"
        result={`${name}-scene`}
      />
      <feColorMatrix in={`${name}-scene`} type="matrix" values={matrix} result={`${name}-bent`} />
    </>
  );

  return (
    <>
      {channel('red', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1', 1 - dispersion / 2)}
      {channel('green', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1', 1)}
      {channel('blue', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 1', 1 + dispersion / 2)}
      <feBlend in="red-bent" in2="green-bent" mode="screen" result="red-green" />
      <feBlend in="red-green" in2="blue-bent" mode="screen" result="rgb" />
      {/* Combine opaque colour, then restore the reference channel's coverage once. */}
      <feComposite in="rgb" in2="green-scene" operator="in" result="bent" />
    </>
  );
}

/**
 * Chromium-only lens for glass over live content. The backdrop is frosted, then read
 * through a slab of glass whose top curves down into a rounded rim, so content bends
 * and splits into colour along the edge and lies flat everywhere else. The
 * --lg-lens-* tokens shape it: depth, bevel, thickness, ior, dispersion, blur and
 * saturation, and --lg-glass-thickness scales the whole slab at once. Other engines,
 * zero depth and oversized surfaces keep the CSS glass.
 */
export function useLensFilter(
  surfaceRef: RefObject<HTMLElement | null>,
  { enabled, signature }: LensFilterOptions,
) {
  const rawId = useId().replaceAll(':', '');
  const filterId = `lg-lens-${rawId}`;
  const generationRef = useRef(0);
  const [state, setState] = useState<LensFilterState | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const el = surfaceRef.current;

    if (!enabled || !el || !supportsBackdropLens()) {
      queueMicrotask(() => {
        if (generationRef.current === generation) {
          setState(null);
        }
      });

      return;
    }

    let frame = 0;
    let disposed = false;

    const measure = () => {
      frame = 0;

      if (disposed || generationRef.current !== generation) {
        return;
      }

      // The lens layer fills the padding box, so borders and scrollbars stay out of the map.
      const width = el.clientWidth;
      const height = el.clientHeight;
      const style = window.getComputedStyle(el);
      const depth = readNumberToken(style, '--lg-lens-depth');

      if (depth <= 0 || !width || !height || width * height > MAX_LENS_SURFACE_AREA) {
        setState(null);

        return;
      }

      const radii = readCornerRadii(style, width, height);
      const roundest = Math.max(...radii);
      const multiplier = clamp(readTokenOr(style, '--lg-glass-thickness', 1), 0.1, 4);
      const bevelToken = readNumberToken(style, '--lg-lens-bevel');
      const thicknessToken = readNumberToken(style, '--lg-lens-thickness');
      const baseBevel = bevelToken > 0 ? bevelToken : clamp(roundest, 6, LENS_BEVEL);
      // A thicker slab also has a wider rim, though not in proportion.
      const bevel = clamp(baseBevel * (0.6 + 0.4 * multiplier), 4, Math.min(width, height) / 2);

      const thickness =
        (thicknessToken > 0 ? thicknessToken : baseBevel * LENS_THICKNESS_RATIO) * multiplier;

      const { href, metrics } = buildLensMapDataUrl({
        bevel,
        depth,
        devicePixelRatio: window.devicePixelRatio || 1,
        height,
        ior: Math.max(1, readTokenOr(style, '--lg-lens-ior', 1.5)),
        radii,
        thickness,
        width,
      });

      const next = {
        blur: Math.max(0, readNumberToken(style, '--lg-lens-blur')),
        bodyBrightness: clamp(readTokenOr(style, '--lg-lens-body-brightness', 1), 0, 1),
        dispersion: clamp(readNumberToken(style, '--lg-lens-dispersion') * multiplier, 0, 1),
        href,
        metrics,
        rimBrightness: clamp(readTokenOr(style, '--lg-lens-rim-brightness', 1), 0, 1),
        saturation: readNumberToken(style, '--lg-lens-saturation') || 1,
      };

      setState((previous) => (sameLens(previous, next) ? previous : next));
    };

    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(measure);
      }
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [enabled, signature, surfaceRef]);

  const filterElement = useMemo(() => {
    if (!state) return null;

    const { blur, bodyBrightness, dispersion, href, metrics, rimBrightness, saturation } = state;
    // The rim is the same frosted glass as the flat top: it bends and splits what the frost
    // leaves and is never clearer, so content does not show through a sharp band at the edge.
    const frost = Math.max(blur, MIN_FROST);
    const padding = Math.ceil(frost * 3) + 2;
    // Map channels hold a unit offset; the scale turns it into CSS pixels.
    const scale = Math.round(2 * metrics.reach * 100) / 100;

    // Smoked glass darkens the flat top more than its rim, which lets the light through. A
    // primitive is added only where it changes something: each one is another pass on the GPU.
    const dim = (input: string, brightness: number, result: string) =>
      brightness < 1 ? (
        <feComponentTransfer in={input} result={result}>
          <feFuncR type="linear" slope={brightness} />
          <feFuncG type="linear" slope={brightness} />
          <feFuncB type="linear" slope={brightness} />
        </feComponentTransfer>
      ) : null;

    // The map's blue channel weights the rim's light over the top's. Where both let the same
    // light through, the bent frost alone is the glass.
    const shaded = rimBrightness !== bodyBrightness;
    const rimSource = rimBrightness < 1 ? 'rim-lit' : 'bent';
    const topSource = bodyBrightness < 1 ? 'top-lit' : 'bent';
    const glass = shaded ? 'mixed' : topSource;

    return (
      <svg aria-hidden="true" className="lg-refraction-filter" focusable="false" viewBox="0 0 0 0">
        <defs>
          <filter
            id={filterId}
            x={-padding}
            y={-padding}
            width={metrics.width + padding * 2}
            height={metrics.height + padding * 2}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={frost} result="frost" />
            <feImage
              href={href}
              x={0}
              y={0}
              width={metrics.width}
              height={metrics.height}
              preserveAspectRatio="none"
              result="lens"
            />
            {refractColours('frost', 'lens', scale, dispersion)}
            {shaded ? (
              <>
                <feColorMatrix
                  in="lens"
                  type="matrix"
                  values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0"
                  result="rim"
                />
                {dim('bent', rimBrightness, 'rim-lit')}
                {dim('bent', bodyBrightness, 'top-lit')}
                <feComposite in={rimSource} in2="rim" operator="in" result="rim-glass" />
                {/* The rim, weighted by its mask, over the top, which is opaque: the mask's
                    complement is implied, so the top needs no mask of its own. */}
                <feComposite in="rim-glass" in2={topSource} operator="over" result="mixed" />
              </>
            ) : (
              dim('bent', bodyBrightness, 'top-lit')
            )}
            {saturation === 1 ? null : (
              <feColorMatrix in={glass} type="saturate" values={String(saturation)} />
            )}
          </filter>
        </defs>
      </svg>
    );
  }, [filterId, state]);

  return {
    active: state !== null,
    filterElement,
    filterStyle: state ? `url(#${filterId})` : undefined,
  };
}

type MagnifierFilterOptions = LensFilterOptions & {
  /** Diameter of the round lens in CSS pixels. */
  size: number;
};

// Softens the compressed rim just enough to keep sharp edges from stair-stepping.
const MAGNIFIER_BLUR = 0.35;

/**
 * Rim refraction for the round magnifier, applied with `filter` to its zoomed view, which
 * every engine with SVG filters on HTML supports. Near the rim each pixel samples content
 * from further out, so the view bends into the edge like a glass bead.
 *
 * The view extends `margin` past the lens on every side so the rim has content to sample.
 * WebKit only lines the filtered view up with the map when the view clips its own overflow
 * and the filter region reaches past it by as far as the primitives can read, so the
 * region is the view plus another margin and the map sits one margin in.
 */
export function useMagnifierFilter(
  surfaceRef: RefObject<HTMLElement | null>,
  { enabled, signature, size }: MagnifierFilterOptions,
) {
  const rawId = useId().replaceAll(':', '');
  const filterId = `lg-magnifier-${rawId}`;
  const [map, setMap] = useState<(MagnifierMapBuildResult & { dispersion: number }) | null>(null);

  // Blue reaches furthest; leave enough scene beyond the rim for it and the blur.
  const margin =
    Math.ceil(
      computeMagnifierMapMetrics({ size }).depth * (1 + (map?.dispersion ?? 0) / 2) +
        MAGNIFIER_BLUR * 3,
    ) + 2;

  useEffect(() => {
    let disposed = false;

    // The map is drawn on a canvas, so it can only be built in the browser.
    queueMicrotask(() => {
      if (disposed) return;

      const surface = surfaceRef.current;

      if (!enabled || !surface) {
        setMap(null);

        return;
      }

      const style = window.getComputedStyle(surface);
      const thickness = clamp(readTokenOr(style, '--lg-glass-thickness', 1), 0.1, 4);
      setMap({
        ...buildMagnifierMapDataUrl({ devicePixelRatio: window.devicePixelRatio || 1, size }),
        dispersion: clamp(readNumberToken(style, '--lg-lens-dispersion') * thickness, 0, 1),
      });
    });

    return () => {
      disposed = true;
    };
  }, [enabled, signature, size, surfaceRef]);

  const filterElement = useMemo(() => {
    if (!map) return null;

    const {
      dispersion,
      metrics: { depth, size: mapCssSize },
    } = map;

    return (
      <svg aria-hidden="true" className="lg-refraction-filter" focusable="false" viewBox="0 0 0 0">
        <defs>
          <filter
            id={filterId}
            x={-margin}
            y={-margin}
            width={mapCssSize + margin * 4}
            height={mapCssSize + margin * 4}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={MAGNIFIER_BLUR} result="soft" />
            <feImage
              href={map.href}
              x={margin}
              y={margin}
              width={mapCssSize}
              height={mapCssSize}
              preserveAspectRatio="none"
              result="bend"
            />
            {refractColours('soft', 'bend', depth * 2, dispersion)}
          </filter>
        </defs>
      </svg>
    );
  }, [filterId, map, margin]);

  return {
    active: map !== null,
    filterElement,
    filterStyle: map ? `url(#${filterId})` : undefined,
    margin,
  };
}

type CapsuleLensFilterOptions = LensFilterOptions & {
  /** Colour split at the rim for regular glass; --lg-glass-thickness scales it. */
  dispersion: number;
  /**
   * How many times the capsule's size the filtered copy is laid out at before it is scaled
   * back down. WebKit filters at layout resolution, so a small lens bends in steps without it.
   */
  supersample?: number;
};

type CapsuleLensState = CapsuleLensMapBuildResult & { dispersion: number };

/**
 * Rim refraction for a capsule lens, such as a switch knob, applied with `filter` to a copy
 * of what lies under it. Every engine with SVG filters on HTML runs it. Near the rim each
 * pixel samples the copy from further out, so it bends into the edge like a bead of glass
 * and splits into colour there; --lg-glass-thickness deepens both. The copy must reach
 * `margin` past the capsule on every side so the rim has content to sample, and the filter
 * region reaches one margin further, as the round magnifier's does.
 */
export function useCapsuleLensFilter(
  surfaceRef: RefObject<HTMLElement | null>,
  { dispersion, enabled, signature, supersample = 1 }: CapsuleLensFilterOptions,
) {
  const rawId = useId().replaceAll(':', '');
  const filterId = `lg-capsule-${rawId}`;
  const [map, setMap] = useState<CapsuleLensState | null>(null);

  useEffect(() => {
    const el = surfaceRef.current;

    if (!enabled || !el) {
      queueMicrotask(() => setMap(null));

      return;
    }

    let frame = 0;
    let disposed = false;

    const measure = () => {
      frame = 0;

      if (disposed) return;

      const width = el.clientWidth;
      const height = el.clientHeight;

      if (!width || !height) {
        setMap(null);

        return;
      }

      const thickness = clamp(
        readTokenOr(window.getComputedStyle(el), '--lg-glass-thickness', 1),
        0.1,
        4,
      );

      const next = {
        // A supersampled copy already has the resolution the map needs.
        ...buildCapsuleLensMapDataUrl({
          devicePixelRatio: supersample > 1 ? 1 : window.devicePixelRatio || 1,
          height: height * supersample,
          thickness,
          width: width * supersample,
        }),
        dispersion: clamp(dispersion * thickness, 0, 1),
      };

      setMap((previous) =>
        previous &&
        previous.href === next.href &&
        previous.metrics.depth === next.metrics.depth &&
        previous.dispersion === next.dispersion
          ? previous
          : next,
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [dispersion, enabled, signature, supersample, surfaceRef]);

  // Blue reaches furthest; leave enough content beyond the rim for it and the blur. The
  // filter works in the copy's supersampled pixels; the margin is returned in CSS pixels,
  // rounded up to a whole one so the scaled copy lands on the knob without a sliver.
  const blur = MAGNIFIER_BLUR * supersample;

  const scaledMargin = map
    ? Math.ceil(
        (map.metrics.depth * (1 + map.dispersion / 2) + blur * 3 + 2 * supersample) / supersample,
      ) * supersample
    : 0;

  const filterElement = useMemo(() => {
    if (!map) return null;

    const { depth, height, width } = map.metrics;
    const margin = scaledMargin;

    return (
      <svg aria-hidden="true" className="lg-refraction-filter" focusable="false" viewBox="0 0 0 0">
        <defs>
          <filter
            id={filterId}
            x={-margin}
            y={-margin}
            width={width + margin * 4}
            height={height + margin * 4}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blurred" />
            <feImage
              href={map.href}
              x={margin}
              y={margin}
              width={width}
              height={height}
              preserveAspectRatio="none"
              result="bend"
            />
            {/* The map's blue channel softens only the scene the rim bends. */}
            <feColorMatrix
              in="bend"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"
              result="rim"
            />
            <feComposite in="blurred" in2="rim" operator="in" result="softRim" />
            <feComposite in="softRim" in2="SourceGraphic" operator="over" result="soft" />
            {refractColours('soft', 'bend', depth * 2, map.dispersion)}
          </filter>
        </defs>
      </svg>
    );
  }, [blur, filterId, map, scaledMargin]);

  return {
    active: map !== null,
    filterElement,
    filterStyle: map ? `url(#${filterId})` : undefined,
    margin: scaledMargin / supersample,
    supersample,
  };
}

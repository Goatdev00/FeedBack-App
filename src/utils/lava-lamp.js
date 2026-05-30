/**
 * Lava Lamp / Metaballs Background Effect
 * Renders organic, floating blobs that merge together like a lava lamp.
 * Uses the SVG gooey filter technique (blur + alpha threshold = metaballs).
 *
 * Architecture: blobs are SVG <circle>s appended to the <g id="lava-blobs">
 * element inside the same <svg> that owns the <filter id="gooey">. The
 * filter is applied via the SVG `filter` attribute on the <g>, NOT via CSS
 * on an HTML element. This is the only goo-filter wiring iOS Safari
 * handles reliably (see comment in index.html for the bug list).
 *
 * All blobs start from the logo's screen position (top-center of the
 * viewport) and expand outward to their orbit centers over the first
 * EXPAND_DURATION ms. After that they drift in lazy ellipses.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const NUM_DIRECTIONS = 12;

// Blob configurations — single orange tone. oX/oY: orbit center (% of viewport),
// rX/rY: orbit radius (% of viewport), spd: angular speed (rad/s).
const BLOB_CONFIGS = [
  // Large blobs
  { size: 220, oX: 0.25, oY: 0.12, rX: 0.18, rY: 0.10, spd: 0.15 },
  { size: 200, oX: 0.75, oY: 0.20, rX: 0.14, rY: 0.12, spd: 0.18 },
  { size: 190, oX: 0.50, oY: 0.55, rX: 0.20, rY: 0.08, spd: 0.12 },
  { size: 200, oX: 0.30, oY: 0.78, rX: 0.12, rY: 0.14, spd: 0.16 },
  { size: 180, oX: 0.80, oY: 0.65, rX: 0.10, rY: 0.18, spd: 0.20 },
  // Medium
  { size: 150, oX: 0.15, oY: 0.40, rX: 0.16, rY: 0.10, spd: 0.25 },
  { size: 160, oX: 0.60, oY: 0.35, rX: 0.12, rY: 0.15, spd: 0.22 },
  { size: 140, oX: 0.45, oY: 0.88, rX: 0.18, rY: 0.06, spd: 0.28 },
  // Small
  { size: 120, oX: 0.12, oY: 0.70, rX: 0.10, rY: 0.12, spd: 0.30 },
  { size: 110, oX: 0.88, oY: 0.42, rX: 0.08, rY: 0.10, spd: 0.35 },
  { size: 100, oX: 0.65, oY: 0.92, rX: 0.12, rY: 0.08, spd: 0.32 },
  { size: 100, oX: 0.35, oY: 0.05, rX: 0.10, rY: 0.14, spd: 0.38 },
];

const BLOB_COLOR = '#ff6600';
const EXPAND_DURATION = 3000; // ms — logo-center → orbit transition

/**
 * @param {string} containerId  id of the SVG <g> (or any SVG element) that
 *   will host the blob <circle>s. Defaults to 'lava-blobs'.
 * @param {string} svgId  id of the parent <svg> used to read render size.
 *   Defaults to 'lava-svg'.
 */
export function initLavaLamp(containerId = 'lava-blobs', svgId = 'lava-svg') {
  const container = document.getElementById(containerId);
  const svg = document.getElementById(svgId);
  if (!container || !svg) return;
  // Idempotency: if already initialized (e.g. hot reload), skip.
  if (container.dataset.lavaInit === '1') return;
  container.dataset.lavaInit = '1';

  const startTime = performance.now();
  const blobs = BLOB_CONFIGS.map((cfg) => {
    const el = document.createElementNS(SVG_NS, 'circle');
    // cx/cy stay at 0 — we move blobs via the `transform` attribute below
    // so the math reads the same as the old div-based version (translate
    // a coord pair around). r = size / 2 because SVG circles are
    // center-anchored, unlike the old top-left divs.
    el.setAttribute('cx', '0');
    el.setAttribute('cy', '0');
    el.setAttribute('r', String(cfg.size / 2));
    el.setAttribute('fill', BLOB_COLOR);
    container.appendChild(el);
    return {
      el,
      size: cfg.size,
      orbitCenterX: cfg.oX,
      orbitCenterY: cfg.oY,
      orbitRadiusX: cfg.rX,
      orbitRadiusY: cfg.rY,
      speed: cfg.spd,
      phase: Math.random() * Math.PI * NUM_DIRECTIONS / 6, // ~2π, decorative
    };
  });

  let rafId = 0;
  let running = true;

  function animate() {
    const elapsed = performance.now() - startTime;
    const rawExpand = Math.min(elapsed / EXPAND_DURATION, 1);
    const ease = 1 - Math.pow(1 - rawExpand, 3); // easeOutCubic
    const t = elapsed * 0.001;

    // Read viewport from the SVG host: the SVG is sized via CSS to the
    // visible column and stretches to 100vh, so its bounding box is the
    // authoritative canvas for blob coords. Fallback values match the
    // previous div-based defaults.
    const rect = svg.getBoundingClientRect();
    const cw = rect.width || 480;
    const ch = rect.height || window.innerHeight;
    const startX = cw * 0.5;
    const startY = ch * 0.33;

    for (const b of blobs) {
      const floatX = b.orbitCenterX * cw + Math.sin(t * b.speed + b.phase) * b.orbitRadiusX * cw;
      const floatY = b.orbitCenterY * ch + Math.cos(t * b.speed * 0.7 + b.phase * 1.3) * b.orbitRadiusY * ch;
      const cx = startX + (floatX - startX) * ease;
      const cy = startY + (floatY - startY) * ease;
      b.el.setAttribute('transform', `translate(${cx} ${cy})`);
    }

    if (running) rafId = requestAnimationFrame(animate);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function resume() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(animate);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  rafId = requestAnimationFrame(animate);
}

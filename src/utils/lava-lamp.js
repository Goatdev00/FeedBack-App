/**
 * Lava Lamp / Metaballs Background Effect
 * Renders organic, floating blobs that merge together like a lava lamp.
 * Uses the SVG gooey filter technique (blur + contrast threshold).
 * All blobs start from the center (logo position) and expand outward.
 */

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

export function initLavaLamp(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Idempotency: if already initialized (e.g. hot reload), skip.
  if (container.dataset.lavaInit === '1') return;
  container.dataset.lavaInit = '1';

  const startTime = performance.now();
  const blobs = BLOB_CONFIGS.map((cfg) => {
    const el = document.createElement('div');
    el.className = 'lava-blob';
    el.style.width = cfg.size + 'px';
    el.style.height = cfg.size + 'px';
    el.style.background = BLOB_COLOR;
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

    const cw = container.clientWidth || 480;
    const ch = container.clientHeight || window.innerHeight;
    const startX = cw * 0.5;
    const startY = ch * 0.33;

    for (const b of blobs) {
      const floatX = b.orbitCenterX * cw + Math.sin(t * b.speed + b.phase) * b.orbitRadiusX * cw;
      const floatY = b.orbitCenterY * ch + Math.cos(t * b.speed * 0.7 + b.phase * 1.3) * b.orbitRadiusY * ch;
      const x = startX + (floatX - startX) * ease - b.size / 2;
      const y = startY + (floatY - startY) * ease - b.size / 2;
      b.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
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

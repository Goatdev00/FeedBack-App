/**
 * Lava Lamp / Metaballs Background — WebGL renderer.
 *
 * Why WebGL and not SVG/Canvas2D:
 *   * SVG <filter url="#gooey">: filter pass runs in CPU/iGPU on iOS, can't
 *     hit 60fps full-screen.
 *   * Canvas2D w/ blur + threshold: same story — the blur step is the
 *     killer.
 *   * WebGL: the metaball field is a tiny per-pixel formula in the
 *     fragment shader. All N blobs collapse into one parallel GPU pass,
 *     bottleneck is fill rate. iOS A12+ renders this full-screen at 60fps
 *     without breaking a sweat.
 *
 * Architecture:
 *   * One full-screen triangle (cheaper than a quad — no overdraw at the
 *     edge, single primitive).
 *   * Fragment shader sums a 1/d² potential field from BLOB_COUNT
 *     metaballs, smoothsteps it through a threshold band to produce the
 *     goo silhouette in #ff6600.
 *   * JS owns blob physics (same orbit math as the old SVG version) and
 *     pushes positions+radii as a vec3 uniform array per frame.
 *
 * Tuning knobs are at the top so visual tweaks don't require re-reading
 * the shader.
 */

const BLOB_COUNT = 12;
const EXPAND_DURATION = 3000; // ms — logo-center → orbit transition
const BLOB_COLOR = [1.0, 0.4, 0.0]; // #ff6600 in linear-ish RGB

// Field threshold for the compact-support metaball formula below.
//   * THRESHOLD ~0.1  → visible blob radius ≈ 73% of configured size.
//                       Raise (toward 0.5) to shrink blobs and weaken
//                       merging; lower (toward 0.02) to grow them and
//                       glue them together harder.
// Edge anti-aliasing is computed per-pixel from fwidth() in the shader
// — no static softness knob, because any fixed value is wrong at some
// DPR/zoom level and produces visible stairsteps. The fwidth approach
// adapts the smoothstep band to the actual screen-space gradient of
// the field, giving pixel-perfect edges on any device.
const FIELD_THRESHOLD = 0.10;

// Same configs as the old SVG version. oX/oY: orbit center (% of canvas),
// rX/rY: orbit radius (%), spd: angular speed (rad/s), size in pixels.
const BLOB_CONFIGS = [
  { size: 220, oX: 0.25, oY: 0.12, rX: 0.18, rY: 0.10, spd: 0.15 },
  { size: 200, oX: 0.75, oY: 0.20, rX: 0.14, rY: 0.12, spd: 0.18 },
  { size: 190, oX: 0.50, oY: 0.55, rX: 0.20, rY: 0.08, spd: 0.12 },
  { size: 200, oX: 0.30, oY: 0.78, rX: 0.12, rY: 0.14, spd: 0.16 },
  { size: 180, oX: 0.80, oY: 0.65, rX: 0.10, rY: 0.18, spd: 0.20 },
  { size: 150, oX: 0.15, oY: 0.40, rX: 0.16, rY: 0.10, spd: 0.25 },
  { size: 160, oX: 0.60, oY: 0.35, rX: 0.12, rY: 0.15, spd: 0.22 },
  { size: 140, oX: 0.45, oY: 0.88, rX: 0.18, rY: 0.06, spd: 0.28 },
  { size: 120, oX: 0.12, oY: 0.70, rX: 0.10, rY: 0.12, spd: 0.30 },
  { size: 110, oX: 0.88, oY: 0.42, rX: 0.08, rY: 0.10, spd: 0.35 },
  { size: 100, oX: 0.65, oY: 0.92, rX: 0.12, rY: 0.08, spd: 0.32 },
  { size: 100, oX: 0.35, oY: 0.05, rX: 0.10, rY: 0.14, spd: 0.38 },
];

// Vertex shader: emit one fullscreen triangle. The triangle covers the
// whole [-1, 1] NDC box and gl_FragCoord supplies pixel coords to the FS.
const VS = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Fragment shader: COMPACT-SUPPORT metaball field with derivative AA.
//
// Field: each blob contributes v = max(0, 1 - d²/r²)³ — Wyvill cubic
// falloff that's exactly zero at and beyond distance r. This is what
// keeps blobs visually defined: a blob 500px away contributes EXACTLY
// 0 to the current pixel, so summing 12 blobs never floods empty space.
// The cubic is C2-smooth across the support boundary, so merging blobs
// form natural curved bridges with no seam.
//
// Anti-aliasing: instead of a fixed smoothstep softness (which is too
// narrow on hi-DPI → stairstep edges, too wide on low-DPI → mushy
// edges), we read the screen-space gradient of the field via fwidth()
// and use that as the smoothstep band. The result is exactly one pixel
// of AA at every zoom level and every DPR — bordes pixel-perfect.
//
// highp on field: derivatives at mediump are noisy and produce visible
// banding artefacts on iOS Adreno/PowerVR GPUs. The whole shader hot
// path runs on it, so we explicitly bump precision.
const FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2  u_resolution;
uniform vec3  u_blobs[${BLOB_COUNT}];   // (x, y, radius) per blob, in canvas pixels
uniform vec3  u_color;
uniform float u_threshold;

void main() {
  // gl_FragCoord origin is bottom-left in WebGL. JS stores blob positions
  // with top-left origin (matches CSS/SVG), so flip Y here.
  vec2 px = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);

  float field = 0.0;
  for (int i = 0; i < ${BLOB_COUNT}; i++) {
    vec2  d = px - u_blobs[i].xy;
    float r = u_blobs[i].z;
    float k = max(0.0, 1.0 - dot(d, d) / (r * r));
    field += k * k * k;
  }

  // Derivative-based AA. fwidth = |dF/dx| + |dF/dy|, the field's screen-
  // space rate of change in pixels. A smoothstep band exactly that wide
  // gives one pixel of transition. Multiply by 0.7 for a slightly
  // sharper-than-default look that still antialiases cleanly.
  float aa = fwidth(field) * 0.7;
  float alpha = smoothstep(u_threshold - aa, u_threshold + aa, field);
  gl_FragColor = vec4(u_color, alpha);
}
`;

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[lava] shader compile error:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[lava] program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * @param {string} canvasId  id of the <canvas> element. Defaults to
 *   'lava-canvas'. CSS positions/sizes it; we read its CSS box and
 *   sync the GL drawing buffer to it on resize.
 */
export function initLavaLamp(canvasId = 'lava-canvas') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  // Idempotency: skip on hot reload.
  if (canvas.dataset.lavaInit === '1') return;
  canvas.dataset.lavaInit = '1';

  // Prefer WebGL with explicit hints: alpha so the dark page background
  // shows through where the goo is empty, premultipliedAlpha:false so our
  // colour outputs aren't double-multiplied (we mostly draw alpha=0 or 1).
  // antialias is irrelevant for a quad of one colour; saves a bit on iOS.
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  }) || canvas.getContext('experimental-webgl');
  if (!gl) {
    console.warn('[lava] WebGL not available — background will be blank');
    return;
  }

  // Enable the derivatives extension that the fragment shader's fwidth()
  // depends on. Universally supported in any browser that has WebGL1
  // (it's part of WebGL2 core, and every WebGL1 implementation ships it),
  // but the explicit enableExtension call is required for WebGL1.
  gl.getExtension('OES_standard_derivatives');

  const prog = buildProgram(gl);
  if (!prog) return;
  gl.useProgram(prog);

  // Single full-screen triangle. The vertex outside the [-1,1] box is
  // clipped, so we cover the whole viewport with 3 vertices total.
  const tri = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, tri, gl.STATIC_DRAW);
  const loc_a_pos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc_a_pos);
  gl.vertexAttribPointer(loc_a_pos, 2, gl.FLOAT, false, 0, 0);

  // Uniform locations cached up front — looking them up every frame would
  // be wasted work.
  const loc_u_resolution = gl.getUniformLocation(prog, 'u_resolution');
  const loc_u_blobs      = gl.getUniformLocation(prog, 'u_blobs');
  const loc_u_color      = gl.getUniformLocation(prog, 'u_color');
  const loc_u_threshold  = gl.getUniformLocation(prog, 'u_threshold');

  gl.uniform3fv(loc_u_color, BLOB_COLOR);
  gl.uniform1f(loc_u_threshold, FIELD_THRESHOLD);

  // Enable alpha blending so the goo composits over whatever's behind the
  // canvas. With premultipliedAlpha:false the standard sf/(1-sa) blend is
  // correct.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // CSS-pixel dimensions and the GL drawing-buffer resolution. Render at
  // the full devicePixelRatio (capped at 3 for sanity on weird VR setups):
  // the shader is cheap enough that 3x is well within budget on every
  // iPhone, and DPR-capping was causing the canvas to be CSS-upscaled by
  // the browser → blurry edges + amplified aliasing on retina screens.
  // The fwidth() AA below adapts to whatever resolution we pick, so we
  // can give the GPU the native pixel count and get crisp edges for free.
  let cssW = 0, cssH = 0;
  let bufW = 0, bufH = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    bufW = Math.round(cssW * dpr);
    bufH = Math.round(cssH * dpr);
    canvas.width  = bufW;
    canvas.height = bufH;
    gl.viewport(0, 0, bufW, bufH);
    gl.uniform2f(loc_u_resolution, bufW, bufH);
  }
  resize();
  window.addEventListener('resize', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

  // Pre-allocate the uniform buffer for blob positions. Filling a typed
  // array in place each frame is much cheaper than allocating one.
  const blobBuf = new Float32Array(BLOB_COUNT * 3);

  // Blob physics — orbit positions in CSS pixels (we'll multiply by DPR
  // before sending to GL so the formula reads the same as the old SVG).
  const blobs = BLOB_CONFIGS.map(cfg => ({
    size: cfg.size,
    orbitCenterX: cfg.oX,
    orbitCenterY: cfg.oY,
    orbitRadiusX: cfg.rX,
    orbitRadiusY: cfg.rY,
    speed: cfg.spd,
    phase: Math.random() * Math.PI * 2,
  }));

  const startTime = performance.now();
  let rafId = 0;
  let running = true;

  function frame() {
    const elapsed = performance.now() - startTime;
    const rawExpand = Math.min(elapsed / EXPAND_DURATION, 1);
    const ease = 1 - Math.pow(1 - rawExpand, 3); // easeOutCubic
    const t = elapsed * 0.001;

    // Same coordinate space as the old SVG: pixels with origin at
    // top-left of the canvas. The shader flips Y for gl_FragCoord.
    const startX = cssW * 0.5;
    const startY = cssH * 0.33;
    const dpr = bufW / cssW; // exact ratio, accounts for round-off

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const floatX = b.orbitCenterX * cssW + Math.sin(t * b.speed + b.phase) * b.orbitRadiusX * cssW;
      const floatY = b.orbitCenterY * cssH + Math.cos(t * b.speed * 0.7 + b.phase * 1.3) * b.orbitRadiusY * cssH;
      const cx = startX + (floatX - startX) * ease;
      const cy = startY + (floatY - startY) * ease;
      // Multiply by DPR so blob coords match the FS's gl_FragCoord, which
      // is in drawing-buffer pixels (not CSS pixels).
      blobBuf[i * 3 + 0] = cx * dpr;
      blobBuf[i * 3 + 1] = cy * dpr;
      blobBuf[i * 3 + 2] = (b.size * 0.5) * dpr;
    }

    gl.uniform3fv(loc_u_blobs, blobBuf);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (running) rafId = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function resume() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  rafId = requestAnimationFrame(frame);
}

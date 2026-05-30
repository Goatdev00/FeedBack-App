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

// Field threshold and edge sharpness. Higher threshold → tighter blob
// silhouettes (less merging). Higher sharpness denominator → wider AA
// band (softer edge). Set to match the previous SVG visual at "30 -13".
const FIELD_THRESHOLD = 1.0;
const FIELD_SOFTNESS  = 0.18;

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

// Fragment shader: metaball field.
// We compute, for each pixel, the sum over all blobs of r²/d² (the
// classic Blinn metaball potential — finite at d=0 thanks to the +1
// epsilon, falls off as 1/d² so distant blobs contribute almost nothing
// but nearby blobs blend smoothly). Compare against u_threshold via a
// narrow smoothstep band to get a hard but anti-aliased silhouette.
const FS = `
precision mediump float;
uniform vec2  u_resolution;
uniform vec3  u_blobs[${BLOB_COUNT}];   // (x, y, radius) per blob, in CSS pixels
uniform vec3  u_color;
uniform float u_threshold;
uniform float u_softness;

void main() {
  // gl_FragCoord origin is bottom-left in WebGL. The JS side stores blob
  // positions with top-left origin (matches the old SVG), so flip Y here.
  vec2 px = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);

  float field = 0.0;
  for (int i = 0; i < ${BLOB_COUNT}; i++) {
    vec2  d = px - u_blobs[i].xy;
    float r = u_blobs[i].z;
    // +1.0 epsilon avoids singularity at d=0 (would otherwise blow out
    // the centre of every blob to infinity, killing the alpha test).
    field += (r * r) / (dot(d, d) + 1.0);
  }

  float alpha = smoothstep(u_threshold - u_softness, u_threshold + u_softness, field);
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
  const loc_u_softness   = gl.getUniformLocation(prog, 'u_softness');

  gl.uniform3fv(loc_u_color, BLOB_COLOR);
  gl.uniform1f(loc_u_threshold, FIELD_THRESHOLD);
  gl.uniform1f(loc_u_softness,  FIELD_SOFTNESS);

  // Enable alpha blending so the goo composits over whatever's behind the
  // canvas. With premultipliedAlpha:false the standard sf/(1-sa) blend is
  // correct.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // CSS-pixel dimensions and the GL drawing-buffer resolution. We render
  // at min(devicePixelRatio, 2) to keep fill rate reasonable on retina —
  // 3x DPR full-screen = 9x pixel work vs 1x, which is gratuitous for a
  // soft background.
  let cssW = 0, cssH = 0;
  let bufW = 0, bufH = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

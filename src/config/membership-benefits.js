// =====================================================================
// FEEDBACK — Membership Benefits Matrix
// Single source of truth, consumed by:
//   - <MembershipCard> / <BenefitsList> (UI)
//   - the rate-limit helpers in src/data/limits.js
//   - the chat input UI to decide between locked / open / featured
//
// Adding a new beneficio:
//   1. Add it to BENEFITS as a new key (camelCase) with `{label, byRole}`.
//   2. byRole[role] is the cell shown in the comparison table.
//   3. If the benefit gates behavior at runtime, also surface a numeric
//      value via LIMITS / PERMS so the data layer can read it.
// Adding a new tier:
//   1. Add to TIERS with metadata.
//   2. Add a column to every BENEFITS entry.
//   3. Update LIMITS / PERMS for the new tier.
//   4. Add an enum value to the `membership_tier` type in Postgres.
// =====================================================================

export const TIERS = [
  {
    id: 'general',
    name: 'General',
    tagline: 'Vive la escena',
    priceMonthly: 0,
    priceYearly: 0,
    accent: '#FFFFFF',
    purchasable: false, // default tier — no checkout
  },
  {
    id: 'vip',
    name: 'VIP',
    tagline: 'Sé parte del muro',
    priceMonthly: 14_900,
    priceYearly: 149_000, // ~17% off
    accent: '#FF6A00',
    purchasable: true,
    recommendedFor: ['raver'],
  },
  {
    id: 'back',
    name: 'Back',
    tagline: 'All access',
    priceMonthly: 29_900,
    priceYearly: 299_000,
    accent: '#9B5DE5',
    purchasable: true,
    recommendedFor: ['dj', 'promotor'],
  },
];

export const ROLES = [
  { id: 'raver',    name: 'Raver',    emoji: '🎉' },
  { id: 'dj',       name: 'DJ',       emoji: '🎧' },
  { id: 'promotor', name: 'Promotor', emoji: '✨' },
];

const cell = (general, vip, back) => ({ general, vip, back });

// =====================================================================
// Per-role benefit tables. Keys are stable; the label is the human copy.
// =====================================================================
export const BENEFITS = {
  raver: [
    { key: 'comments',     label: 'Comentarios diarios',   byTier: cell('5',          'Ilimitados',          'Ilimitados + destacados') },
    { key: 'ratingWeight', label: 'Peso del rating en vivo', byTier: cell('x1',       'x2',                  'x3') },
    { key: 'history',      label: 'Historial de fiestas',    byTier: cell('últimas 10','Ilimitado',          'Ilimitado + estadísticas') },
    { key: 'badge',        label: 'Badge en perfil',         byTier: cell('—',         'VIP',                'Back animado') },
    { key: 'liveChat',     label: 'Chat en vivo',            byTier: cell('Solo lectura','Lectura + escritura','Sala privada con DJ/promotor') },
    { key: 'ticketDiscount', label: 'Descuento en entradas', byTier: cell('—',         '5–10%',              '15–20% + preventa') },
    { key: 'follow',       label: 'Seguir DJs/promotores',   byTier: cell('Hasta 20',  'Ilimitado',          'Ilimitado + push') },
  ],
  dj: [
    { key: 'sets',         label: 'Sets publicados / mes',   byTier: cell('2',         '10',                 'Ilimitados') },
    { key: 'mixLength',    label: 'Mixes / previews',        byTier: cell('1 (30 min)','5 (60 min)',         'Ilimitados sin tope') },
    { key: 'stats',        label: 'Estadísticas',            byTier: cell('Básicas',   'Detalladas',         'Avanzadas + exportables') },
    { key: 'featured',     label: 'DJs destacados',          byTier: cell('—',         'Rotación semanal',   'Posición fija') },
    { key: 'replyComments',label: 'Responder comentarios',   byTier: cell('Sí',        '+ comentario fijado','+ Q&A en vivo') },
    { key: 'verified',     label: 'Verificación',            byTier: cell('—',         'Básica',             'Premium ✓') },
    { key: 'booking',      label: 'Booking in-app',          byTier: cell('—',         'Sí',                 'Sí + portafolio') },
  ],
  promotor: [
    { key: 'events',       label: 'Eventos activos',         byTier: cell('2',         '10',                 'Ilimitados') },
    { key: 'promotion',    label: 'Promoción del evento',    byTier: cell('Estándar',  'Destacado en feed',  'Top del feed + push masivo') },
    { key: 'analytics',    label: 'Analítica',               byTier: cell('Asistentes','+ ratings y comentarios','+ demografía y heatmaps') },
    { key: 'cohosts',      label: 'Co-anfitriones',          byTier: cell('1',         '5',                  'Ilimitados') },
    { key: 'tickets',      label: 'Venta de entradas',       byTier: cell('—',         'Comisión estándar',  'Comisión reducida') },
    { key: 'broadcast',    label: 'Difusión',                byTier: cell('—',         'Email a seguidores', 'Push + email + cross-promo') },
    { key: 'support',      label: 'Soporte',                 byTier: cell('Comunidad', 'Prioritario',        'Manager dedicado') },
  ],
};

// =====================================================================
// Machine-readable limits & permissions. The UI uses BENEFITS for copy;
// the data layer uses LIMITS / PERMS to actually enforce things.
// =====================================================================
export const LIMITS = {
  raver: {
    dailyComments:        { general: 5,    vip: Infinity, back: Infinity },
    ratingWeight:         { general: 1,    vip: 2,        back: 3 },
    historySize:          { general: 10,   vip: Infinity, back: Infinity },
    ticketDiscountPct:    { general: 0,    vip: 8,        back: 18 },
    followsMax:           { general: 20,   vip: Infinity, back: Infinity },
  },
  dj: {
    monthlySets:          { general: 2,    vip: 10,       back: Infinity },
    monthlyMixes:         { general: 1,    vip: 5,        back: Infinity },
    mixMaxMinutes:        { general: 30,   vip: 60,       back: Infinity },
  },
  promotor: {
    activeEvents:         { general: 2,    vip: 10,       back: Infinity },
    coHostsMax:           { general: 1,    vip: 5,        back: Infinity },
  },
};

export const PERMS = {
  // chat input behavior on /party/:id/live
  chatWrite:           { general: false, vip: true,  back: true },
  chatPrivateRoom:     { general: false, vip: false, back: true },
  chatFeaturedBubble:  { general: false, vip: false, back: true },
  vipBadgeOnProfile:   { general: false, vip: true,  back: true },
  pinComment:          { general: false, vip: true,  back: true },
  liveQA:              { general: false, vip: false, back: true },
  pushNotifications:   { general: false, vip: false, back: true },
  exportStats:         { general: false, vip: false, back: true },
  bookingInApp:        { general: false, vip: true,  back: true },
  fixedFeatured:       { general: false, vip: false, back: true },
};

// =====================================================================
// Helpers — pure, no side effects, easy to unit-test.
// =====================================================================
export function tierIndex(tier) {
  return ({ general: 0, vip: 1, back: 2 }[tier] ?? 0);
}

export function tierAtLeast(currentTier, requiredTier) {
  return tierIndex(currentTier) >= tierIndex(requiredTier);
}

export function ratingWeight(tier) {
  return LIMITS.raver.ratingWeight[tier] ?? 1;
}

export function canDo(tier, perm) {
  return Boolean(PERMS[perm]?.[tier]);
}

export function nextTier(tier) {
  if (tier === 'general') return 'vip';
  if (tier === 'vip') return 'back';
  return null;
}

export function priceOf(tier, cycle = 'monthly') {
  const t = TIERS.find(x => x.id === tier);
  if (!t) return 0;
  return cycle === 'yearly' ? t.priceYearly : t.priceMonthly;
}

export function formatCop(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}

export function benefitsFor(role) {
  return BENEFITS[role] || [];
}

export function recommendedTierFor(role) {
  for (const tier of TIERS) {
    if (tier.recommendedFor?.includes(role)) return tier.id;
  }
  return 'vip';
}

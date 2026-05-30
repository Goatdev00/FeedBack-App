// ============================================
// FEEDBACK — Mock Data & State Management
// ============================================

import { router } from '../router.js';
import {
  notifyNewLike,
  notifyNewComment,
  notifyNewFollower,
} from '../notifications/notify.js';

// Repaint the visible page when state mutations matter to the UI but no
// component is subscribed. The wall doesn't subscribe to the store, so
// without this the optimistic-pending → real-post swap never updates the
// DOM (the post stays visibly "pending"/transparent until manual refresh).
// Scoped to data-driven routes so re-render is cheap and idempotent.
const UI_ROUTES_TO_REPAINT = new Set(['wall', 'parties', 'profile', 'profile-other']);
function repaintIfNeeded() {
  if (UI_ROUTES_TO_REPAINT.has(router.getCurrentRoute())) {
    router.refreshCurrentRoute();
  }
}

// --- SVG Icons ---
export const ICONS = {
  profile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  wall: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  parties: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  heartFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  question: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  location: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  starFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  award: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  google: `<svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  barChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  // Social media icons
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.98a8.21 8.21 0 0 0 3.76.92V6.69z"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  // Theme icons
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
};

// --- Today / date helpers ---
const isSunday = new Date().getDay() === 0;

function daysAgo(d) {
  const date = new Date();
  date.setDate(date.getDate() - d);
  return date;
}

function formatRelative(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

// --- Mock Users ---
const MOCK_USERS = [
  {
    id: 'u1',
    name: 'Carlos Rave',
    username: '@carlosrave',
    role: 'raver',
    city: 'Bogotá',
    bio: 'Viviendo la escena desde 2018 🎶 Techno & house lover',
    avatar: null,
    points: 420,
    followers: 128,
    following: 95,
    badges: ['explorer', 'active', 'voice'],
    partiesAttended: ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333'],
    postsToday: 2,
    premium: false,
    social: { instagram: 'carlosrave_co', tiktok: 'carlosrave', twitter: 'carlosrave' },
    theme: 'dark'
  },
  {
    id: 'u2',
    name: 'DJ Nocturn',
    username: '@djnocturn',
    role: 'dj',
    city: 'Medellín',
    bio: 'Techno / Dark Techno | Resident @WarehouseClub | Bookings: DM',
    avatar: null,
    points: 890,
    followers: 2340,
    following: 180,
    badges: ['topdj', 'voice', 'insider'],
    partiesAttended: ['a1111111-1111-4111-8111-111111111111', 'a4444444-4444-4444-8444-444444444444'],
    postsToday: 1,
    premium: true,
    social: { instagram: 'djnocturn', tiktok: 'djnocturn_official', twitter: 'djnocturn' },
    theme: 'dark'
  },
  {
    id: 'u3',
    name: 'Luna Promotions',
    username: '@lunapromo',
    role: 'promotor',
    city: 'Bogotá',
    bio: 'Creando experiencias nocturnas inolvidables ✨ Eventos premium',
    avatar: null,
    points: 1250,
    followers: 5600,
    following: 320,
    badges: ['promotor', 'explorer', 'insider'],
    partiesAttended: ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222'],
    postsToday: 0,
    premium: true,
    social: { instagram: 'lunapromotions', tiktok: 'lunapromo', twitter: 'luna_promo' },
    theme: 'dark'
  },
  {
    id: 'u4',
    name: 'Valentina Bass',
    username: '@valbass',
    role: 'raver',
    city: 'Cali',
    bio: 'Underground all the way 🖤',
    avatar: null,
    points: 305,
    followers: 67,
    following: 132,
    badges: ['explorer', 'active'],
    partiesAttended: ['a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a5555555-5555-4555-8555-555555555555'],
    postsToday: 3,
    premium: false,
    social: { instagram: 'valbass_', tiktok: '', twitter: '' },
    theme: 'light'
  },
  {
    id: 'u5',
    name: 'DJ Voltage',
    username: '@djvoltage',
    role: 'dj',
    city: 'Bogotá',
    bio: 'Drum & Bass / Jungle | Events worldwide',
    avatar: null,
    points: 670,
    followers: 1800,
    following: 210,
    badges: ['topdj', 'active'],
    partiesAttended: ['a3333333-3333-4333-8333-333333333333'],
    postsToday: 0,
    premium: false,
    social: { instagram: 'djvoltage', tiktok: 'djvoltage_dnb', twitter: 'djvoltage' },
    theme: 'dark'
  },
  {
    id: 'u6',
    name: 'Marco Torres',
    username: '@marcot',
    role: 'raver',
    city: 'Bogotá',
    bio: 'Every weekend is a new adventure 🎉',
    avatar: null,
    points: 180,
    followers: 42,
    following: 88,
    badges: ['explorer'],
    partiesAttended: ['a1111111-1111-4111-8111-111111111111'],
    postsToday: 1,
    premium: false,
    social: { instagram: 'marcotorres', tiktok: '', twitter: 'marco_t' },
    theme: 'dark'
  }
];

// --- Mock Parties ---
const MOCK_PARTIES = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    name: 'NEXUS — Underground Session',
    venue: 'Warehouse Club',
    city: 'Bogotá',
    date: new Date().toISOString().split('T')[0],
    startTime: '22:00',
    endTime: '06:00',
    genres: ['Techno', 'Dark Techno'],
    promotor: null,
    djs: [],
    flyer: null,
    attendees: [],
    rating: {},
    reports: {},
    sponsored: false,
    status: 'upcoming',
    description: 'Una noche de techno puro en lo más profundo del underground bogotano.'
  },
  {
    id: 'a2222222-2222-4222-8222-222222222222',
    name: 'PULSE — House & Disco',
    venue: 'Terraza Nocturna',
    city: 'Bogotá',
    date: new Date().toISOString().split('T')[0],
    startTime: '21:00',
    endTime: '04:00',
    genres: ['House', 'Disco', 'Deep House'],
    promotor: null,
    djs: [],
    flyer: null,
    attendees: [],
    rating: {},
    reports: {},
    sponsored: true,
    status: 'upcoming',
    description: 'La mejor selección de house y disco en la terraza más icónica de la ciudad.'
  },
  {
    id: 'a3333333-3333-4333-8333-333333333333',
    name: 'BASS CATHEDRAL',
    venue: 'Bodega 42',
    city: 'Bogotá',
    date: new Date().toISOString().split('T')[0],
    startTime: '23:00',
    endTime: '07:00',
    genres: ['Drum & Bass', 'Jungle', 'Breakbeat'],
    promotor: null,
    djs: [],
    flyer: null,
    attendees: [],
    rating: {},
    reports: {},
    sponsored: false,
    status: 'upcoming',
    description: 'La catedral del bass te espera con los mejores DJs nacionales.'
  },
  {
    id: 'a4444444-4444-4444-8444-444444444444',
    name: 'ECLIPSE — Melodic Techno',
    venue: 'Club Astral',
    city: 'Medellín',
    date: new Date().toISOString().split('T')[0],
    startTime: '22:00',
    endTime: '05:00',
    genres: ['Melodic Techno', 'Progressive'],
    promotor: null,
    djs: [],
    flyer: null,
    attendees: [],
    rating: {},
    reports: {},
    sponsored: false,
    status: 'upcoming',
    description: 'Viaje sonoro a través del melodic techno en el venue más premium de Medellín.'
  },
  {
    id: 'a5555555-5555-4555-8555-555555555555',
    name: 'FREKVENCIA',
    venue: 'La Factoría',
    city: 'Cali',
    date: new Date().toISOString().split('T')[0],
    startTime: '23:00',
    endTime: '06:00',
    genres: ['Minimal', 'Tech House'],
    promotor: null,
    djs: [],
    flyer: null,
    attendees: [],
    rating: {},
    reports: {},
    sponsored: false,
    status: 'upcoming',
    description: 'Minimal vibes en el corazón de Cali.'
  }
];

// --- Mock Posts ---
// Phase 3: posts live in Supabase (public.posts). Boot-time hydration in
// main.js fetches the real list. We keep an empty mock so the legacy
// default state stays valid until hydration completes.
const MOCK_POSTS = [];

// --- Mock Questions (Ask.fm style) ---
const MOCK_QUESTIONS = [
  {
    id: 'q1',
    targetUserId: 'u2',
    question: '¿Cuál es tu track favorito para cerrar un set?',
    answer: 'Siempre varía pero últimamente "Dust" de Dax J me tiene enganchado. Tiene esa energía oscura perfecta para el cierre.',
    anonymous: true,
    createdAt: daysAgo(2)
  },
  {
    id: 'q2',
    targetUserId: 'u2',
    question: '¿Cuándo vienes a Cali?',
    answer: 'Estoy trabajando en algo para mayo. Stay tuned 🎧',
    anonymous: true,
    createdAt: daysAgo(1)
  },
  {
    id: 'q3',
    targetUserId: 'u1',
    question: '¿Cuál ha sido tu mejor fiesta del 2026?',
    answer: null,
    anonymous: true,
    createdAt: daysAgo(0)
  },
  {
    id: 'q4',
    targetUserId: 'u3',
    question: '¿Tienen planes de llevar NEXUS a otras ciudades?',
    answer: 'Sí, estamos explorando Medellín y Barranquilla para Q3. Pronto habrá noticias.',
    anonymous: true,
    createdAt: daysAgo(3)
  },
  {
    id: 'q5',
    targetUserId: 'u4',
    question: '¿Qué género prefieres para empezar la noche?',
    answer: null,
    anonymous: false,
    createdAt: daysAgo(0)
  }
];

// --- Points System Rules ---
export const POINTS_RULES = {
  attendParty: { points: 20, label: 'Asistir a una fiesta', dailyLimit: 3 },
  firstPost: { points: 15, label: 'Primera publicación útil en fiesta', dailyLimit: 1 },
  ratePartySunday: { points: 10, label: 'Calificar fiesta el domingo', dailyLimit: 5 },
  answerQuestion: { points: 5, label: 'Responder pregunta en perfil', dailyLimit: 10 },
  featuredPost: { points: 10, label: 'Publicación destacada', dailyLimit: 1 },
  validatedReport: { points: 10, label: 'Reporte validado por usuarios', dailyLimit: 3 },
  // Awarded to BOTH parties the first time they end up following each
  // other (mutual / reciprocal follow). One-way follows give zero points.
  // The pair is stored order-independently in state.awardedFollows so
  // a future unfollow+refollow does NOT re-award.
  followConnection: { points: 10, label: 'Seguirse mutuamente', oncePerPair: true, mutual: true },
};

// --- Report Categories ---
export const REPORT_CATEGORIES = [
  { id: 'ambiente', label: 'Ambiente', emoji: '✨' },
  { id: 'seguridad', label: 'Seguridad', emoji: '🛡️' },
  { id: 'musica', label: 'Música', emoji: '🎵' },
  { id: 'aforo', label: 'Aforo', emoji: '👥' },
  { id: 'energia', label: 'Energía', emoji: '⚡' },
  { id: 'filas', label: 'Filas', emoji: '🚶' },
  { id: 'problemas', label: 'Problemas', emoji: '⚠️' },
  { id: 'highlights', label: 'Highlights', emoji: '🌟' },
];

// --- Sunday Rating Categories ---
export const SUNDAY_CATEGORIES = [
  { id: 'musica', label: 'Música', emoji: '🎵' },
  { id: 'energia', label: 'Energía', emoji: '⚡' },
  { id: 'organizacion', label: 'Organización', emoji: '📋' },
  { id: 'seguridad', label: 'Seguridad', emoji: '🛡️' },
  { id: 'locacion', label: 'Locación', emoji: '📍' },
  { id: 'publico', label: 'Público', emoji: '👥' },
  { id: 'general', label: 'Experiencia General', emoji: '⭐' }
];

// ============================================
// STATE MANAGEMENT (localStorage-backed)
// ============================================

// Bump the suffix whenever you do a hard data reset on the backend (e.g.
// migration 0012 wiped all posts/parties). Returning users will see their
// old cached posts/parties auto-evicted on next load instead of staring
// at ghosts of test data while Supabase refills.
const STORAGE_KEY = 'feedback_app_state_v2';

// Used by loadState() to scrap legacy non-UUID ids inherited from the
// pre-Phase-3 mock data. Anything that doesn't match the canonical v4
// UUID shape gets purged so Supabase hydration can repopulate clean.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

// Strip base64 image data URLs (party flyers + post photos) from a state
// snapshot. Each data URL can run megabytes — five of them blow past
// the localStorage quota. We keep the metadata (so the UI knows there
// WAS an image) but null out the bytes; Phase 4 will move uploads to
// Supabase Storage so this is no longer an issue.
function pruneHeavyState(state) {
  const lite = { ...state };
  if (Array.isArray(lite.parties)) {
    lite.parties = lite.parties.map(p =>
      p.flyer && typeof p.flyer === 'string' && p.flyer.startsWith('data:')
        ? { ...p, flyer: null } : p
    );
  }
  if (Array.isArray(lite.posts)) {
    lite.posts = lite.posts.map(p =>
      p.image && typeof p.image === 'string' && p.image.startsWith('data:')
        ? { ...p, image: null } : p
    );
  }
  // Chat messages live in the in-memory page buffer now; the legacy
  // state.chatRooms is only a fallback. Safe to drop on quota pressure.
  lite.chatRooms = {};
  return lite;
}

const defaultState = {
  isLoggedIn: false,
  onboardingComplete: false,
  currentUser: null,
  // Pre-launch (post-migration 0012): everything user-facing starts empty
  // so the first paint never shows demo data. Supabase hydration will
  // fill these from real tables. The legacy MOCK_* arrays are kept above
  // for reference / fallback in pages that still scan them, but they are
  // intentionally NOT wired into defaultState anymore.
  users: [],
  parties: [],
  posts: [],
  questions: [],
  follows: [],
  sundayRatings: {},
  dailyPostCount: {},
  // Pairs already rewarded with the followConnection bonus, so unfollow→
  // refollow doesn't farm points. Keys are 'followerId>followingId'.
  awardedFollows: [],
  // ISO timestamp of the last time the user opened /notifications.
  // Anything newer than this counts as unread in the heart dot.
  lastNotificationsViewed: null,
  // Flips true the moment a chat_messages INSERT arrives via realtime
  // from someone other than the current user. The wall reads this to
  // paint a green dot on the chat icon. Cleared when the user opens any
  // chat route (chat-hub / chat-parties / chat-general / chat-party).
  hasUnreadChat: false,
  // Has the first Supabase hydration completed since this session?
  // Lets pages distinguish "no data yet because still loading" from
  // "no data because the table is genuinely empty" so we can render a
  // skeleton vs an empty-state accordingly. Never persisted to localStorage.
  hydrated: false,
  // Live chat rooms keyed by 'general' or `party:<id>`. Each value is an
  // array of message objects { id, userId, content, createdAt }. This is
  // local-only state for Phase 2; Phase 4 swaps it for chat_messages in
  // Supabase + Realtime broadcasts.
  chatRooms: {},
  currentPage: 'login',
  viewingUserId: null,
  viewingPartyId: null,
  selectedCity: 'Bogotá',
};

class Store {
  constructor() {
    this.listeners = [];
    this.purgeStaleStorage();   // free quota before we try to read/write
    this.state = this.loadState();
    this.cleanExpiredPosts();
  }

  // Earlier builds persisted to 'feedback_app_state' (no _v2 suffix). When
  // the key was bumped, the old one was orphaned — and it still holds
  // megabytes of base64 flyers/photos from past testing, filling the ~5MB
  // localStorage quota so even the tiny current state can't be written
  // (QuotaExceededError). That failure cascades: every setState retries the
  // write synchronously and stalls the main thread, which is what dragged
  // boot hydration out to ~20s. Drop every feedback_app_state* key that
  // isn't the one we're using now.
  purgeStaleStorage() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('feedback_app_state') && k !== STORAGE_KEY) {
          localStorage.removeItem(k);
        }
      }
    } catch { /* localStorage may be denied (private mode) */ }
  }

  // Diagnostic: which top-level state field is bloating serialization?
  // Only called when a quota error fires, so it costs nothing normally.
  logStateSizes() {
    try {
      const sizes = Object.entries(this.state)
        .map(([k, v]) => [k, JSON.stringify(v)?.length || 0])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, n]) => `${k}=${(n / 1024).toFixed(0)}KB`);
      console.warn('[store] biggest state fields:', sizes.join('  '));
    } catch { /* ignore */ }
  }

  loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Restore dates
        if (parsed.posts) {
          parsed.posts.forEach(p => {
            p.createdAt = new Date(p.createdAt);
            p.expiresAt = new Date(p.expiresAt);
          });
        }
        if (parsed.questions) {
          parsed.questions.forEach(q => {
            q.createdAt = new Date(q.createdAt);
          });
        }
        // Phase 3 migration: any cached parties/posts that still use the
        // legacy 'p1'..'p5' / 'post1'..'post6' string IDs would cause FK
        // violations against the UUID-keyed Supabase tables. Wipe them
        // so hydrateAll() repopulates with fresh server data.
        if (parsed.parties?.some(p => !isUuid(p.id))) {
          console.info('[store] legacy party IDs detected; clearing cached posts/parties');
          parsed.parties = [];
          parsed.posts = [];
        }
        if (parsed.posts?.some(p => !isUuid(p.partyId) || !isUuid(p.userId))) {
          parsed.posts = [];
        }
        // Same for chatRooms keys that reference legacy party IDs.
        if (parsed.chatRooms) {
          for (const key of Object.keys(parsed.chatRooms)) {
            if (key.startsWith('party:') && !isUuid(key.slice('party:'.length))) {
              delete parsed.chatRooms[key];
            }
          }
        }
        // Same for follows referencing legacy mock user IDs (u1-u6).
        if (parsed.follows?.some(f => /^u\d+$/.test(f.followingId) || /^u\d+$/.test(f.followerId))) {
          parsed.follows = parsed.follows.filter(
            f => isUuid(f.followingId) && isUuid(f.followerId)
          );
        }
        // Merge with defaults for new fields
        return { ...defaultState, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }
    return { ...defaultState };
  }

  saveState() {
    // If a prior write proved localStorage is unusable (persistent quota
    // failure), skip the local cache entirely. Re-trying setItem on every
    // single setState is what blocked the main thread and dragged boot
    // hydration to ~20s. Cloud sync below still persists the user's data.
    if (!this._cacheDisabled) {
      try {
        // Lightweight cache so refresh paints the wall instantly with the
        // last-known state. Caveats applied to stay well under the ~5MB
        // localStorage quota:
        //   * posts: cap at 50 most recent. Strip any base64 image data
        //     URLs (each can be MBs). Cap inline comments at 5/post.
        //   * users: store only fields the UI actually reads, drop big bio.
        //   * parties / follows: untouched, the lists are small.
        // Drop base64 data-URI images everywhere — a single camera photo
        // can be 12 MB and instantly blows the ~5 MB localStorage budget.
        const stripDataUri = (v) => (typeof v === 'string' && v.startsWith('data:') ? null : v);
        const persisted = {
          ...this.state,
          currentUser: this.state.currentUser
            ? { ...this.state.currentUser, avatar: stripDataUri(this.state.currentUser.avatar) }
            : null,
          posts: (this.state.posts || []).slice(0, 50).map(p => ({
            ...p,
            image: stripDataUri(p.image),
            comments: (p.comments || []).slice(-5),
          })),
          users: (this.state.users || []).map(u => ({
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            city: u.city,
            avatar: stripDataUri(u.avatar),
            tier: u.tier,
            premium: u.premium,
            points: u.points,
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch (e) {
        // QuotaExceededError almost always means base64 image data URLs
        // (party flyers, post photos) blew past the ~5-10 MB localStorage
        // budget. Drop the heavy fields and retry — better to lose a
        // local image preview than to corrupt every subsequent setState.
        const isQuota = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
        if (isQuota) {
          console.warn('[store] localStorage quota hit; purging stale keys + dropping heavy fields');
          this.logStateSizes();
          // Free space orphaned by previous key versions, then retry lean.
          this.purgeStaleStorage();
          try {
            const lite = pruneHeavyState(this.state);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
            // Match in-memory state to what we actually persisted so the
            // next setState doesn't re-inflate and re-throw.
            this.state.parties = lite.parties;
            this.state.posts = lite.posts;
            this.state.chatRooms = lite.chatRooms;
          } catch (retryErr) {
            // Still no room even after purge+prune. Stop hammering
            // localStorage on every setState — that synchronous retry loop
            // is what froze the UI. Cloud sync keeps the data safe.
            this._cacheDisabled = true;
            console.warn('[store] localStorage unusable; disabling local cache for this session', retryErr?.name);
          }
        } else {
          console.warn('Failed to save state', e);
        }
      }
    }
    // Mirror to Supabase so actions survive across devices/browsers.
    // Debouncing + no-op-on-no-config + sign-in check all live inside
    // queueCloudSave.
    if (!this._cloudSyncDisabled) {
      _queueCloudSave?.(this.state);
    }
  }

  getState() {
    return this.state;
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.saveState();
    this.notify();
  }

  /**
   * Hydrate the in-memory state from a remote blob (typically the user's
   * `user_app_state.state` from Supabase). Date strings get re-parsed
   * the same way `loadState` does for posts/questions.
   */
  hydrateFromCloud(cloud) {
    if (!cloud || typeof cloud !== 'object') return;

    // Revive Date instances on the few fields that need it.
    if (Array.isArray(cloud.posts)) {
      cloud.posts.forEach(p => {
        if (p.createdAt) p.createdAt = new Date(p.createdAt);
        if (p.expiresAt) p.expiresAt = new Date(p.expiresAt);
        if (Array.isArray(p.comments)) {
          p.comments.forEach(c => { if (c.createdAt) c.createdAt = new Date(c.createdAt); });
        }
      });
    }
    if (Array.isArray(cloud.questions)) {
      cloud.questions.forEach(q => { if (q.createdAt) q.createdAt = new Date(q.createdAt); });
    }

    // Cloud is authoritative — overlay it on top of the in-memory state.
    // currentUser is intentionally preserved (it comes from auth/profile).
    const { currentUser } = this.state;
    this._cloudSyncDisabled = true;
    try {
      this.state = { ...this.state, ...cloud, currentUser };
      this.saveState();      // mirror to localStorage too
      this.notify();
    } finally {
      this._cloudSyncDisabled = false;
    }
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  notify() {
    this.listeners.forEach(fn => fn(this.state));
  }

  resetState() {
    localStorage.removeItem(STORAGE_KEY);
    this.state = { ...defaultState };
    this.saveState();
    this.notify();
  }

  // --- Post helpers ---
  cleanExpiredPosts() {
    const now = new Date();
    this.state.posts = this.state.posts.filter(p => new Date(p.expiresAt) > now);
  }

  getUserPostsToday(userId) {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.state.posts.filter(p =>
      p.userId === userId &&
      new Date(p.createdAt).toISOString().split('T')[0] === todayStr
    ).length;
  }

  canUserPost(userId) {
    return this.getUserPostsToday(userId) < 5;
  }

  // Phase 3: posts are persisted to Supabase via _api. We still keep an
  // optimistic local row so the UI updates instantly; the api call runs
  // in the background, and on success we replace the temp row with the
  // real one (server-generated id, timestamps, etc).
  addPost(post) {
    const now = new Date();
    const expires = new Date(now);
    expires.setDate(expires.getDate() + 7);
    const tempId = 'pending_' + Date.now();
    // Snapshot the current user as the inline author so the wall card can
    // render the optimistic row even when state.users hasn't been hydrated
    // yet (boot race: pPosts can land before listProfiles populates the
    // users[] cache). Without this, the user's own pending post is the only
    // card that fails the author lookup and silently returns ''.
    const me = this.state.currentUser;
    const inlineAuthor = me ? {
      id: me.id,
      name: me.name,
      username: me.username,
      role: me.role,
      city: me.city,
      avatar: me.avatar,
      premium: me.premium,
      tier: me.tier,
      points: me.points,
    } : null;
    const newPost = {
      id: tempId,
      ...post,
      author: inlineAuthor,
      likes: 0,
      replies: 0,
      likedBy: [],
      comments: [],
      createdAt: now,
      expiresAt: expires,
      _pending: true,
    };
    this.state.posts = [newPost, ...this.state.posts];
    if (this.state.currentUser) {
      const userPostsInParty = this.state.posts.filter(
        p => p.userId === this.state.currentUser.id && p.partyId === post.partyId
      );
      if (userPostsInParty.length === 1) {
        this.addPoints(15, 'Primera publicación en fiesta');
      }
    }
    this.saveState();
    this.notify();

    // Async: persist to Supabase, then swap the optimistic row for the
    // server-truth row.
    if (_api?.createPost) {
      _api.createPost({ partyId: post.partyId, content: post.content, image: post.image })
        .then((real) => this._replacePost(tempId, real))
        .catch((err) => {
          // Detailed log so we can diagnose remotely (FK violation, RLS,
          // network, etc). Surface every relevant field — Supabase wraps
          // PostgREST errors in a specific shape.
          console.error('[store] createPost failed', {
            code: err?.code, message: err?.message,
            details: err?.details, hint: err?.hint,
            statusCode: err?.status, raw: err,
            partyId: post.partyId, userId: post.userId,
          });
          // Do NOT remove the optimistic post. The user still sees it
          // marked as "sync failed". Next boot will reconcile from
          // Supabase (failed posts vanish; successful ones stay).
          const p = this.state.posts.find(x => x.id === tempId);
          if (p) {
            p._pending = false;
            p._syncFailed = true;
            this.saveState();
            this.notify();
            repaintIfNeeded();
          }
          _surfaceError?.('No se sincronizó tu post. ' + describeApiError(err));
        });
    }
    return newPost;
  }

  _replacePost(tempId, real) {
    const idx = this.state.posts.findIndex(p => p.id === tempId);
    if (idx === -1) return;
    this.state.posts[idx] = real;
    this.saveState();
    this.notify();
    // Wall is not store-subscribed, so without this the .post-card-pending
    // class lingers in the DOM even though _pending: true is gone.
    repaintIfNeeded();
  }

  toggleLike(postId) {
    if (!this.state.currentUser) return;
    const post = this.state.posts.find(p => p.id === postId);
    if (!post) return;
    const uid = this.state.currentUser.id;
    const wasLiked = post.likedBy.includes(uid);

    // Optimistic local update first.
    if (wasLiked) {
      post.likedBy = post.likedBy.filter(id => id !== uid);
      post.likes--;
    } else {
      post.likedBy.push(uid);
      post.likes++;
    }
    this.saveState();
    this.notify();

    // Web push to the author — only on a NEW like (not unlike) and only
    // when the author isn't the current user. Fire-and-forget: errors
    // are swallowed inside notifyNewLike, so a push failure never
    // affects the like itself.
    if (!wasLiked && post.userId && post.userId !== uid) {
      notifyNewLike(post.userId, this.state.currentUser.username, postId);
    }

    // Then persist. Server is the source of truth; rollback on failure.
    if (_api?.toggleLike && !post._pending) {
      _api.toggleLike(postId).catch((err) => {
        console.error('[store] toggleLike failed', {
          code: err?.code, message: err?.message,
          details: err?.details, hint: err?.hint, raw: err,
          postId, wasLiked,
        });
        const p = this.state.posts.find(x => x.id === postId);
        if (!p) return;
        if (wasLiked) { p.likedBy.push(uid); p.likes++; }
        else { p.likedBy = p.likedBy.filter(id => id !== uid); p.likes--; }
        this.saveState();
        this.notify();
        _surfaceError?.('No se pudo dar like. ' + describeApiError(err));
      });
    }
  }

  // --- Comments ---
  addComment(postId, text) {
    if (!this.state.currentUser) return;
    const post = this.state.posts.find(p => p.id === postId);
    if (!post) return;
    if (!post.comments) post.comments = [];
    const tempId = 'pending_' + Date.now();
    const comment = {
      id: tempId,
      userId: this.state.currentUser.id,
      text,
      createdAt: new Date(),
      _pending: true,
    };
    post.comments.push(comment);
    post.replies = post.comments.length;
    this.saveState();
    this.notify();

    // Web push to the author — only when commenter is not the author.
    if (post.userId && post.userId !== this.state.currentUser.id) {
      notifyNewComment(post.userId, this.state.currentUser.username, postId);
    }

    if (_api?.addComment && !post._pending) {
      _api.addComment(postId, text)
        .then((real) => {
          const p = this.state.posts.find(x => x.id === postId);
          if (!p) return;
          const idx = (p.comments || []).findIndex(c => c.id === tempId);
          if (idx !== -1) p.comments[idx] = real;
          this.saveState();
          this.notify();
        })
        .catch((err) => {
          console.error('[store] addComment failed', {
            code: err?.code, message: err?.message,
            details: err?.details, hint: err?.hint, raw: err,
            postId,
          });
          // Keep the optimistic comment visible; mark as failed.
          const p = this.state.posts.find(x => x.id === postId);
          if (!p) return;
          const c = (p.comments || []).find(x => x.id === tempId);
          if (c) {
            c._pending = false;
            c._syncFailed = true;
          }
          this.saveState();
          this.notify();
          _surfaceError?.('No se sincronizó tu comentario. ' + describeApiError(err));
        });
    }
    return comment;
  }

  // --- Theme ---
  toggleTheme() {
    if (!this.state.currentUser) return;
    const current = this.state.currentUser.theme || 'dark';
    const newTheme = current === 'dark' ? 'light' : 'dark';
    this.state.currentUser.theme = newTheme;
    const user = this.state.users.find(u => u.id === this.state.currentUser.id);
    if (user) user.theme = newTheme;
    this.applyTheme(newTheme);
    this.saveState();
    this.notify();

    // Persist to Supabase profile so the preference follows the user
    // across devices and survives a localStorage wipe.
    if (_api?.patchProfileTheme) {
      _api.patchProfileTheme(newTheme).catch((err) =>
        console.warn('[store] theme persist failed', err));
    }
    return newTheme;
  }

  applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    // Mirror to a dedicated top-level key so the SYNC bootstrap in
    // main.js can apply the right theme before any async query runs.
    // This eliminates the "flash of wrong theme" on returning visits.
    try { localStorage.setItem('feedback.theme', t); } catch { /* noop */ }
  }

  // --- Points ---
  // `reason` kept in signature for activity-log forward-compat; not persisted yet.
  addPoints(amount, _reason) {
    if (!this.state.currentUser) return;
    this.state.currentUser.points = (this.state.currentUser.points || 0) + amount;
    const user = this.state.users.find(u => u.id === this.state.currentUser.id);
    if (user) user.points = this.state.currentUser.points;
    this.saveState();
    this.notify();
    return amount;
  }

  // --- Follows ---
  isFollowing(followerId, followingId) {
    return this.state.follows.some(f => f.followerId === followerId && f.followingId === followingId);
  }

  toggleFollow(targetId) {
    if (!this.state.currentUser) return { changed: false };
    const uid = this.state.currentUser.id;
    if (uid === targetId) return { changed: false };

    let awarded = false;
    let nowFollowing = false;
    let mutual = false;

    if (this.isFollowing(uid, targetId)) {
      // Unfollow — does NOT remove past mutual award, only deletes the
      // follow edge. No point deduction (see REGLAS §4).
      this.state.follows = this.state.follows.filter(
        f => !(f.followerId === uid && f.followingId === targetId)
      );
      nowFollowing = false;
    } else {
      this.state.follows.push({ followerId: uid, followingId: targetId, createdAt: new Date() });
      nowFollowing = true;

      // Mutual connection achieved only when the reverse edge also exists.
      // The order-independent pair key prevents double-awarding when the
      // second person of the pair triggers the mutuality.
      if (this.isFollowing(targetId, uid)) {
        mutual = true;
        const pairKey = [uid, targetId].sort().join('<>');
        if (!this.state.awardedFollows) this.state.awardedFollows = [];
        if (!this.state.awardedFollows.includes(pairKey)) {
          this.state.awardedFollows.push(pairKey);
          // +10 to current user (mirrored in users[])
          this.state.currentUser.points = (this.state.currentUser.points || 0) + 10;
          const me = this.state.users.find(u => u.id === uid);
          if (me) me.points = this.state.currentUser.points;
          // +10 to the other party
          const other = this.state.users.find(u => u.id === targetId);
          if (other) other.points = (other.points || 0) + 10;
          awarded = true;
        }
      }
    }

    this.saveState();
    this.notify();

    // Persist the follow toggle to Supabase. Mutual-award/points are still
    // computed locally — the cloud sync (user_app_state) carries awardedFollows
    // and points across devices for now. Phase 4 will move points to a ledger.
    if (_api?.toggleFollow && nowFollowing !== this.isFollowing(uid, targetId) === false) {
      // (intentional dual-check to ignore no-op calls)
    }
    if (_api?.toggleFollow) {
      _api.toggleFollow(targetId).catch((err) => console.warn('[store] toggleFollow failed', err));
    }

    // Web push to the followee — only when we just STARTED following
    // (no push on unfollow), fire-and-forget. Errors are swallowed
    // inside notifyNewFollower.
    if (nowFollowing) {
      notifyNewFollower(targetId, this.state.currentUser.username);
    }

    return { changed: true, nowFollowing, awarded, mutual };
  }

  getFollowerCount(userId) {
    return this.state.follows.filter(f => f.followingId === userId).length;
  }

  getFollowingCount(userId) {
    return this.state.follows.filter(f => f.followerId === userId).length;
  }

  // --- Parties ---
  getPartyById(id) {
    return this.state.parties.find(p => p.id === id);
  }

  getPartiesByCity(city) {
    if (!city || city === 'Todas') return this.state.parties;
    return this.state.parties.filter(p => p.city === city);
  }

  // Phase 3: filter by status, not by exact date. The Supabase-seeded
  // parties carry `party_date = current_date` from the moment migration
  // 0007 was run — that becomes stale the next day. Using `status`
  // (live / upcoming) keeps any non-finished party visible in the
  // "Lo que está pasando ahora" strip regardless of calendar date.
  getTodayParties(city) {
    return this.getPartiesByCity(city).filter(p => {
      const status = p.status || 'upcoming';
      return status !== 'finished';
    });
  }

  addParty(party) {
    const tempId = 'pending_' + Date.now();
    const newParty = {
      id: tempId,
      ...party,
      attendees: [],
      rating: {},
      reports: {},
      sponsored: false,
      _pending: true,
    };
    this.state.parties = [newParty, ...this.state.parties];
    this.saveState();
    this.notify();

    if (_api?.createParty) {
      _api.createParty(party)
        .then((real) => {
          // If the realtime echo beat us to it and already inserted the
          // real row, just drop the temp — otherwise replace in place.
          const realExists = this.state.parties.some(p => p.id === real.id);
          if (realExists) {
            this.state.parties = this.state.parties.filter(p => p.id !== tempId);
          } else {
            const idx = this.state.parties.findIndex(p => p.id === tempId);
            if (idx !== -1) this.state.parties[idx] = { ...real, attendees: [] };
          }
          this.saveState();
          this.notify();
        })
        .catch((err) => {
          console.warn('[store] createParty failed', err);
          this.state.parties = this.state.parties.filter(p => p.id !== tempId);
          this.saveState();
          this.notify();
        });
    }
    return newParty;
  }

  toggleAttendance(partyId) {
    if (!this.state.currentUser) return;
    const party = this.state.parties.find(p => p.id === partyId);
    if (!party) return;
    const uid = this.state.currentUser.id;
    const wasAttending = party.attendees.includes(uid);

    if (wasAttending) {
      party.attendees = party.attendees.filter(id => id !== uid);
    } else {
      party.attendees.push(uid);
      this.addPoints(20, 'Asistir a fiesta');
    }
    this.saveState();
    this.notify();

    if (_api?.toggleAttendance && !party._pending) {
      _api.toggleAttendance(partyId).catch((err) => {
        console.warn('[store] toggleAttendance failed', err);
        // Rollback optimistic change.
        const p = this.state.parties.find(x => x.id === partyId);
        if (!p) return;
        if (wasAttending) p.attendees.push(uid);
        else p.attendees = p.attendees.filter(id => id !== uid);
        this.saveState();
        this.notify();
      });
    }
  }

  // --- Questions ---
  addQuestion(targetUserId, questionText) {
    const q = {
      id: 'q_' + Date.now(),
      targetUserId,
      question: questionText,
      answer: null,
      anonymous: true,
      createdAt: new Date()
    };
    this.state.questions = [q, ...this.state.questions];
    this.saveState();
    this.notify();
    return q;
  }

  answerQuestion(questionId, answerText) {
    const q = this.state.questions.find(q => q.id === questionId);
    if (!q) return;
    q.answer = answerText;
    this.addPoints(5, 'Responder pregunta');
    this.saveState();
    this.notify();
  }

  getQuestionsForUser(userId) {
    return this.state.questions.filter(q => q.targetUserId === userId);
  }

  // --- Users ---
  getUserById(id) {
    return this.state.users.find(u => u.id === id);
  }

  searchUsers(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    return this.state.users.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.city.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }

  searchParties(query) {
    if (!query) return this.state.parties;
    const q = query.toLowerCase();
    return this.state.parties.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.venue.toLowerCase().includes(q) ||
      p.genres.some(g => g.toLowerCase().includes(q))
    );
  }

  // --- Notifications ---
  // Derived feed: aggregates follows you received, comments on your posts,
  // likes on your posts and questions sent to you, sorted by recency.
  // Items without timestamps (legacy seed data) collapse to "old" and
  // never contribute to the unread count.
  getNotifications() {
    const user = this.state.currentUser;
    if (!user) return [];
    const uid = user.id;
    const out = [];

    // Follows you received
    for (const f of this.state.follows) {
      if (f.followingId !== uid || f.followerId === uid) continue;
      const actor = this.getUserById(f.followerId);
      if (!actor) continue;
      out.push({
        id: `follow:${f.followerId}>${f.followingId}`,
        kind: 'follow',
        actor,
        time: f.createdAt ? new Date(f.createdAt) : null,
        text: 'empezó a seguirte',
        navigate: { route: 'profile-other', params: { userId: actor.id } },
      });
    }

    // Comments on your posts (excluding your own comments)
    for (const post of this.state.posts) {
      if (post.userId !== uid) continue;
      for (const c of (post.comments || [])) {
        if (c.userId === uid) continue;
        const actor = this.getUserById(c.userId);
        if (!actor) continue;
        const preview = c.text.length > 60 ? c.text.slice(0, 60) + '…' : c.text;
        out.push({
          id: `comment:${c.id}`,
          kind: 'comment',
          actor,
          time: new Date(c.createdAt),
          text: `comentó: "${preview}"`,
          navigate: { route: 'wall' },
        });
      }
    }

    // Likes on your posts (no per-like timestamp in legacy data — use the
    // post's createdAt as a coarse fallback so it doesn't all flood as "new")
    for (const post of this.state.posts) {
      if (post.userId !== uid) continue;
      for (const likerId of (post.likedBy || [])) {
        if (likerId === uid) continue;
        const actor = this.getUserById(likerId);
        if (!actor) continue;
        out.push({
          id: `like:${post.id}:${likerId}`,
          kind: 'like',
          actor,
          time: new Date(post.createdAt),
          text: 'le gustó tu publicación',
          navigate: { route: 'wall' },
        });
      }
    }

    // Your own posts that got auto-hidden by the report system (10+
    // reports → posts.hidden_at flipped server-side via the report_post
    // RPC). RLS keeps these rows visible only to you, the author.
    for (const post of this.state.posts) {
      if (post.userId !== uid) continue;
      if (!post.hiddenAt) continue;
      const preview = (post.content || '').length > 60
        ? post.content.slice(0, 60) + '…'
        : (post.content || 'tu publicación');
      out.push({
        id: `blocked:${post.id}`,
        kind: 'blocked',
        system: true,
        systemIcon: '🚫',
        actor: null,
        time: new Date(post.hiddenAt),
        text: `tu publicación fue ocultada por múltiples reportes: "${preview}"`,
        navigate: { route: 'profile' },
      });
    }

    // Anonymous questions sent to you
    for (const q of this.state.questions) {
      if (q.targetUserId !== uid) continue;
      const preview = q.question.length > 60 ? q.question.slice(0, 60) + '…' : q.question;
      out.push({
        id: `question:${q.id}`,
        kind: 'question',
        actor: null,                // anonymous
        anonymous: true,
        time: new Date(q.createdAt),
        text: q.answer
          ? `pregunta anónima respondida: "${preview}"`
          : `te hizo una pregunta anónima: "${preview}"`,
        navigate: { route: 'profile' },
      });
    }

    out.sort((a, b) => (b.time?.getTime() || 0) - (a.time?.getTime() || 0));
    return out;
  }

  getUnreadNotificationCount() {
    const last = this.state.lastNotificationsViewed
      ? new Date(this.state.lastNotificationsViewed).getTime()
      : 0;
    return this.getNotifications().filter(n => n.time && n.time.getTime() > last).length;
  }

  markNotificationsRead() {
    this.state.lastNotificationsViewed = new Date().toISOString();
    this.saveState();
    this.notify();
  }

  // --- Live chat (Phase 2: localStorage, Phase 4: Supabase Realtime) ---
  // Room keys: 'general' for the global room, `party:<partyId>` per fiesta.
  getChatMessages(roomKey) {
    if (!this.state.chatRooms) this.state.chatRooms = {};
    let msgs = this.state.chatRooms[roomKey];
    if (!msgs) {
      // Lazy-seed mock chatter so a brand-new room doesn't look dead.
      msgs = this._seedChatRoom(roomKey);
      this.state.chatRooms[roomKey] = msgs;
    }
    return msgs.map(m => ({ ...m, createdAt: new Date(m.createdAt) }));
  }

  sendChatMessage(roomKey, content) {
    if (!this.state.currentUser) return null;
    const text = (content || '').trim();
    if (!text) return null;
    if (!this.state.chatRooms) this.state.chatRooms = {};
    if (!this.state.chatRooms[roomKey]) this.state.chatRooms[roomKey] = [];
    const msg = {
      id: 'cm_' + Date.now() + Math.random().toString(36).slice(2, 6),
      userId: this.state.currentUser.id,
      content: text,
      createdAt: new Date().toISOString(),
    };
    this.state.chatRooms[roomKey].push(msg);
    this.saveState();
    this.notify();
    return { ...msg, createdAt: new Date(msg.createdAt) };
  }

  _seedChatRoom(roomKey) {
    const now = Date.now();
    const minsAgo = (m) => new Date(now - m * 60_000).toISOString();
    if (roomKey === 'general') {
      return [
        { id: 's1', userId: 'u2', content: '¿Quién va a NEXUS esta noche? 🔥',           createdAt: minsAgo(120) },
        { id: 's2', userId: 'u3', content: 'Nosotros estamos en PULSE, terraza brutal ✨', createdAt: minsAgo(95)  },
        { id: 's3', userId: 'u4', content: 'Cali activo! BASS CATHEDRAL 🎵',              createdAt: minsAgo(40)  },
        { id: 's4', userId: 'u1', content: 'Salgo en 20 min para el warehouse',           createdAt: minsAgo(15)  },
        { id: 's5', userId: 'u6', content: 'Tremenda vibra ya en la pista',               createdAt: minsAgo(5)   },
      ];
    }
    if (roomKey.startsWith('party:')) {
      const partyId = roomKey.slice('party:'.length);
      const party = this.getPartyById(partyId);
      if (!party) return [];
      const attendeeIds = party.attendees || [];
      const greetings = [
        '¡Ya en la entrada!',
        'Aquí adentro, el sonido está demasiado bien 🔊',
        '¿Alguien sabe a qué hora cierra?',
        'Súper buen ambiente 🔥',
      ];
      return attendeeIds.slice(0, 4).map((uid, i) => ({
        id: `seed-${partyId}-${i}`,
        userId: uid,
        content: greetings[i % greetings.length],
        createdAt: minsAgo(60 - i * 12),
      }));
    }
    return [];
  }

  getChatRoomTitle(roomKey) {
    if (roomKey === 'general') return 'Chat general';
    if (roomKey.startsWith('party:')) {
      const party = this.getPartyById(roomKey.slice('party:'.length));
      return party ? party.name : 'Chat de fiesta';
    }
    return 'Chat';
  }

  // --- AI Mock helpers ---
  // Returns a list of parties scored by attendance and live energy reports.
  // `_userId` reserved for future personalized recommendations.
  getRecommendedParties(_userId) {
    return [...this.state.parties].sort((a, b) => {
      const scoreA = a.attendees.length * 10 + (a.reports.energia || 0);
      const scoreB = b.attendees.length * 10 + (b.reports.energia || 0);
      return scoreB - scoreA;
    });
  }

  suggestPartyForPost() {
    // Mock AI: return today's parties sorted by relevance
    return this.getTodayParties(this.state.selectedCity);
  }

  detectDuplicate(name) {
    // Mock AI: simple similarity check
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.state.parties.find(p => {
      const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return pNorm === normalized || pNorm.includes(normalized) || normalized.includes(pNorm);
    });
  }
}

// Injection point for the cloud-sync hook. Avoids a static `import` of
// cloud-state.js (which would create a tree-shake-unfriendly cycle):
// cloud-state.js calls registerCloudSave(queueCloudSave) at import time,
// and saveState() invokes whatever's registered.
let _queueCloudSave = null;
export function registerCloudSave(fn) { _queueCloudSave = fn; }

// Same pattern for the Supabase data API. api.js calls registerApi at
// import time so the store can write through to Supabase without creating
// an import cycle (api.js → supabase.js, not via mock-data.js).
let _api = null;
export function registerApi(api) { _api = api; }

// Same pattern again for the toast helper — we can't import toast.js
// directly without a cycle (toast → dom utilities → ... → mock-data).
// main.js calls registerErrorSurface(showToast) so failed writes
// surface visibly instead of vanishing silently.
let _surfaceError = null;
export function registerErrorSurface(fn) { _surfaceError = fn; }

// Translate Supabase / Postgres error shapes into a single human line.
// Exported so chat.js / other pages can reuse the same vocabulary.
export function describeApiError(err) {
  if (!err) return 'Error desconocido.';
  // PostgREST errors usually carry .code, .message, .details
  const code = err.code || err.error || '';
  const msg  = err.message || err.error_description || String(err);
  if (code === '23503') return 'Referencia inválida (recarga la app).';
  if (code === '42501' || /row-level security|permission/i.test(msg)) {
    return 'Permiso denegado por el servidor.';
  }
  if (/network|fetch|timeout/i.test(msg)) return 'Sin conexión al servidor.';
  return msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
}

export const store = new Store();
export { formatRelative, isSunday };

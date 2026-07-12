// ============================================
// FEEDBACK — Mock Data & State Management
// ============================================

import { router } from '../router.js';
import {
  notifyNewLike,
  notifyNewComment,
  notifyCommentLike,
  notifyNewFollower,
  notifyQuestionAnswered,
  notifyQuestionReceived,
  notifyPartyAttendance,
} from '../notifications/notify.js';

// Repaint the visible page when state mutations matter to the UI but no
// component is subscribed. The wall doesn't subscribe to the store, so
// without this the optimistic-pending → real-post swap never updates the
// DOM (the post stays visibly "pending"/transparent until manual refresh).
// Scoped to data-driven routes so re-render is cheap and idempotent.
const UI_ROUTES_TO_REPAINT = new Set(['wall', 'parties', 'profile', 'profile-other', 'chats-private']);
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
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  barChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
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
  // Las conversaciones nunca se persisten (fotos de grupo/preview con
  // imagen son base64) — mismo criterio que el clon de saveState.
  lite.conversations = [];
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
  // Split unread flag — each flips true when a chat_messages INSERT
  // arrives from somebody else in the corresponding room type. The wall
  // shows a single green dot if EITHER is set; chat-hub shows a dot on
  // the specific card (general / parties) that has unread. Each flag is
  // cleared independently when the user enters that exact chat — not on
  // visiting the chat-hub landing or the parties list, which are just
  // navigation.
  hasUnreadChatGeneral: false,
  hasUnreadChatParty: false,
  // Per-party unread map: { [partyId]: true } for every party room that
  // has an unread message. Used by chat-parties to paint a green dot on
  // the specific row so the user knows WHICH party is buzzing, not just
  // that "some" party chat is. hasUnreadChatParty stays as the rolled-up
  // "any?" flag that powers the wall and chat-hub indicators.
  unreadChatRooms: {},
  // --- Mensajería privada (migración 0038) ---
  // Inbox de DMs + grupos, hidratado por listConversations() y mantenido
  // al día por el canal 'conversations-feed'. NUNCA se persiste: ni a
  // localStorage (el clon de saveState lo vacía — las fotos de grupo son
  // base64) ni al cloud blob (EXCLUDED_FROM_CLOUD) — vive en memoria +
  // servidor, como los mensajes de chat.
  conversations: [],
  // Flag ligero rolled-up para el badge del muro / chat-hub ("¿hay algún
  // hilo privado sin leer?"). Este SÍ persiste (boolean barato) para que
  // el dot sobreviva un reload mientras la hidratación lo re-deriva.
  hasUnreadConversations: false,
  // Deploy-before-migrate: true cuando listConversations() falla porque
  // la tabla aún no existe (0038 sin aplicar). chats-private lo usa para
  // distinguir "no tienes conversaciones" de "migración pendiente".
  conversationsUnavailable: false,
  // Flat log of every attendance event we know about. Used by
  // getNotifications() to surface "X confirmó asistencia" rows on the
  // promoter's notifications page. The same data is also folded into
  // each party.attendees[] for the cheap "is this user attending?"
  // checks elsewhere — keeping both shapes avoids reshaping every
  // existing `party.attendees.includes(uid)` call.
  attendanceLog: [],
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
  // Pestaña activa del muro ('fiestas' | 'remates'). Vive en el STORE y no
  // en el DOM ni en una variable de página: router.refreshCurrentRoute()
  // (hydration + realtime) re-renderiza el muro entero con currentParams,
  // así que cualquier selección de pestaña fuera del store se resetearía
  // en cada repaint. Persiste como string barato (igual que selectedCity).
  wallTab: 'fiestas',
};

class Store {
  constructor() {
    this.listeners = [];
    this.purgeStaleStorage();   // free quota before we try to read/write
    this.state = this.loadState();
    // cleanExpiredPosts() used to filter cached state.posts by
    // expiresAt > now() at every boot, in tandem with the RLS filter
    // on posts_read. Both were removed in migration 0018 (posts no
    // longer expire from the wall), so calling it here would only
    // hide legacy posts that the server is now happy to return.
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
        // partyId null es legítimo (posts libres de Remates) — solo un
        // partyId PRESENTE y no-UUID delata caché legacy.
        if (parsed.posts?.some(p => (p.partyId != null && !isUuid(p.partyId)) || !isUuid(p.userId))) {
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
        //   * parties: strip base64 flyers (a 1280px JPEG data URL can be
        //     ~2M chars = ~4MB as UTF-16 — ONE flyer can blow the iPhone's
        //     ~5MB quota; hydration re-fetches them every boot anyway).
        //   * follows: untouched, the list is small.
        // Drop base64 data-URI images everywhere — a single camera photo
        // can be 12 MB and instantly blows the ~5 MB localStorage budget.
        const stripDataUri = (v) => (typeof v === 'string' && v.startsWith('data:') ? null : v);
        const persisted = {
          ...this.state,
          currentUser: this.state.currentUser
            ? { ...this.state.currentUser, avatar: stripDataUri(this.state.currentUser.avatar) }
            : null,
          parties: (this.state.parties || []).map(p => (
            p.flyer && typeof p.flyer === 'string' && p.flyer.startsWith('data:')
              ? { ...p, flyer: null } : p
          )),
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
          // Conversaciones: NUNCA a localStorage. Las fotos de grupo y los
          // previews con imagen son base64 (quota) y el contenido privado
          // no debe quedar cacheado en el dispositivo — se rehidratan del
          // servidor en cada boot. OJO: esto es una COPIA; el invariante
          // sagrado de este método (ver el NOTE del catch de abajo) manda:
          // this.state.conversations queda intacto en memoria.
          conversations: [],
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
            // NOTE: do NOT copy `lite` back into this.state. Doing so nulled
            // the LIVE in-memory flyers/images right after hydration fetched
            // them — on iPhone (~5MB quota, so this catch fired every boot)
            // parties rendered the gradient placeholder forever. The normal
            // persisted path above now strips flyers/images anyway, so the
            // "re-inflate and re-throw" loop this guarded against is gone;
            // a cache-write failure must never degrade what's on screen.
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
  // (cleanExpiredPosts removed in migration 0018 — posts no longer
  // expire from the wall, so there's nothing to clean.)

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
      // Normalización 0037/0039 DESPUÉS del spread: la pestaña por defecto
      // es fiestas (posts legacy sin wall pintan ahí), partyId puede ser
      // null (post libre de remates) y 'video' gana si hay video adjunto.
      partyId: post.partyId || null,
      wall: post.wall === 'remates' ? 'remates' : 'fiestas',
      videoUrl: post.videoUrl || null,
      type: post.type || (post.videoUrl ? 'video' : (post.image ? 'photo' : 'text')),
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
      _api.createPost({
        partyId: newPost.partyId,
        content: post.content,
        image: post.image,
        wall: newPost.wall,
        videoUrl: newPost.videoUrl,
        type: newPost.type,
      })
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

  // --- Comment likes ---
  toggleCommentLike(postId, commentId) {
    if (!this.state.currentUser) return;
    const post = this.state.posts.find(p => p.id === postId);
    const comment = post?.comments?.find(c => c.id === commentId);
    if (!comment) return;
    // A still-pending comment has only a temp id; it can't be liked
    // server-side yet, so ignore the tap rather than desync.
    if (comment._pending) return;
    const uid = this.state.currentUser.id;
    if (!comment.likedBy) comment.likedBy = [];
    const wasLiked = comment.likedBy.includes(uid);

    // Optimistic local update first.
    if (wasLiked) {
      comment.likedBy = comment.likedBy.filter(id => id !== uid);
      comment.likes = Math.max(0, (comment.likes || 0) - 1);
    } else {
      comment.likedBy.push(uid);
      comment.likes = (comment.likes || 0) + 1;
    }
    this.saveState();
    this.notify();
    // Repaint the active feed (e.g. the wall behind the open comments
    // modal) — there's no wall store-subscription, so mutations repaint
    // explicitly, same as toggleAttendance / delete flows.
    repaintIfNeeded();

    // Push to the comment author — only on a NEW like and never to self.
    // Fire-and-forget (errors swallowed inside notifyCommentLike).
    if (!wasLiked && comment.userId && comment.userId !== uid) {
      notifyCommentLike(comment.userId, this.state.currentUser.username, commentId, postId);
    }

    // Persist; server is source of truth, rollback on failure.
    if (_api?.toggleCommentLike) {
      _api.toggleCommentLike(commentId).catch((err) => {
        console.error('[store] toggleCommentLike failed', {
          code: err?.code, message: err?.message, commentId, wasLiked,
        });
        const p = this.state.posts.find(x => x.id === postId);
        const c = p?.comments?.find(x => x.id === commentId);
        if (!c) return;
        if (!c.likedBy) c.likedBy = [];
        if (wasLiked) { c.likedBy.push(uid); c.likes = (c.likes || 0) + 1; }
        else { c.likedBy = c.likedBy.filter(id => id !== uid); c.likes = Math.max(0, (c.likes || 0) - 1); }
        this.saveState();
        this.notify();
        repaintIfNeeded();
        _surfaceError?.('No se pudo dar like al comentario. ' + describeApiError(err));
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
      likedBy: [],
      likes: 0,
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
          // The real row swaps in the like button (hidden while _pending);
          // repaint so it appears without waiting for the next action.
          repaintIfNeeded();
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
  // Optimistic local bump for instant UI feedback, THEN persist the delta
  // to Supabase (profiles.points) via the award_points RPC. profiles.points
  // is what syncProfileIntoStore() reads on every boot, so without the
  // server write the bump below is wiped on the next reload — that was the
  // "points never add up" bug. On success we reconcile to the server's
  // authoritative total (corrects any prior drift); on failure we roll the
  // optimistic bump back so the UI never shows points that didn't land.
  addPoints(amount, reason) {
    if (!this.state.currentUser) return;
    const mirror = (val) => {
      this.state.currentUser.points = val;
      const u = this.state.users.find(x => x.id === this.state.currentUser.id);
      if (u) u.points = val;
    };

    mirror((this.state.currentUser.points || 0) + amount);
    this.saveState();
    this.notify();

    if (_api?.awardPoints) {
      _api.awardPoints(amount, reason)
        .then(total => {
          if (typeof total !== 'number' || !this.state.currentUser) return;
          // Common case: server total === optimistic value → nothing to
          // repaint. Only reconcile (and re-render) when they diverge,
          // e.g. another device awarded points since the last sync.
          if (total === this.state.currentUser.points) return;
          mirror(total);
          this.saveState();
          this.notify();
        })
        .catch(err => {
          console.warn('[store] awardPoints persist failed', err);
          if (!this.state.currentUser) return;
          mirror(Math.max(0, (this.state.currentUser.points || 0) - amount));
          this.saveState();
          this.notify();
        });
    }
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
          // +10 to the other party — LOCAL ONLY. RLS forbids writing
          // another user's profiles.points row from the client, so this
          // bump is cosmetic on this device; their authoritative total is
          // untouched and will be correct from their own profiles row. A
          // future follows trigger could award both sides server-side.
          const other = this.state.users.find(u => u.id === targetId);
          if (other) other.points = (other.points || 0) + 10;
          awarded = true;
          // +10 to the current user — persisted to Supabase like every
          // other award. addPoints() handles the optimistic bump, the
          // users[] mirror, saveState/notify and the server write.
          this.addPoints(10, 'Conexión mutua');
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
      // Normalización 0037 tras el spread: el temp row lleva kind y
      // boletería explícitos para que el filtro por pestaña y el
      // echo-swap del realtime vean el mismo shape que partyFromRow.
      kind: party.kind === 'remate' ? 'remate' : 'party',
      ticketContactUrl: party.ticketContactUrl || null,
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
          // Con remates cualquier usuario crea eventos: el fallo (RLS,
          // mute, migración pendiente) debe verse, no evaporarse.
          _surfaceError?.('No se pudo crear el evento. ' + describeApiError(err));
        });
    }
    return newParty;
  }

  // Edit / delete a party. Creator-only is enforced server-side by RLS
  // (parties_update_owner / parties_delete_owner in migration 0003);
  // the UI also gates the buttons behind a creator check, so these
  // helpers can assume the caller is authorized.
  updateParty(partyId, patch) {
    const idx = this.state.parties.findIndex(p => p.id === partyId);
    if (idx === -1) return;
    const prev = this.state.parties[idx];
    // Optimistic merge — keep attendees/_pending/etc that aren't in patch.
    this.state.parties[idx] = { ...prev, ...patch };
    this.saveState();
    this.notify();

    if (_api?.updateParty) {
      _api.updateParty(partyId, patch)
        .then((real) => {
          const i = this.state.parties.findIndex(p => p.id === partyId);
          if (i !== -1) {
            // Server may have normalized values (trimmed strings, etc);
            // adopt them but keep the local attendees list intact.
            this.state.parties[i] = { ...real, attendees: prev.attendees };
            this.saveState();
            this.notify();
          }
        })
        .catch((err) => {
          console.warn('[store] updateParty failed', err);
          const i = this.state.parties.findIndex(p => p.id === partyId);
          if (i !== -1) {
            this.state.parties[i] = prev;
            this.saveState();
            this.notify();
          }
          _surfaceError?.('No se pudo actualizar el evento. ' + describeApiError(err));
        });
    }
  }

  deleteParty(partyId) {
    const removed = this.state.parties.find(p => p.id === partyId);
    if (!removed) return;
    this.state.parties = this.state.parties.filter(p => p.id !== partyId);
    this.saveState();
    this.notify();

    if (_api?.deleteParty) {
      _api.deleteParty(partyId).catch((err) => {
        console.warn('[store] deleteParty failed', err);
        // Rollback — restore at its original index isn't worth tracking;
        // prepending is good enough for UX and the next hydration will
        // reorder by party_date anyway.
        this.state.parties = [removed, ...this.state.parties];
        this.saveState();
        this.notify();
        _surfaceError?.('No se pudo eliminar el evento. ' + describeApiError(err));
      });
    }
  }

  toggleAttendance(partyId) {
    if (!this.state.currentUser) return;
    const party = this.state.parties.find(p => p.id === partyId);
    if (!party) return;
    const uid = this.state.currentUser.id;
    const wasAttending = party.attendees.includes(uid);

    if (wasAttending) {
      party.attendees = party.attendees.filter(id => id !== uid);
      // Drop the matching attendance-log entry so the promoter's
      // notification list mirrors reality on cancel.
      this.state.attendanceLog = (this.state.attendanceLog || []).filter(
        x => !(x.partyId === partyId && x.userId === uid)
      );
    } else {
      party.attendees.push(uid);
      this.addPoints(20, 'Asistir a fiesta');
      // Prepend a fresh log entry so it shows on top of the promoter's
      // notifications. Realtime later overwrites attendedAt with the
      // server's authoritative timestamp.
      this.state.attendanceLog = [
        { partyId, userId: uid, attendedAt: new Date() },
        ...(this.state.attendanceLog || []),
      ];
    }
    this.saveState();
    this.notify();

    if (_api?.toggleAttendance && !party._pending) {
      _api.toggleAttendance(partyId)
        .then(() => {
          // Push only on the BECOMING-attending transition. If the
          // promoter is the guest themselves (rare but possible during
          // testing) we skip to avoid self-pinging.
          if (!wasAttending && party.promotor && party.promotor !== uid) {
            notifyPartyAttendance(party.promotor, this.state.currentUser?.username, partyId);
          }
        })
        .catch((err) => {
          console.warn('[store] toggleAttendance failed', err);
          // Rollback optimistic change in BOTH places.
          const p = this.state.parties.find(x => x.id === partyId);
          if (!p) return;
          if (wasAttending) {
            p.attendees.push(uid);
            this.state.attendanceLog = [
              { partyId, userId: uid, attendedAt: new Date() },
              ...(this.state.attendanceLog || []),
            ];
          } else {
            p.attendees = p.attendees.filter(id => id !== uid);
            this.state.attendanceLog = (this.state.attendanceLog || []).filter(
              x => !(x.partyId === partyId && x.userId === uid)
            );
          }
          this.saveState();
          this.notify();
        });
    }
  }

  // --- Questions ---
  // Persisted to Supabase via _api (see api.js / migration 0017). The
  // local optimistic row carries `_pending: true` and gets swapped for
  // the real row when the API call returns, exactly like addPost.
  addQuestion(targetUserId, questionText) {
    if (!this.state.currentUser) return null;
    const tempId = 'pending_q_' + Date.now();
    const tempQ = {
      id: tempId,
      targetUserId,
      askerId: this.state.currentUser.id,
      question: questionText,
      answer: null,
      anonymous: true,
      createdAt: new Date(),
      answeredAt: null,
      _pending: true,
    };
    this.state.questions = [tempQ, ...this.state.questions];
    this.saveState();
    this.notify();

    if (_api?.createQuestion) {
      _api.createQuestion(targetUserId, questionText)
        .then(real => {
          this._replaceQuestion(tempId, real);
          // Push the target: a new anonymous question arrived. Fire-and-
          // forget (errors swallowed in notify.js). Uses the REAL server id
          // so send-push's verifyRelationship can confirm asker→target.
          if (real?.id) notifyQuestionReceived(targetUserId, this.state.currentUser?.username, real.id);
        })
        .catch(err => {
          console.error('[store] createQuestion failed', err);
          // Drop the temp row — without a server id the question can't
          // ever surface on the target's device, so keeping it locally
          // would lie to the asker.
          this.state.questions = this.state.questions.filter(q => q.id !== tempId);
          this.saveState();
          this.notify();
          _surfaceError?.('No se pudo enviar la pregunta. ' + describeApiError(err));
        });
    }
    return tempQ;
  }

  _replaceQuestion(tempId, real) {
    const idx = this.state.questions.findIndex(q => q.id === tempId);
    if (idx === -1) return;
    this.state.questions[idx] = real;
    this.saveState();
    this.notify();
    repaintIfNeeded();
  }

  answerQuestion(questionId, answerText) {
    const q = this.state.questions.find(q => q.id === questionId);
    if (!q) return;
    // Optimistic answer + points (kept even if API fails, then reverted).
    const prevAnswer = q.answer;
    const prevAnsweredAt = q.answeredAt;
    q.answer = answerText;
    q.answeredAt = new Date();
    this.addPoints(5, 'Responder pregunta');
    this.saveState();
    this.notify();

    if (_api?.answerQuestion) {
      _api.answerQuestion(questionId, answerText)
        .then(() => {
          // Push notification to the ORIGINAL asker so they hear about
          // the answer in real time. Fire-and-forget — errors swallowed
          // inside notify.js; the in-app notification feed (derived
          // from state.questions) is the durable source of truth and
          // doesn't depend on the push landing.
          if (q.askerId && q.askerId !== this.state.currentUser?.id) {
            notifyQuestionAnswered(q.askerId, this.state.currentUser?.username, questionId);
          }
        })
        .catch(err => {
          console.error('[store] answerQuestion failed', err);
          // Revert the optimistic update + the points.
          q.answer = prevAnswer;
          q.answeredAt = prevAnsweredAt;
          this.addPoints(-5, 'Reversión respuesta');
          this.saveState();
          this.notify();
          _surfaceError?.('No se pudo guardar la respuesta. ' + describeApiError(err));
        });
    }
  }

  // Optimistic delete (target removing a harassing/unwanted question).
  // RLS questions_delete (0017) restricts the server-side DELETE to the
  // question's target; pending temp rows never reached the server so
  // they're dropped locally without an API call.
  deleteQuestion(questionId) {
    const removed = this.state.questions.find(q => q.id === questionId);
    if (!removed) return;
    this.state.questions = this.state.questions.filter(q => q.id !== questionId);
    this.saveState();
    this.notify();

    if (_api?.deleteQuestion && !removed._pending) {
      _api.deleteQuestion(questionId)
        .catch(err => {
          console.error('[store] deleteQuestion failed', err);
          // Restore the row — the server still has it — and repaint so
          // the list matches the restored state (same pattern as
          // _replaceQuestion; notify() alone has no subscribers).
          this.state.questions = [removed, ...this.state.questions];
          this.saveState();
          this.notify();
          repaintIfNeeded();
          _surfaceError?.('No se pudo eliminar la pregunta. ' + describeApiError(err));
        });
    }
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
        // Land directly on the Questions tab of the user's own profile
        // so they can answer in one tap. The profile route reads
        // params.tab to decide which tab to activate on render.
        navigate: { route: 'profile', params: { tab: 'questions' } },
      });
    }

    // Answers to questions YOU asked. The asker knows who they asked
    // (they picked them), so the target is shown as the actor here —
    // no anonymity to preserve on this side. Time uses answered_at so
    // the notification surfaces when the answer landed, not when the
    // question was originally sent.
    for (const q of this.state.questions) {
      if (q.askerId !== uid) continue;
      if (!q.answer) continue;
      const target = this.getUserById(q.targetUserId);
      if (!target) continue;
      const preview = q.question.length > 60 ? q.question.slice(0, 60) + '…' : q.question;
      out.push({
        id: `question-answered:${q.id}`,
        kind: 'question-answered',
        actor: target,
        time: q.answeredAt ? new Date(q.answeredAt) : null,
        text: `respondió tu pregunta: "${preview}"`,
        // Land on the answerer's profile, Questions tab, so the asker
        // sees the full Q&A in context (answered questions are public
        // there, including their own anonymous one).
        navigate: {
          route: 'profile-other',
          params: { userId: target.id, tab: 'questions' },
        },
      });
    }

    // Guests confirming attendance to parties YOU created. Iterates the
    // attendanceLog (timestamped, populated by hydration + realtime +
    // toggleAttendance) and surfaces an item per RSVP. Skips own RSVPs
    // and rows whose party isn't in state yet (race during hydration).
    for (const a of (this.state.attendanceLog || [])) {
      if (a.userId === uid) continue;
      const party = this.state.parties.find(p => p.id === a.partyId);
      if (!party || party.promotor !== uid) continue;
      const actor = this.getUserById(a.userId);
      if (!actor) continue;
      out.push({
        id: `attend:${a.partyId}:${a.userId}`,
        kind: 'party-attendance',
        actor,
        time: a.attendedAt ? new Date(a.attendedAt) : null,
        text: `confirmó asistencia a "${party.name}"`,
        // Tap lands on the party detail so the promoter can see the
        // updated attendee count + the in-context info.
        navigate: { route: 'party-detail', params: { partyId: a.partyId } },
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

  // --- Mensajería privada (DMs + grupos, migración 0038) ---
  // El store solo guarda la METADATA del inbox (state.conversations); los
  // mensajes de cada hilo viven page-scoped en la página, como chat.js.
  // Los DMs NO entran a getNotifications(): su señal es push + unread.
  getConversationById(id) {
    return (this.state.conversations || []).find(c => c.id === id);
  }

  // Recomputa el flag rolled-up del badge. Los hilos silenciados no
  // encienden el badge global (es justo lo que promete el mute) aunque
  // conserven su dot por-fila.
  _recomputeUnreadConversations(list = this.state.conversations) {
    return (list || []).some(c => c.unread && !c.muted);
  }

  // Método ligero para el realtime y la página del hilo: refresca el
  // preview (lastMessage), reordena el inbox por actividad y, con
  // { unread: true }, marca el hilo y enciende hasUnreadConversations.
  touchConversation(conversationId, message, { unread = false } = {}) {
    const list = this.state.conversations || [];
    const conv = list.find(c => c.id === conversationId);
    if (!conv) return;
    if (message) {
      conv.lastMessage = message;
      conv.lastMessageAt = message.createdAt instanceof Date
        ? message.createdAt
        : new Date(message.createdAt || Date.now());
    }
    if (unread) conv.unread = true;
    const sorted = [...list].sort(
      (a, b) => (b.lastMessageAt?.getTime?.() || 0) - (a.lastMessageAt?.getTime?.() || 0)
    );
    const partial = { conversations: sorted };
    if (unread && !conv.muted && !this.state.hasUnreadConversations) {
      partial.hasUnreadConversations = true;
    }
    this.setState(partial);
  }

  // Enviar mensaje vía store: SOLO toca la metadata del inbox de forma
  // optimista y delega en la api (que dispara el push ella misma, así el
  // hilo — que llama api.sendConversationMessage directo — no lo duplica).
  // Devuelve la promesa del mensaje real (null si falla; el error ya se
  // surfaceó con toast).
  sendConversationMessage(conversationId, { content, image, videoUrl } = {}) {
    if (!this.state.currentUser) return Promise.resolve(null);
    const conv = this.getConversationById(conversationId);
    const prevLast = conv?.lastMessage || null;
    const prevAt = conv?.lastMessageAt || null;
    if (conv) {
      this.touchConversation(conversationId, {
        id: 'pending_' + Date.now(),
        conversationId,
        userId: this.state.currentUser.id,
        content: (content || '').trim() || null,
        image: image || null,
        videoUrl: videoUrl || null,
        createdAt: new Date(),
        _pending: true,
      });
    }
    if (!_api?.sendConversationMessage) return Promise.resolve(null);
    return _api.sendConversationMessage(conversationId, { content, image, videoUrl })
      .then((real) => {
        if (real) this.touchConversation(conversationId, real);
        return real;
      })
      .catch((err) => {
        console.error('[store] sendConversationMessage failed', {
          code: err?.code, message: err?.message, conversationId,
        });
        // Rollback de la metadata optimista (el hilo maneja su buffer).
        const c = this.getConversationById(conversationId);
        if (c) {
          c.lastMessage = prevLast;
          c.lastMessageAt = prevAt;
          this.setState({ conversations: [...this.state.conversations] });
          repaintIfNeeded();
        }
        _surfaceError?.('No se pudo enviar el mensaje. ' + describeApiError(err));
        return null;
      });
  }

  // Mute optimista con rollback (afecta solo el push server-side y el
  // badge; el usuario sigue viendo el hilo normalmente).
  toggleConversationMute(conversationId) {
    const conv = this.getConversationById(conversationId);
    if (!conv) return;
    const meId = this.state.currentUser?.id;
    const next = !conv.muted;
    const apply = (val) => {
      conv.muted = val;
      const m = conv.members?.find(x => x.userId === meId);
      if (m) m.muted = val;
      this.setState({
        conversations: [...this.state.conversations],
        hasUnreadConversations: this._recomputeUnreadConversations(),
      });
      repaintIfNeeded();
    };
    apply(next);

    if (_api?.setConversationMuted) {
      _api.setConversationMuted(conversationId, next).catch((err) => {
        console.warn('[store] setConversationMuted failed', err);
        apply(!next);
        _surfaceError?.('No se pudo cambiar el silencio. ' + describeApiError(err));
      });
    }
  }

  // Marcar leído: optimista sin rollback — un read-marker fallido es
  // benigno (el servidor lo re-deriva en la próxima hidratación).
  markConversationRead(conversationId) {
    const conv = this.getConversationById(conversationId);
    if (!conv) return;
    const now = new Date();
    conv.unread = false;
    conv.lastReadAt = now;
    const meId = this.state.currentUser?.id;
    const m = conv.members?.find(x => x.userId === meId);
    if (m) m.lastReadAt = now;
    this.setState({
      conversations: [...this.state.conversations],
      hasUnreadConversations: this._recomputeUnreadConversations(),
    });

    if (_api?.markConversationRead) {
      _api.markConversationRead(conversationId)
        .catch((err) => console.warn('[store] markConversationRead failed', err));
    }
  }

  // Abrir (o reusar) un DM con otro usuario. Sin optimismo: navegamos al
  // hilo con el uuid REAL que devuelve la RPC (dedupe por dm_key).
  async createDM(otherUserId) {
    if (!_api?.createDM) return null;
    try {
      const id = await _api.createDM(otherUserId);
      await this._ensureConversationInStore(id);
      return id;
    } catch (err) {
      console.error('[store] createDM failed', err);
      _surfaceError?.('No se pudo abrir el chat. ' + describeApiError(err));
      return null;
    }
  }

  async createGroup({ title, photo, memberIds } = {}) {
    if (!_api?.createGroup) return null;
    try {
      const id = await _api.createGroup({ title, photo, memberIds });
      await this._ensureConversationInStore(id);
      return id;
    } catch (err) {
      console.error('[store] createGroup failed', err);
      _surfaceError?.('No se pudo crear el grupo. ' + describeApiError(err));
      return null;
    }
  }

  async addGroupMembers(conversationId, memberIds) {
    if (!_api?.addGroupMembers) return false;
    try {
      await _api.addGroupMembers(conversationId, memberIds);
      // Re-fetch de la cabecera para refrescar members[] con lo que el
      // servidor realmente aceptó (duplicados/inexistentes se descartan).
      await this._ensureConversationInStore(conversationId, { forceRefresh: true });
      return true;
    } catch (err) {
      console.error('[store] addGroupMembers failed', err);
      _surfaceError?.('No se pudieron añadir miembros. ' + describeApiError(err));
      return false;
    }
  }

  // Salir del hilo — optimista con rollback (reaparece si el DELETE falla).
  leaveConversation(conversationId) {
    const conv = this.getConversationById(conversationId);
    if (!conv) return;
    const remaining = (this.state.conversations || []).filter(c => c.id !== conversationId);
    this.setState({
      conversations: remaining,
      hasUnreadConversations: this._recomputeUnreadConversations(remaining),
    });
    repaintIfNeeded();

    if (_api?.leaveConversation) {
      _api.leaveConversation(conversationId).catch((err) => {
        console.warn('[store] leaveConversation failed', err);
        const restored = [conv, ...(this.state.conversations || [])].sort(
          (a, b) => (b.lastMessageAt?.getTime?.() || 0) - (a.lastMessageAt?.getTime?.() || 0)
        );
        this.setState({
          conversations: restored,
          hasUnreadConversations: this._recomputeUnreadConversations(restored),
        });
        repaintIfNeeded();
        _surfaceError?.('No se pudo salir de la conversación. ' + describeApiError(err));
      });
    }
  }

  // Nombre / foto del grupo — optimista con rollback (RLS: solo owner).
  updateGroupMeta(conversationId, patch = {}) {
    const conv = this.getConversationById(conversationId);
    if (!conv) return;
    const prev = { title: conv.title, photo: conv.photo };
    if (patch.title !== undefined) conv.title = patch.title;
    if (patch.photo !== undefined) conv.photo = patch.photo;
    this.setState({ conversations: [...this.state.conversations] });
    repaintIfNeeded();

    if (_api?.updateGroupMeta) {
      _api.updateGroupMeta(conversationId, patch)
        .then((real) => {
          if (!real) return;
          const c = this.getConversationById(conversationId);
          if (!c) return;
          c.title = real.title;
          c.photo = real.photo;
          this.setState({ conversations: [...this.state.conversations] });
        })
        .catch((err) => {
          console.warn('[store] updateGroupMeta failed', err);
          const c = this.getConversationById(conversationId);
          if (c) {
            c.title = prev.title;
            c.photo = prev.photo;
            this.setState({ conversations: [...this.state.conversations] });
            repaintIfNeeded();
          }
          _surfaceError?.('No se pudo actualizar el grupo. ' + describeApiError(err));
        });
    }
  }

  // Trae la cabecera de un hilo al store si falta (post-create_dm/grupo o
  // tras mutar members). Falla en silencio: la hidratación lo reconcilia.
  async _ensureConversationInStore(conversationId, { forceRefresh = false } = {}) {
    if (!conversationId || !_api?.getConversation) return;
    const existing = this.getConversationById(conversationId);
    if (existing && !forceRefresh) return;
    try {
      const conv = await _api.getConversation(conversationId);
      if (!conv) return;
      const rest = (this.state.conversations || []).filter(c => c.id !== conversationId);
      const sorted = [conv, ...rest].sort(
        (a, b) => (b.lastMessageAt?.getTime?.() || 0) - (a.lastMessageAt?.getTime?.() || 0)
      );
      this.setState({ conversations: sorted });
    } catch (err) {
      console.warn('[store] _ensureConversationInStore failed', err);
    }
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
  // Deploy-before-migrate: tabla/columna/RPC que el servidor aún no tiene
  // (migraciones 0037-0039 pendientes de correr a mano). PGRST204/42703 =
  // columna, PGRST205/42P01 = tabla, PGRST202 = función RPC.
  if (code === 'PGRST204' || code === 'PGRST205' || code === 'PGRST202'
      || code === '42703' || code === '42P01'
      || /schema cache/i.test(msg)) {
    return 'Función aún no disponible (actualización del servidor pendiente).';
  }
  if (/network|fetch|timeout/i.test(msg)) return 'Sin conexión al servidor.';
  return msg.length > 80 ? msg.slice(0, 80) + '...' : msg;
}

export const store = new Store();
export { formatRelative, isSunday };

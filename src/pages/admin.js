// ============================================
// FEEDBACK — Super-admin panel (SUPERUSUARIO)
// ============================================
// FASE 1 shipped the Papelera. FASE 2 adds the full panel:
//   Usuarios · Notificaciones · Papelera · Moderación · Q&A
//
// SECURITY: reachable only via the isAdmin-gated button; re-checks
// currentUserIsAdmin() on entry. Every action calls an is_admin-gated
// SECURITY DEFINER RPC or a service-role-verified Edge Function — the UI
// gate is cosmetic. A forced non-admin sees empty data and can do nothing.

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { sanitize } from '../utils/helpers.js';
import { currentUserIsAdmin, confirmAdminDelete } from '../utils/admin-moderation.js';
import {
  listModerationLog, adminRestore,
  adminListUsers, adminSetRole, adminSetModeration, adminAnonymizeUser,
  adminModerateUser, adminDeleteUser, adminBroadcast, listAdminBroadcasts,
  listAdminReports, listAdminTickets, setTicketStatus, adminSoftDeletePost,
  listQuestions, answerQuestion, adminSoftDeleteQuestion,
  getProfileNames, listAllUserIds, listPartyAttendeeIds, adminAskQuestion,
} from '../data/api.js';

const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena'];
const TYPE_LABEL = { post: 'Publicación', comment: 'Comentario', chat_message: 'Mensaje de chat', question: 'Pregunta', party: 'Fiesta' };

const TABS = [
  { id: 'usuarios',      label: '👥 Usuarios' },
  { id: 'notificaciones', label: '🔔 Notificaciones' },
  { id: 'papelera',      label: '🗑️ Papelera' },
  { id: 'moderacion',    label: '🚩 Moderación' },
  { id: 'qa',            label: '❓ Q&A' },
];

export function renderAdmin(container) {
  if (!currentUserIsAdmin()) { router.navigate('wall'); return; }

  container.innerHTML = `
    <div class="page" id="admin-page">
      <button class="back-btn" id="admin-back">${ICONS.back}<span>Perfil</span></button>
      <div class="page-title" style="display:flex;align-items:center;gap:8px;">
        <span style="width:22px;height:22px;display:inline-flex;color:#dc2626;">${ICONS.shield}</span>
        Panel · Super-admin
      </div>
      <div class="tab-bar" id="admin-tabs" style="margin:var(--space-sm) 0 var(--space-md);display:flex;flex-wrap:nowrap;gap:2px;">
        ${TABS.map(t => `<button class="tab-item" type="button" data-tab="${t.id}" style="flex:1 1 0;min-width:0;padding:7px 3px;font-size:clamp(0.55rem,2.5vw,0.72rem);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.label}</button>`).join('')}
      </div>
      <div id="admin-content"></div>
    </div>
  `;

  container.querySelector('#admin-back').addEventListener('click', () => router.navigate('profile'));

  const tabsEl = container.querySelector('#admin-tabs');
  const contentEl = container.querySelector('#admin-content');

  function selectTab(t) {
    tabsEl.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    contentEl.innerHTML = loadingHTML();
    const fn = { usuarios: renderUsers, notificaciones: renderNotify, papelera: renderTrash, moderacion: renderModeration, qa: renderQA }[t];
    fn(contentEl);
  }
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) selectTab(b.dataset.tab);
  });

  selectTab('usuarios');
}

function loadingHTML() {
  return `<div class="empty-state"><div class="spinner" style="margin:0 auto var(--space-md);"></div><p class="empty-state-text">Cargando…</p></div>`;
}
function emptyHTML(icon, title, text) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><h3 class="empty-state-title">${title}</h3><p class="empty-state-text">${text}</p></div>`;
}
function errorHTML(text) {
  return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p class="empty-state-text">${sanitize(text)}</p></div>`;
}
function card(inner, faded = false) {
  return `<div style="background:var(--surface,rgba(255,255,255,0.04));border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm);${faded ? 'opacity:0.55;' : ''}">${inner}</div>`;
}

// =====================================================================
// USUARIOS
// =====================================================================
async function renderUsers(el) {
  el.innerHTML = `
    <input type="text" class="input" id="u-search" placeholder="Buscar nombre / @usuario / correo…" style="width:100%;margin-bottom:6px;" />
    <div style="display:flex;gap:6px;margin-bottom:var(--space-sm);">
      <select class="input" id="u-role" style="flex:1;">
        <option value="">Rol: todos</option><option value="raver">raver</option><option value="dj">dj</option><option value="promotor">promotor</option>
      </select>
      <select class="input" id="u-status" style="flex:1;">
        <option value="">Estado: todos</option><option value="active">activo</option><option value="muted">muteado</option><option value="banned">baneado</option>
      </select>
    </div>
    <div id="u-list">${loadingHTML()}</div>
  `;
  const listEl = el.querySelector('#u-list');
  const searchEl = el.querySelector('#u-search');
  const roleEl = el.querySelector('#u-role');
  const statusEl = el.querySelector('#u-status');

  let timer = null;
  async function load() {
    // A pending debounce timer or in-flight request may resolve after the
    // admin switched tabs — don't query/write into a detached element.
    if (!document.contains(listEl)) return;
    listEl.innerHTML = loadingHTML();
    try {
      const users = await adminListUsers({
        search: searchEl.value.trim() || null,
        role: roleEl.value || null,
        status: statusEl.value || null,
        limit: 100,
      });
      if (!document.contains(listEl)) return;
      if (!users.length) { listEl.innerHTML = emptyHTML('👥', 'Sin usuarios', 'No hay usuarios que coincidan.'); return; }
      listEl.innerHTML = users.map(userRow).join('');
    } catch (err) {
      if (!document.contains(listEl)) return;
      listEl.innerHTML = errorHTML('No se pudo cargar la lista de usuarios.');
      console.warn('[admin] listUsers', err);
    }
  }
  const debounced = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  searchEl.addEventListener('input', debounced);
  roleEl.addEventListener('change', load);
  statusEl.addEventListener('change', load);

  // Delegated actions on the list.
  listEl.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-act="role"]');
    if (!sel) return;
    const userId = sel.dataset.userId;
    const role = sel.value;
    try { await adminSetRole(userId, role); showToast(`Rol → ${role}`, 'success'); }
    catch (err) { showToast('No se pudo cambiar el rol.', 'error'); console.warn('[admin] setRole', err); load(); }
  });
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const userId = btn.dataset.userId;
    const name = btn.dataset.name || 'este usuario';
    if (act === 'mute') {
      confirmAdminDelete({ title: 'Mutear usuario', message: `<strong>${sanitize(name)}</strong> no podrá publicar, comentar ni chatear (sí puede leer).`, confirmLabel: 'Mutear', errorLabel: 'No se pudo mutear.', durationField: true,
        onConfirm: async (reason, days) => {
          const until = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
          await adminSetModeration(userId, 'muted', reason, until); showToast('Usuario muteado', 'success'); load();
        } });
    } else if (act === 'unmute') {
      confirmAdminDelete({ title: 'Reactivar usuario', message: `Quitar el muteo a <strong>${sanitize(name)}</strong>.`, confirmLabel: 'Reactivar', errorLabel: 'No se pudo reactivar.',
        onConfirm: async () => { await adminSetModeration(userId, 'active'); showToast('Usuario reactivado', 'success'); load(); } });
    } else if (act === 'ban') {
      confirmAdminDelete({ title: 'Banear usuario', message: `<strong>${sanitize(name)}</strong> no podrá iniciar sesión ni escribir. (Bloqueo de login + escritura.)`, confirmLabel: 'Banear', errorLabel: 'No se pudo banear.', durationField: true,
        onConfirm: async (reason, days) => { await adminModerateUser(userId, 'ban', { reason, durationDays: days || null }); showToast('Usuario baneado', 'success'); load(); } });
    } else if (act === 'unban') {
      confirmAdminDelete({ title: 'Desbanear usuario', message: `Restaurar el acceso de <strong>${sanitize(name)}</strong>.`, confirmLabel: 'Desbanear', errorLabel: 'No se pudo desbanear.',
        onConfirm: async () => { await adminModerateUser(userId, 'unban'); showToast('Usuario desbaneado', 'success'); load(); } });
    } else if (act === 'anonymize') {
      confirmAdminDelete({ title: 'Anonimizar usuario', message: `Se borran los datos personales de <strong>${sanitize(name)}</strong> (nombre, @usuario, bio, avatar). Sus publicaciones quedan como "Usuario eliminado". La cuenta sigue existiendo.`, confirmLabel: 'Anonimizar', errorLabel: 'No se pudo anonimizar.',
        onConfirm: async () => { await adminAnonymizeUser(userId); showToast('Usuario anonimizado', 'success'); load(); } });
    } else if (act === 'delete') {
      confirmAdminDelete({ title: 'Eliminar cuenta (definitivo)', message: `⚠️ Borra la cuenta de <strong>${sanitize(name)}</strong> y TODO su contenido, sin restauración. Para anonimizar (reversible) usá "Anonimizar".`, confirmLabel: 'Eliminar definitivamente', errorLabel: 'No se pudo eliminar la cuenta.',
        onConfirm: async () => { await adminDeleteUser(userId); showToast('Cuenta eliminada', 'success'); load(); } });
    }
  });

  load();
}

function statusBadge(s) {
  if (s === 'banned') return '<span class="badge" style="background:rgba(220,38,38,0.18);color:#dc2626;">baneado</span>';
  if (s === 'muted') return '<span class="badge" style="background:rgba(234,179,8,0.18);color:#a16207;">muteado</span>';
  return '';
}

function userRow(u) {
  const me = store.getState().currentUser?.id;
  const isSelf = u.id === me;
  const protectedRow = u.is_admin || isSelf;
  // Effective status: a temporary sanction whose moderation_until has passed
  // is already lifted server-side (is_muted/is_banned auto-expire) even
  // though the column still reads muted/banned — reflect that here so the
  // badge + action buttons match reality.
  const rawStatus = u.moderation_status || 'active';
  const expired = rawStatus !== 'active' && u.moderation_until && new Date(u.moderation_until) <= new Date();
  const status = expired ? 'active' : rawStatus;
  const untilDate = (status !== 'active' && u.moderation_until) ? new Date(u.moderation_until) : null;
  const untilLabel = untilDate ? `hasta ${untilDate.toLocaleDateString()}` : (status !== 'active' ? 'permanente' : '');
  const roleSelect = protectedRow
    ? `<span class="badge">${sanitize(u.role)}</span>`
    : `<select class="input" data-act="role" data-user-id="${u.id}" style="width:auto;padding:4px 8px;font-size:var(--text-xs);text-align:center;text-align-last:center;">
         ${['raver', 'dj', 'promotor'].map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
       </select>`;

  let actions = '';
  if (protectedRow) {
    actions = `<span style="font-size:var(--text-xs);color:var(--text-tertiary);">${u.is_admin ? '🛡️ admin' : 'tú'}</span>`;
  } else {
    const bd = `data-user-id="${u.id}" data-name="${sanitize(u.name || u.username || '')}"`;
    const btn = (act, label, extra = '') => `<button class="btn btn-secondary btn-sm" data-act="${act}" ${bd} style="${extra}">${label}</button>`;
    const modBtns = status === 'banned'
      ? btn('unban', 'Desbanear')
      : status === 'muted'
        ? btn('unmute', 'Reactivar') + btn('ban', 'Banear', 'color:#dc2626;')
        : btn('mute', 'Mutear') + btn('ban', 'Banear', 'color:#dc2626;');
    actions = `${modBtns}${btn('anonymize', 'Anonimizar')}${btn('delete', 'Eliminar', 'color:#dc2626;')}`;
  }

  return card(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;font-size:var(--text-sm);">${sanitize(u.name || '—')} ${statusBadge(status)}${untilLabel ? ` <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-weight:400;">${sanitize(untilLabel)}</span>` : ''}</div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${sanitize(u.username || '')} · ${sanitize(u.email || '')}</div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${u.points ?? 0} pts · ${sanitize(u.city || '')}</div>
      </div>
      <div style="flex-shrink:0;">${roleSelect}</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${actions}</div>
  `);
}

// =====================================================================
// NOTIFICACIONES
// =====================================================================
async function renderNotify(el) {
  const parties = store.getState().parties || [];
  el.innerHTML = `
    <div class="input-group mb-md"><label class="input-label">Título</label><input type="text" class="input" id="n-title" maxlength="120" /></div>
    <div class="input-group mb-md"><label class="input-label">Mensaje</label><textarea class="input textarea" id="n-body" maxlength="500" style="min-height:80px;"></textarea></div>
    <div class="input-group mb-md">
      <label class="input-label">¿A dónde lleva al tocarla?</label>
      <select class="input" id="n-url">
        <option value="/#/notifications">Notificaciones</option>
        <option value="/#/wall">Muro</option>
        <option value="/#/parties">Fiestas</option>
        <option value="/#/chats">Chats</option>
        <option value="/#/profile">Mi perfil</option>
      </select>
    </div>
    <div class="input-group mb-md">
      <label class="input-label">Canales</label>
      <div style="display:flex;gap:16px;">
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="n-push" checked /> Push</label>
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="n-email" /> Correo</label>
      </div>
    </div>
    <div class="input-group mb-md">
      <label class="input-label">Destinatarios</label>
      <select class="input" id="n-target">
        <option value="all">Todos</option>
        <option value="role">Por rol</option>
        <option value="city">Por ciudad</option>
        <option value="party">Por fiesta (asistentes)</option>
        <option value="user">Usuarios (uno o varios)</option>
      </select>
      <div id="n-target-value" style="margin-top:8px;"></div>
    </div>
    <div id="n-count" style="font-size:var(--text-sm);color:var(--text-secondary);margin-bottom:var(--space-sm);"></div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" id="n-dry" style="flex:1;">Calcular alcance</button>
      <button class="btn btn-primary" id="n-send" style="flex:1;">Enviar</button>
    </div>

    <div style="border-top:1px solid var(--border-subtle);margin:var(--space-lg) 0 var(--space-md);"></div>
    <h3 style="font-size:var(--text-md);font-weight:700;margin-bottom:var(--space-sm);">📜 Historial de notificaciones</h3>
    <div id="n-history">${loadingHTML()}</div>
  `;

  const targetEl = el.querySelector('#n-target');
  const valueWrap = el.querySelector('#n-target-value');
  const selectedUsers = []; // for the 'user' target — one or many picks
  let userSearchTimer = null;
  function renderValueInput() {
    const t = targetEl.value;
    if (t === 'all') { valueWrap.innerHTML = ''; return; }
    if (t === 'role') { valueWrap.innerHTML = `<select class="input" id="n-value"><option value="raver">raver</option><option value="dj">dj</option><option value="promotor">promotor</option></select>`; return; }
    if (t === 'city') { valueWrap.innerHTML = `<select class="input" id="n-value">${CITIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`; return; }
    if (t === 'party') { valueWrap.innerHTML = `<select class="input" id="n-value">${parties.map(p => `<option value="${p.id}">${sanitize(p.name)}</option>`).join('') || '<option value="">(sin fiestas)</option>'}</select>`; return; }

    // user → multi-select by name: search, click to ADD, chips to remove.
    // readPayload() reads the selectedUsers array (no pasting UUIDs).
    selectedUsers.length = 0;
    valueWrap.innerHTML = `
      <input type="text" class="input" id="n-user-search" placeholder="Buscar y agregar usuarios…" autocomplete="off" />
      <div id="n-user-results" style="max-height:200px;overflow-y:auto;margin-top:4px;"></div>
      <div id="n-user-chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;"></div>
    `;
    const searchInput = valueWrap.querySelector('#n-user-search');
    const results = valueWrap.querySelector('#n-user-results');
    const chips = valueWrap.querySelector('#n-user-chips');
    const renderChips = () => {
      chips.innerHTML = selectedUsers.map(u =>
        `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface,rgba(255,255,255,0.08));border:1px solid var(--border-subtle);border-radius:var(--radius-full);padding:3px 8px;font-size:var(--text-xs);">${sanitize(u.name)} <button type="button" data-remove="${u.id}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;line-height:1;">✕</button></span>`
      ).join('');
    };
    searchInput.addEventListener('input', () => {
      clearTimeout(userSearchTimer);
      userSearchTimer = setTimeout(async () => {
        const q = searchInput.value.trim();
        if (!q) { results.innerHTML = ''; return; }
        try {
          const users = await adminListUsers({ search: q, limit: 8 });
          results.innerHTML = users.map(u =>
            `<button type="button" class="btn btn-secondary btn-sm" data-uid="${u.id}" data-uname="${sanitize(u.name || u.username || '')}" style="display:block;width:100%;text-align:left;margin-bottom:4px;">${sanitize(u.name || '—')} · ${sanitize(u.username || '')}</button>`
          ).join('') || '<div style="font-size:var(--text-xs);color:var(--text-tertiary);">Sin resultados</div>';
        } catch (err) { results.innerHTML = ''; console.warn('[admin] user search', err); }
      }, 300);
    });
    results.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-uid]');
      if (!btn) return;
      const id = btn.dataset.uid;
      if (!selectedUsers.some(u => u.id === id)) selectedUsers.push({ id, name: btn.dataset.uname || '—' });
      searchInput.value = '';
      results.innerHTML = '';
      renderChips();
    });
    chips.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      const idx = selectedUsers.findIndex(u => u.id === rm.dataset.remove);
      if (idx >= 0) selectedUsers.splice(idx, 1);
      renderChips();
    });
  }
  targetEl.addEventListener('change', renderValueInput);
  renderValueInput();

  function readPayload() {
    const title = el.querySelector('#n-title').value.trim();
    const body = el.querySelector('#n-body').value.trim();
    const url = el.querySelector('#n-url').value.trim() || undefined;
    const push = el.querySelector('#n-push').checked;
    const email = el.querySelector('#n-email').checked;
    const type = targetEl.value;
    const value = type === 'user'
      ? selectedUsers.map(u => u.id)
      : (el.querySelector('#n-value')?.value || undefined);
    return { title, body, url, channels: { push, email }, target: { type, value } };
  }
  function validate(p) {
    if (!p.title || !p.body) { showToast('Título y mensaje son obligatorios.', 'error'); return false; }
    if (!p.channels.push && !p.channels.email) { showToast('Elegí al menos un canal.', 'error'); return false; }
    if (p.target.type === 'user') {
      if (!Array.isArray(p.target.value) || p.target.value.length === 0) { showToast('Elegí al menos un usuario.', 'error'); return false; }
    } else if (p.target.type !== 'all' && !p.target.value) { showToast('Falta el destinatario.', 'error'); return false; }
    if (p.url && !p.url.startsWith('/#/')) { showToast('El enlace debe empezar con /#/', 'error'); return false; }
    return true;
  }

  el.querySelector('#n-dry').addEventListener('click', async () => {
    const p = readPayload();
    if (!validate(p)) return;
    el.querySelector('#n-count').textContent = 'Calculando…';
    try {
      const r = await adminBroadcast({ ...p, dryRun: true });
      el.querySelector('#n-count').textContent = `Alcance: ${r.recipients} usuarios · ${r.push?.subscriptions ?? 0} dispositivos push · ${r.email?.addresses ?? 0} correos.`;
    } catch (err) { el.querySelector('#n-count').textContent = ''; showToast('No se pudo calcular el alcance.', 'error'); console.warn('[admin] broadcast dry', err); }
  });

  el.querySelector('#n-send').addEventListener('click', async () => {
    const p = readPayload();
    if (!validate(p)) return;
    confirmAdminDelete({
      title: 'Enviar notificación',
      message: `Se enviará "<strong>${sanitize(p.title)}</strong>" a los destinatarios seleccionados. ¿Confirmar?`,
      confirmLabel: 'Enviar',
      errorLabel: 'No se pudo enviar la notificación.',
      onConfirm: async () => {
        const r = await adminBroadcast(p);
        showToast(`Enviado: ${r.push?.sent ?? 0} push, ${r.email?.sent ?? 0} correos.`, 'success', 5000);
        const hist = el.querySelector('#n-history');
        if (hist) loadBroadcastHistory(hist);
      },
    });
  });

  loadBroadcastHistory(el.querySelector('#n-history'));
}

const N_TARGET_LABEL = { all: 'Todos', role: 'Por rol', city: 'Por ciudad', party: 'Por fiesta', user: 'Usuarios' };

function broadcastHistoryItem(b) {
  const channels = [];
  if (b.channels?.push) channels.push('push');
  if (b.channels?.email) channels.push('correo');
  const stats = [`${b.recipients} destinatario${b.recipients === 1 ? '' : 's'}`];
  if (b.pushSent) stats.push(`${b.pushSent} push`);
  if (b.emailSent) stats.push(`${b.emailSent} correo${b.emailSent === 1 ? '' : 's'}`);
  return card(`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-weight:600;font-size:var(--text-sm);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sanitize(b.title)}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);flex-shrink:0;">${formatRelative(b.createdAt)}</span>
    </div>
    <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.45;word-break:break-word;white-space:pre-wrap;margin-bottom:8px;">${sanitize(b.body)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
      <span class="badge">${sanitize(N_TARGET_LABEL[b.targetType] || b.targetType)}</span>
      ${channels.length ? `<span style="font-size:var(--text-xs);color:var(--text-tertiary);">${channels.join(' + ')}</span>` : ''}
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);">· ${stats.join(' · ')}</span>
    </div>
  `);
}

async function loadBroadcastHistory(el) {
  if (!el) return;
  el.innerHTML = loadingHTML();
  try {
    const list = await listAdminBroadcasts();
    if (!document.contains(el)) return;
    if (!list.length) { el.innerHTML = emptyHTML('🔔', 'Sin envíos', 'Las notificaciones que envíes aparecerán aquí con sus detalles.'); return; }
    el.innerHTML = list.map(broadcastHistoryItem).join('');
  } catch (err) {
    if (!document.contains(el)) return;
    el.innerHTML = errorHTML('No se pudo cargar el historial de notificaciones.');
    console.warn('[admin] broadcast history', err);
  }
}

// =====================================================================
// PAPELERA
// =====================================================================
async function renderTrash(el) {
  let entries = [];
  try { entries = await listModerationLog(); }
  catch (err) { el.innerHTML = errorHTML('No se pudo cargar la papelera.'); console.warn('[admin] trash', err); return; }

  const deletions = entries.filter(e => e.action === 'soft_delete');
  if (!deletions.length) { el.innerHTML = emptyHTML('🗑️', 'Papelera vacía', 'Lo que elimines aparecerá aquí para restaurarlo.'); return; }

  // Resolve the owner of each deleted item (from its before_state snapshot)
  // so every card says whose content it was. Names not already cached in the
  // store are fetched in one chunked call.
  const ownerIds = [...new Set(deletions.map(e => ownerOf(e).id).filter(Boolean))];
  const uncached = ownerIds.filter(id => !store.getUserById(id));
  const nameMap = uncached.length ? await getProfileNames(uncached).catch(() => ({})) : {};
  if (!document.contains(el)) return;
  const nameOf = (id) => { const u = store.getUserById(id); return u ? (u.name || u.username || 'Usuario') : (nameMap[id] || 'Usuario'); };

  el.innerHTML = deletions.map(e => trashItem(e, nameOf)).join('');
  el.onclick = async (e) => {
    const btn = e.target.closest('[data-restore-log]');
    if (!btn) return;
    btn.disabled = true;
    try { await adminRestore(btn.dataset.restoreLog); showToast('Restaurado ✓', 'success'); renderTrash(el); }
    catch (err) { btn.disabled = false; const m = String(err?.message || ''); showToast(m.includes('already_restored') ? 'Ya estaba restaurado.' : 'No se pudo restaurar.', 'error'); console.warn('[admin] restore', err); }
  };
}

// Who the deleted content belonged to, read from the before_state snapshot
// (raw DB columns). Label adapts per type.
function ownerOf(entry) {
  const b = entry.beforeState || {};
  switch (entry.targetType) {
    case 'post':
    case 'comment':
    case 'chat_message': return { id: b.user_id || null, label: 'De' };
    case 'party':        return { id: b.promoter_id || null, label: 'Organiza' };
    case 'question':     return { id: b.target_user_id || null, label: 'Dirigida a' };
    default:             return { id: null, label: 'De' };
  }
}
function previewOf(entry) {
  const b = entry.beforeState || {};
  let t = '';
  switch (entry.targetType) {
    case 'post': case 'comment': case 'chat_message': t = b.content; break;
    case 'question': t = b.question; break;
    case 'party': t = b.name; break;
  }
  t = (t || '').toString().trim();
  if (!t) return '(sin vista previa)';
  return t.length > 140 ? t.slice(0, 140) + '…' : t;
}
function trashItem(entry, nameOf) {
  const label = TYPE_LABEL[entry.targetType] || entry.targetType;
  const restored = !!entry.restoredAt;
  const owner = ownerOf(entry);
  const ownerName = owner.id && nameOf ? nameOf(owner.id) : null;
  return card(`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <span class="badge">${sanitize(label)}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);flex-shrink:0;">${formatRelative(entry.createdAt)}</span>
    </div>
    ${ownerName ? `<div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:6px;">${owner.label}: <strong style="color:var(--text-secondary);font-weight:600;">${sanitize(ownerName)}</strong></div>` : ''}
    <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.45;word-break:break-word;padding:8px 10px;background:rgba(255,255,255,0.03);border-left:2px solid var(--border-subtle);border-radius:6px;margin-bottom:${entry.reason ? '6px' : '10px'};">${sanitize(previewOf(entry))}</div>
    ${entry.reason ? `<div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:10px;">Motivo: ${sanitize(entry.reason)}</div>` : ''}
    <div style="display:flex;justify-content:flex-end;">
      ${restored
        ? `<span style="font-size:var(--text-xs);color:#16a34a;font-weight:600;">Restaurado ✓</span>`
        : `<button class="btn btn-secondary btn-sm" data-restore-log="${entry.id}">Restaurar</button>`}
    </div>
  `, restored);
}

// =====================================================================
// MODERACIÓN — reportes + tickets de soporte
// =====================================================================
async function renderModeration(el) {
  el.innerHTML = `<div id="m-reports">${loadingHTML()}</div><h3 style="margin:var(--space-lg) 0 var(--space-sm);font-size:var(--text-md);font-weight:700;">🎟️ Tickets de soporte</h3><div id="m-tickets">${loadingHTML()}</div>`;
  const reportsEl = el.querySelector('#m-reports');
  const ticketsEl = el.querySelector('#m-tickets');

  // ---- Reports (grouped by post) ----
  try {
    const reports = await listAdminReports();
    if (!reports.length) {
      reportsEl.innerHTML = `<h3 style="margin:0 0 var(--space-sm);font-size:var(--text-md);font-weight:700;">🚩 Reportes</h3>` + emptyHTML('✅', 'Sin reportes', 'No hay publicaciones reportadas.');
    } else {
      const byPost = {};
      for (const r of reports) { (byPost[r.post_id] ||= []).push(r); }
      const items = Object.entries(byPost).map(([postId, rs]) => card(`
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span class="badge" style="background:rgba(220,38,38,0.18);color:#dc2626;">${rs.length} reporte${rs.length > 1 ? 's' : ''}</span>
          <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(new Date(rs[0].created_at))}</span>
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:8px;">Post ${postId.slice(0, 8)}… · Razones: ${sanitize([...new Set(rs.map(r => r.reason))].join(', '))}</div>
        <button class="btn btn-sm" data-del-post="${postId}" style="color:#dc2626;">Eliminar publicación</button>
      `)).join('');
      reportsEl.innerHTML = `<h3 style="margin:0 0 var(--space-sm);font-size:var(--text-md);font-weight:700;">🚩 Reportes</h3>` + items;
    }
  } catch (err) { reportsEl.innerHTML = errorHTML('No se pudieron cargar los reportes.'); console.warn('[admin] reports', err); }

  reportsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-post]');
    if (!btn) return;
    const postId = btn.dataset.delPost;
    confirmAdminDelete({ title: 'Eliminar publicación reportada', message: 'Se ocultará para todos y queda en la papelera.', confirmLabel: 'Eliminar',
      onConfirm: async (reason) => { await adminSoftDeletePost(postId, reason); showToast('Publicación eliminada', 'success'); renderModeration(el); } });
  });

  // ---- Tickets ----
  try {
    const tickets = await listAdminTickets();
    if (!tickets.length) { ticketsEl.innerHTML = emptyHTML('📭', 'Sin tickets', 'No hay tickets de soporte.'); }
    else {
      ticketsEl.innerHTML = tickets.map(t => card(`
        <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <span style="font-weight:600;font-size:var(--text-sm);">${sanitize(t.name)} <span class="badge" style="${t.status === 'closed' ? 'background:rgba(22,163,74,0.18);color:#16a34a;' : ''}">${sanitize(t.status)}</span></span>
          <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(new Date(t.created_at))}</span>
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:6px;">${sanitize(t.email)}</div>
        <div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.4;white-space:pre-wrap;margin-bottom:8px;">${sanitize(t.message)}</div>
        ${t.status === 'closed'
          ? `<button class="btn btn-sm" data-ticket="${t.id}" data-status="open">Reabrir</button>`
          : `<button class="btn btn-secondary btn-sm" data-ticket="${t.id}" data-status="closed">Marcar resuelto</button>`}
      `, t.status === 'closed')).join('');
    }
  } catch (err) { ticketsEl.innerHTML = errorHTML('No se pudieron cargar los tickets.'); console.warn('[admin] tickets', err); }

  ticketsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ticket]');
    if (!btn) return;
    btn.disabled = true;
    try { await setTicketStatus(btn.dataset.ticket, btn.dataset.status); showToast('Ticket actualizado', 'success'); renderModeration(el); }
    catch (err) { btn.disabled = false; showToast('No se pudo actualizar el ticket.', 'error'); console.warn('[admin] ticket', err); }
  });
}

// =====================================================================
// Q&A — bandeja de FeedBack + moderación global
// =====================================================================
async function renderQA(el) {
  const meId = store.getState().currentUser?.id;
  const parties = store.getState().parties || [];
  el.innerHTML = `
    <div style="background:var(--surface,rgba(255,255,255,0.04));border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-md);">
      <div style="font-weight:700;margin-bottom:8px;">Hacer una pregunta</div>
      <textarea class="input textarea" id="qa-ask-text" maxlength="500" placeholder="Escribe la pregunta…" style="min-height:56px;margin-bottom:8px;"></textarea>
      <select class="input" id="qa-ask-target" style="margin-bottom:8px;">
        <option value="all">A todos</option>
        <option value="party">Por fiesta (asistentes)</option>
        <option value="people">A personas</option>
      </select>
      <div id="qa-ask-value" style="margin-bottom:8px;"></div>
      <button class="btn btn-primary btn-sm" id="qa-ask-send">Enviar pregunta</button>
    </div>

    <div class="tab-bar" id="qa-sub" style="margin-bottom:var(--space-md);">
      <button class="tab-item active" type="button" data-sub="mine">Para FeedBack</button>
      <button class="tab-item" type="button" data-sub="all">Todas</button>
    </div>
    <div id="qa-content">${loadingHTML()}</div>
  `;

  // ---- Composer: ask a question to all / a party's attendees / people ----
  const askTargetEl = el.querySelector('#qa-ask-target');
  const askValueWrap = el.querySelector('#qa-ask-value');
  const askPeople = [];
  let askSearchTimer = null;
  function renderAskValue() {
    const t = askTargetEl.value;
    if (t === 'all') { askValueWrap.innerHTML = ''; return; }
    if (t === 'party') { askValueWrap.innerHTML = `<select class="input" id="qa-ask-party">${parties.map(p => `<option value="${p.id}">${sanitize(p.name)}</option>`).join('') || '<option value="">(sin fiestas)</option>'}</select>`; return; }
    askPeople.length = 0;
    askValueWrap.innerHTML = `
      <input type="text" class="input" id="qa-ask-search" placeholder="Buscar y agregar personas…" autocomplete="off" />
      <div id="qa-ask-results" style="max-height:180px;overflow-y:auto;margin-top:4px;"></div>
      <div id="qa-ask-chips" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;"></div>
    `;
    const s = askValueWrap.querySelector('#qa-ask-search');
    const res = askValueWrap.querySelector('#qa-ask-results');
    const chips = askValueWrap.querySelector('#qa-ask-chips');
    const paintChips = () => { chips.innerHTML = askPeople.map(u => `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface,rgba(255,255,255,0.08));border:1px solid var(--border-subtle);border-radius:var(--radius-full);padding:3px 8px;font-size:var(--text-xs);">${sanitize(u.name)} <button type="button" data-remove="${u.id}" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;line-height:1;">✕</button></span>`).join(''); };
    s.addEventListener('input', () => {
      clearTimeout(askSearchTimer);
      askSearchTimer = setTimeout(async () => {
        const q = s.value.trim();
        if (!q) { res.innerHTML = ''; return; }
        try {
          const users = await adminListUsers({ search: q, limit: 8 });
          res.innerHTML = users.map(u => `<button type="button" class="btn btn-secondary btn-sm" data-uid="${u.id}" data-uname="${sanitize(u.name || u.username || '')}" style="display:block;width:100%;text-align:left;margin-bottom:4px;">${sanitize(u.name || '—')} · ${sanitize(u.username || '')}</button>`).join('') || '<div style="font-size:var(--text-xs);color:var(--text-tertiary);">Sin resultados</div>';
        } catch { res.innerHTML = ''; }
      }, 300);
    });
    res.addEventListener('click', (e) => { const b = e.target.closest('[data-uid]'); if (!b) return; const id = b.dataset.uid; if (!askPeople.some(u => u.id === id)) askPeople.push({ id, name: b.dataset.uname || '—' }); s.value = ''; res.innerHTML = ''; paintChips(); });
    chips.addEventListener('click', (e) => { const rm = e.target.closest('[data-remove]'); if (!rm) return; const i = askPeople.findIndex(u => u.id === rm.dataset.remove); if (i >= 0) askPeople.splice(i, 1); paintChips(); });
  }
  askTargetEl.addEventListener('change', renderAskValue);
  renderAskValue();

  el.querySelector('#qa-ask-send').addEventListener('click', async () => {
    const text = el.querySelector('#qa-ask-text').value.trim();
    if (!text) { showToast('Escribe la pregunta.', 'error'); return; }
    const t = askTargetEl.value;
    let ids = [];
    try {
      if (t === 'all') ids = await listAllUserIds();
      else if (t === 'party') { const pid = el.querySelector('#qa-ask-party')?.value; if (!pid) { showToast('Elegí una fiesta.', 'error'); return; } ids = await listPartyAttendeeIds(pid); }
      else { ids = askPeople.map(u => u.id); if (!ids.length) { showToast('Elegí al menos una persona.', 'error'); return; } }
    } catch (err) { showToast('No se pudieron resolver los destinatarios.', 'error'); console.warn('[admin] ask resolve', err); return; }
    const recipients = ids.filter(id => id && id !== meId);
    if (!recipients.length) { showToast('No hay destinatarios.', 'error'); return; }
    confirmAdminDelete({
      title: 'Enviar pregunta',
      message: `La pregunta se enviará a <strong>${recipients.length}</strong> persona(s). La reciben de forma anónima y pueden responderla.`,
      confirmLabel: 'Enviar',
      errorLabel: 'No se pudo enviar la pregunta.',
      hideReason: true,
      onConfirm: async () => {
        const r = await adminAskQuestion(text, recipients);
        showToast(`Pregunta enviada a ${r.inserted} persona(s).`, 'success', 5000);
        el.querySelector('#qa-ask-text').value = '';
      },
    });
  });

  // ---- List + moderate ----
  const subEl = el.querySelector('#qa-sub');
  const contentEl = el.querySelector('#qa-content');
  let questions = [];
  try { questions = await listQuestions(); }
  catch (err) { contentEl.innerHTML = errorHTML('No se pudieron cargar las preguntas.'); console.warn('[admin] questions', err); return; }

  // Resolve target names not already in the store cache (so "Para: X" is real).
  const uncached = [...new Set(questions.map(q => q.targetUserId))].filter(id => id && !store.getUserById(id));
  const nameMap = uncached.length ? await getProfileNames(uncached) : {};
  const resolveName = (id) => { const u = store.getUserById(id); return u ? (u.name || u.username || 'Usuario') : (nameMap[id] || 'Usuario'); };

  function paint(sub) {
    subEl.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    const list = sub === 'mine' ? questions.filter(q => q.targetUserId === meId) : questions;
    if (!list.length) { contentEl.innerHTML = emptyHTML('❓', 'Sin preguntas', sub === 'mine' ? 'No hay preguntas dirigidas a FeedBack.' : 'No hay preguntas.'); return; }
    contentEl.innerHTML = list.map(q => qaItem(q, sub === 'mine', resolveName(q.targetUserId))).join('');
  }
  subEl.addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) paint(b.dataset.sub); });

  contentEl.addEventListener('click', async (e) => {
    const ansBtn = e.target.closest('[data-answer]');
    if (ansBtn) {
      const id = ansBtn.dataset.answer;
      const ta = contentEl.querySelector(`textarea[data-answer-for="${id}"]`);
      const text = ta?.value.trim();
      if (!text) { showToast('Escribe una respuesta.', 'error'); return; }
      ansBtn.disabled = true;
      try {
        await answerQuestion(id, text);
        showToast('Respuesta publicada 💬', 'success');
        const q = questions.find(x => x.id === id); if (q) { q.answer = text; q.answeredAt = new Date(); }
        paint('mine');
      } catch (err) { ansBtn.disabled = false; showToast('No se pudo responder.', 'error'); console.warn('[admin] answer', err); }
      return;
    }
    const delBtn = e.target.closest('[data-del-q]');
    if (delBtn) {
      const id = delBtn.dataset.delQ;
      confirmAdminDelete({ title: 'Eliminar pregunta', message: 'Se ocultará para todos y queda en la papelera.', confirmLabel: 'Eliminar',
        onConfirm: async (reason) => { await adminSoftDeleteQuestion(id, reason); showToast('Pregunta eliminada', 'success'); questions = questions.filter(x => x.id !== id); paint(subEl.querySelector('.tab-item.active')?.dataset.sub || 'mine'); } });
    }
  });

  paint('mine');
}

function qaItem(q, mine, targetNameStr = 'Usuario') {
  const answered = !!q.answer;
  return card(`
    <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
      <span class="badge">${answered ? 'respondida' : 'pendiente'}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);">${formatRelative(q.createdAt)}</span>
    </div>
    <div style="font-size:var(--text-xs);color:var(--text-tertiary);margin-bottom:4px;">Para: <strong>${sanitize(targetNameStr)}</strong></div>
    <div style="font-size:var(--text-sm);font-weight:600;margin-bottom:6px;">${sanitize(q.question)}</div>
    ${answered ? `<div style="font-size:var(--text-sm);color:var(--text-secondary);line-height:1.4;margin-bottom:8px;">↳ ${sanitize(q.answer)}</div>` : ''}
    ${mine && !answered ? `
      <textarea class="input textarea" data-answer-for="${q.id}" placeholder="Tu respuesta…" maxlength="1000" style="min-height:60px;margin-bottom:6px;"></textarea>
      <button class="btn btn-primary btn-sm" data-answer="${q.id}">Responder</button>
    ` : ''}
    <button class="btn btn-sm" data-del-q="${q.id}" style="color:#dc2626;margin-left:6px;">Eliminar</button>
  `);
}

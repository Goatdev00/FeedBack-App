// ============================================
// FEEDBACK — Mensajes privados (inbox de DMs + grupos)
// Lista state.conversations (hidratado por listConversations y mantenido
// al día por el canal 'conversations-feed'). Los MENSAJES de cada hilo
// nunca pasan por aquí — viven page-scoped en chat-conversation.js, igual
// que las salas de chat.js. Esta página solo pinta metadata (preview,
// unread, mute) y ofrece los flujos de creación (DM / grupo).
// ============================================

import { store, ICONS, formatRelative } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, sanitize, debounce } from '../utils/helpers.js';
import { createModal } from '../utils/dom.js';
import { renderBottomNav } from '../components/nav.js';
import { requireCurrentUser } from '../data/profile-sync.js';
import { showToast } from '../utils/toast.js';
import { fileToResizedDataURL } from '../utils/image.js';

// Máximo de miembros seleccionables APARTE del creador — la RPC
// create_group (0038) capa el grupo a 30 personas en total.
const GROUP_MEMBER_CAP = 29;

export function renderChatsPrivate(container) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();

  // No limpiar hasUnreadConversations aquí — el inbox es el chooser, no
  // el hilo. Cada conversación limpia su unread al abrirse (chat-
  // conversation.js → store.markConversationRead), y el flag rolled-up
  // se recalcula solo en el store. Mismo criterio que chat-hub.
  const conversations = [...(state.conversations || [])].sort(
    (a, b) => (b.lastMessageAt?.getTime?.() || 0) - (a.lastMessageAt?.getTime?.() || 0)
  );

  container.innerHTML = `
    <div class="page" id="chats-private-page">
      <button class="back-btn" id="back-btn">
        ${ICONS.back}
        <span>Chats</span>
      </button>

      <h1 class="page-title">Mensajes</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-lg);">
        Chats privados y grupos
      </p>

      <div class="conv-actions-bar">
        <button class="btn btn-secondary btn-sm" id="new-chat-btn">💬 Nuevo chat</button>
        <button class="btn btn-secondary btn-sm" id="new-group-btn">👥 Nuevo grupo</button>
      </div>

      ${state.conversationsUnavailable ? `
        <div class="conv-banner">
          ⏳ La mensajería se está activando (migración pendiente en el
          servidor). Vuelve a intentarlo en unos minutos.
        </div>
      ` : ''}

      ${conversations.length > 0
        ? `<div id="conv-list">${conversations.map(c => renderConversationRow(c, state)).join('')}</div>`
        : ''}

      ${conversations.length === 0 && !state.conversationsUnavailable && !state.hydrated ? `
        <!-- state.conversations NUNCA se persiste (localStorage/cloud lo
             excluyen), así que en CADA boot el inbox está vacío hasta que
             la hidratación aterriza. Mientras !hydrated mostramos carga
             (patrón del skeleton del muro) — asegurar "No tienes
             conversaciones" a alguien con DMs activos era engañoso. -->
        <div class="empty-state">
          <div class="spinner" style="margin: 0 auto var(--space-md);"></div>
          <p class="empty-state-text">Cargando conversaciones...</p>
        </div>
      ` : ''}

      ${conversations.length === 0 && !state.conversationsUnavailable && state.hydrated ? `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <h3 class="empty-state-title">No tienes conversaciones</h3>
          <p class="empty-state-text">Escríbele a alguien de la escena 💬</p>
          <button class="btn btn-primary mt-lg" id="empty-new-chat">Nuevo chat</button>
        </div>
      ` : ''}
    </div>

    ${renderBottomNav('')}
  `;

  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('chat-hub'));
  container.querySelector('#new-chat-btn').addEventListener('click', openNewChatModal);
  container.querySelector('#new-group-btn').addEventListener('click', openNewGroupModal);
  container.querySelector('#empty-new-chat')?.addEventListener('click', openNewChatModal);

  // Delegación sobre la lista: la fila navega al hilo, el ⋮ abre el menú
  // (silenciar / salir). Un solo listener sobrevive a cualquier número de
  // filas y no se re-bindea por fila.
  const listEl = container.querySelector('#conv-list');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const menuBtn = e.target.closest('[data-action="conv-menu"]');
      if (menuBtn) {
        e.stopPropagation();
        const conv = store.getConversationById(menuBtn.dataset.convId);
        if (conv) openConvMenu(conv);
        return;
      }
      const row = e.target.closest('[data-conv-id]');
      if (!row) return;
      router.navigate('chat-conversation', { conversationId: row.dataset.convId });
    });
  }
}

// ---------------------------------------------------------------------
// Fila del inbox
// ---------------------------------------------------------------------
function renderConversationRow(conv, state) {
  const meId = state.currentUser?.id;
  const isGroup = conv.kind === 'group';
  const other = !isGroup ? store.getUserById(conv.otherUserId) : null;
  const name = isGroup ? (conv.title || 'Grupo') : (other?.name || 'Usuario');
  // avatarHTML ya pasa la foto por safeImageSrc y escapa el nombre; para
  // grupos le damos un "usuario" sintético {name: title, avatar: photo} y
  // el fallback sale con la inicial del título sobre el color derivado.
  const avatar = isGroup
    ? avatarHTML({ name: conv.title || 'Grupo', avatar: conv.photo }, 'avatar-md')
    : avatarHTML(other || { name: '?' }, 'avatar-md');

  return `
    <div class="conv-row ${conv.unread ? 'has-unread' : ''}">
      <button type="button" class="conv-row-main" data-conv-id="${conv.id}">
        <div class="conv-thumb">
          ${avatar}
          ${conv.unread ? '<span class="chat-dot conv-dot"></span>' : ''}
        </div>
        <div class="conv-info">
          <div class="conv-name">
            ${conv.muted ? '<span class="conv-mute-ico" title="Silenciada">🔕</span>' : ''}
            <span class="conv-name-text">${sanitize(name)}</span>
          </div>
          <div class="conv-preview">${conversationPreview(conv, meId)}</div>
        </div>
        <span class="conv-time">${conv.lastMessageAt ? formatRelative(conv.lastMessageAt) : ''}</span>
      </button>
      <button type="button" class="conv-menu-btn" data-action="conv-menu"
              data-conv-id="${conv.id}" aria-label="Opciones de la conversación">⋮</button>
    </div>
  `;
}

// Preview del último mensaje: media → etiqueta fija, texto → truncado a
// ~40 chars. El texto es contenido de usuario → sanitize SIEMPRE (después
// de truncar, para no partir una entidad escapada por la mitad).
function conversationPreview(conv, meId) {
  const lm = conv.lastMessage;
  if (!lm) return 'Sin mensajes aún';
  let body;
  if (lm.videoUrl) body = '🎬 Video';
  else if (lm.image) body = '📷 Foto';
  else {
    const text = (lm.content || '').replace(/\s+/g, ' ').trim();
    body = text.length > 40 ? text.slice(0, 40) + '…' : text;
  }
  const prefix = lm.userId === meId ? 'Tú: ' : '';
  return sanitize(prefix + body);
}

// ---------------------------------------------------------------------
// Menú ⋮ por conversación — silenciar / activar + salir del grupo
// ---------------------------------------------------------------------
function openConvMenu(conv) {
  const isGroup = conv.kind === 'group';
  const other = !isGroup ? store.getUserById(conv.otherUserId) : null;
  const name = isGroup ? (conv.title || 'Grupo') : (other?.name || 'Usuario');

  const overlay = createModal(`
    <div class="modal">
      <div class="modal-handle"></div>
      <div class="modal-title">${sanitize(name)}</div>
      <button type="button" class="conv-menu-item" id="menu-mute">
        ${conv.muted ? '🔔 Activar notificaciones' : '🔕 Silenciar notificaciones'}
      </button>
      ${isGroup ? `
        <button type="button" class="conv-menu-item conv-menu-danger" id="menu-leave">
          🚪 Salir del grupo
        </button>
      ` : ''}
    </div>
  `);

  overlay.querySelector('#menu-mute').addEventListener('click', () => {
    // Cerrar ANTES de mutar: el toggle repinta la ruta (repaintIfNeeded)
    // y refreshCurrentRoute no limpia overlays — quedaría flotando sobre
    // la lista nueva.
    overlay.close();
    store.toggleConversationMute(conv.id);
    const c = store.getConversationById(conv.id);
    showToast(c?.muted ? 'Conversación silenciada 🔕' : 'Notificaciones activadas 🔔', 'info');
  });

  const leaveBtn = overlay.querySelector('#menu-leave');
  if (leaveBtn) {
    // Confirm de dos toques (patrón mobile): el primer tap arma el botón,
    // el segundo ejecuta. Sin window.confirm (bloqueante y feo en PWA).
    leaveBtn.addEventListener('click', () => {
      if (!leaveBtn.dataset.armed) {
        leaveBtn.dataset.armed = '1';
        leaveBtn.textContent = '¿Seguro? Toca de nuevo para salir';
        return;
      }
      overlay.close();
      store.leaveConversation(conv.id);
      showToast('Saliste del grupo', 'info');
    });
  }
}

// ---------------------------------------------------------------------
// Candidatos para pickers: todos los perfiles reales menos yo (y menos
// los ids legacy 'u…' del seed local — no existen en profiles y el FK de
// la RPC los rechazaría). Los uuids son hex, nunca empiezan por 'u'.
// ---------------------------------------------------------------------
function pickerCandidates(excludeIds = []) {
  const state = store.getState();
  const exclude = new Set([state.currentUser?.id, ...excludeIds]);
  return (state.users || []).filter(u => u.id && !exclude.has(u.id) && !u.id.startsWith('u'));
}

function filterCandidates(list, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(u =>
    (u.name || '').toLowerCase().includes(q) ||
    (u.username || '').toLowerCase().includes(q)
  );
}

function userOptionHTML(u, selected) {
  return `
    <button type="button" class="user-pick-row ${selected ? 'is-selected' : ''}" data-user-id="${u.id}">
      ${avatarHTML(u, 'avatar-sm')}
      <div class="user-pick-info">
        <div class="user-pick-name">${sanitize(u.name)}</div>
        <div class="user-pick-username">${sanitize(u.username || '')}</div>
      </div>
      <span class="user-pick-check">${selected ? '✓' : ''}</span>
    </button>
  `;
}

const MULTISELECT_HTML = `
  <div class="search-bar" style="margin-bottom:var(--space-sm);">
    ${ICONS.search}
    <input type="text" class="user-pick-search" placeholder="Buscar por nombre o usuario..." autocomplete="off" />
  </div>
  <div class="user-pick-chips"></div>
  <div class="user-pick-list"></div>
`;

// Multi-select de usuarios (buscador + chips + checks) dentro de rootEl,
// que debe contener .user-pick-search / .user-pick-chips / .user-pick-list
// (plantilla MULTISELECT_HTML). Emite 'selection-change' en rootEl con
// detail.count para que el modal habilite/deshabilite su botón.
function wireUserMultiSelect(rootEl, { excludeIds = [], max = GROUP_MEMBER_CAP } = {}) {
  const searchEl = rootEl.querySelector('.user-pick-search');
  const chipsEl = rootEl.querySelector('.user-pick-chips');
  const listEl = rootEl.querySelector('.user-pick-list');
  const selected = new Map(); // userId → user

  const paintList = () => {
    const list = filterCandidates(pickerCandidates(excludeIds), searchEl.value).slice(0, 30);
    listEl.innerHTML = list.length
      ? list.map(u => userOptionHTML(u, selected.has(u.id))).join('')
      : '<p class="user-pick-none">Sin resultados</p>';
  };
  const paintChips = () => {
    chipsEl.innerHTML = [...selected.values()].map(u => `
      <span class="user-pick-chip">
        ${sanitize(u.name)}
        <button type="button" class="user-pick-chip-x" data-remove-id="${u.id}" aria-label="Quitar">✕</button>
      </span>
    `).join('');
  };
  const emit = () => {
    rootEl.dispatchEvent(new CustomEvent('selection-change', { detail: { count: selected.size } }));
  };

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.user-pick-row');
    if (!row) return;
    const id = row.dataset.userId;
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      if (selected.size >= max) {
        showToast(`Máximo ${max} miembros`, 'warning');
        return;
      }
      const u = store.getUserById(id);
      if (u) selected.set(id, u);
    }
    paintList();
    paintChips();
    emit();
  });

  chipsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove-id]');
    if (!x) return;
    selected.delete(x.dataset.removeId);
    paintList();
    paintChips();
    emit();
  });

  searchEl.addEventListener('input', debounce(paintList, 150));

  paintList();
  paintChips();
  return { getSelectedIds: () => [...selected.keys()] };
}

// ---------------------------------------------------------------------
// Nuevo chat (DM) — buscador single-select; tap → create_dm → hilo.
// ---------------------------------------------------------------------
function openNewChatModal() {
  const overlay = createModal(`
    <div class="modal" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div class="modal-title">Nuevo chat</div>
      <div class="search-bar" style="margin-bottom:var(--space-sm);">
        ${ICONS.search}
        <input type="text" class="user-pick-search" id="dm-search" placeholder="Buscar por nombre o usuario..." autocomplete="off" />
      </div>
      <div class="user-pick-list" id="dm-list"></div>
    </div>
  `);

  const searchEl = overlay.querySelector('#dm-search');
  const listEl = overlay.querySelector('#dm-list');
  let busy = false; // un solo create_dm en vuelo — el doble-tap no debe duplicar navegaciones

  const paint = () => {
    const list = filterCandidates(pickerCandidates(), searchEl.value).slice(0, 30);
    listEl.innerHTML = list.length
      ? list.map(u => userOptionHTML(u, false)).join('')
      : '<p class="user-pick-none">Sin resultados</p>';
  };

  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.user-pick-row');
    if (!row || busy) return;
    busy = true;
    listEl.classList.add('is-busy');
    row.querySelector('.user-pick-check').innerHTML = '<span class="btn-spinner"></span>';
    // create_dm dedupea por dm_key: si el hilo ya existía devuelve el
    // mismo uuid — navegar es idempotente. El error ya sale en toast
    // desde el store.
    const id = await store.createDM(row.dataset.userId);
    if (id) {
      overlay.close();
      router.navigate('chat-conversation', { conversationId: id });
      return;
    }
    busy = false;
    listEl.classList.remove('is-busy');
    paint();
  });

  searchEl.addEventListener('input', debounce(paint, 150));
  paint();
  searchEl.focus();
}

// ---------------------------------------------------------------------
// Nuevo grupo — nombre requerido, foto opcional (256px base64, mismo
// pipeline que los avatares), multi-select con cap 29 + yo = 30.
// ---------------------------------------------------------------------
function openNewGroupModal() {
  let photoData = null;

  const overlay = createModal(`
    <div class="modal" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div class="modal-title">Nuevo grupo</div>

      <div class="input-group mb-md">
        <label class="input-label">Nombre del grupo *</label>
        <input type="text" class="input" id="group-name" maxlength="60" placeholder="Ej: Parche techno 🔊" />
      </div>

      <div class="input-group mb-md">
        <label class="input-label">Foto (opcional)</label>
        <div class="group-photo-row">
          <img id="group-photo-preview" class="group-photo-preview" alt="" hidden />
          <button type="button" class="btn btn-ghost btn-sm" id="group-photo-pick">Subir foto</button>
          <button type="button" class="btn btn-ghost btn-sm" id="group-photo-remove" hidden>Quitar</button>
          <input type="file" id="group-photo-file" accept="image/*" hidden />
        </div>
      </div>

      <div class="input-group mb-md">
        <label class="input-label">Miembros * (máx ${GROUP_MEMBER_CAP} aparte de ti)</label>
        <div id="group-members-root">${MULTISELECT_HTML}</div>
      </div>

      <button class="btn btn-primary btn-full" id="group-create-btn">Crear grupo</button>
    </div>
  `);

  const nameEl = overlay.querySelector('#group-name');
  const fileEl = overlay.querySelector('#group-photo-file');
  const previewEl = overlay.querySelector('#group-photo-preview');
  const pickBtn = overlay.querySelector('#group-photo-pick');
  const removeBtn = overlay.querySelector('#group-photo-remove');
  const createBtn = overlay.querySelector('#group-create-btn');

  const membersRoot = overlay.querySelector('#group-members-root');
  const picker = wireUserMultiSelect(membersRoot, { max: GROUP_MEMBER_CAP });

  pickBtn.addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files && fileEl.files[0];
    fileEl.value = ''; // re-elegir el mismo archivo debe volver a disparar change
    if (!f) return;
    try {
      // 256px como los avatares: la foto viaja en photo_url (base64 con
      // cap de 0038) y en cada fila del inbox — tiene que ser pequeña.
      photoData = await fileToResizedDataURL(f, 256, 0.8);
      previewEl.src = photoData; // data URL generada por nuestro canvas — origen confiable
      previewEl.hidden = false;
      removeBtn.hidden = false;
      pickBtn.textContent = 'Cambiar foto';
    } catch (err) {
      console.warn('[chats-private] group photo resize failed', err);
      showToast('No se pudo procesar la imagen', 'error');
    }
  });
  removeBtn.addEventListener('click', () => {
    photoData = null;
    previewEl.removeAttribute('src');
    previewEl.hidden = true;
    removeBtn.hidden = true;
    pickBtn.textContent = 'Subir foto';
  });

  createBtn.addEventListener('click', async () => {
    const title = nameEl.value.trim();
    const memberIds = picker.getSelectedIds();
    if (!title) { showToast('Ponle un nombre al grupo', 'warning'); nameEl.focus(); return; }
    if (title.length > 60) { showToast('El nombre no puede superar 60 caracteres', 'warning'); return; }
    if (memberIds.length === 0) { showToast('Elige al menos un miembro', 'warning'); return; }

    createBtn.disabled = true;
    const originalLabel = createBtn.innerHTML;
    createBtn.innerHTML = '<span class="btn-spinner"></span>&nbsp;Creando…';
    const id = await store.createGroup({ title, photo: photoData, memberIds });
    if (id) {
      overlay.close();
      router.navigate('chat-conversation', { conversationId: id });
      return;
    }
    createBtn.disabled = false;
    createBtn.innerHTML = originalLabel;
  });
}

// ---------------------------------------------------------------------
// Picker de miembros reutilizable (usado por "Añadir miembros" en el
// panel de detalles del grupo — chat-conversation.js). onConfirm recibe
// los ids y devuelve truthy para cerrar el modal (spinner mientras).
// ---------------------------------------------------------------------
export function openMemberPickerModal({ title = 'Añadir miembros', confirmLabel = 'Añadir', excludeIds = [], max = GROUP_MEMBER_CAP, onConfirm } = {}) {
  if (max <= 0) {
    showToast('El grupo ya está lleno (30 miembros)', 'warning');
    return;
  }
  const overlay = createModal(`
    <div class="modal" style="max-height:92dvh;overflow-y:auto;">
      <div class="modal-handle"></div>
      <div class="modal-title">${sanitize(title)}</div>
      <div id="member-picker-root">${MULTISELECT_HTML}</div>
      <button class="btn btn-primary btn-full" id="picker-confirm" disabled style="margin-top:var(--space-md);">
        ${sanitize(confirmLabel)}
      </button>
    </div>
  `);

  const root = overlay.querySelector('#member-picker-root');
  const confirmBtn = overlay.querySelector('#picker-confirm');
  const picker = wireUserMultiSelect(root, { excludeIds, max });

  root.addEventListener('selection-change', (e) => {
    const n = e.detail.count;
    confirmBtn.disabled = n === 0;
    confirmBtn.textContent = n > 0 ? `${confirmLabel} (${n})` : confirmLabel;
  });

  confirmBtn.addEventListener('click', async () => {
    const ids = picker.getSelectedIds();
    if (!ids.length || confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    const originalLabel = confirmBtn.innerHTML;
    confirmBtn.innerHTML = '<span class="btn-spinner"></span>';
    const ok = await onConfirm?.(ids);
    if (ok) { overlay.close(); return; }
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = originalLabel;
  });
}

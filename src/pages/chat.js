// ============================================
// FEEDBACK — Chat Room (reusable for general + per-party)
// Phase 3: Supabase chat_messages + Realtime broadcast. Every message
// goes to public.chat_messages and arrives on every other connected
// client within ~200ms via the supabase_realtime publication.
// ============================================

import { store, ICONS, formatRelative, describeApiError } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize, safeImageSrc } from '../utils/helpers.js';
import { replaceListener, detachListener } from '../utils/dom.js';
import { validateVideoFile, uploadVideoToStorage, removeUploadedVideo } from '../utils/video.js';
import {
  listChatMessages,
  sendChatMessageDB,
  subscribeChatRoom,
  resolveChatRoomId,
  adminSoftDeleteChatMessage,
} from '../data/api.js';
import { supabase } from '../data/supabase.js';
import { requireCurrentUser } from '../data/profile-sync.js';
import { showToast } from '../utils/toast.js';
import { confirmAdminDelete } from '../utils/admin-moderation.js';

const GENERAL_ROOM_KEY = 'general';

export function renderChatGeneral(container) {
  return renderChatRoom(container, {
    roomKey: GENERAL_ROOM_KEY,
    title: 'Chat general',
    subtitle: 'Toda la escena en tiempo real',
    backRoute: 'chat-hub',
  });
}

export function renderChatParty(container, params = {}) {
  const state = store.getState();
  const partyId = params.partyId || state.viewingPartyId;
  const party = store.getPartyById(partyId);
  if (!party) { router.navigate('chat-parties'); return; }

  return renderChatRoom(container, {
    roomKey: `party:${partyId}`,
    title: party.name,
    subtitle: `${party.venue} · ${party.city}`,
    backRoute: 'chat-parties',
  });
}

function renderChatRoom(container, { roomKey, title, subtitle, backRoute }) {
  if (!requireCurrentUser(container)) return;
  const state = store.getState();
  const user = state.currentUser;
  const isAdmin = !!(user && user.isAdmin);

  // Entering a live room — user is now seeing this specific chat
  // directly. Two clear-cases:
  //   * General room: clear hasUnreadChatGeneral. The party flag stays
  //     so the wall/chat-hub still warn the user about unread parties.
  //   * Party room: remove THIS party from unreadChatRooms. The rolled-up
  //     hasUnreadChatParty stays true if any OTHER party still has
  //     unread messages, false otherwise — so visiting one buzzing
  //     party doesn't silently clear the dot for the others.
  const isGeneral = roomKey === GENERAL_ROOM_KEY;
  if (isGeneral) {
    if (state.hasUnreadChatGeneral) store.setState({ hasUnreadChatGeneral: false });
  } else {
    const partyId = roomKey.slice('party:'.length);
    const cur = state.unreadChatRooms || {};
    if (cur[partyId] || state.hasUnreadChatParty) {
      const next = { ...cur };
      delete next[partyId];
      store.setState({
        unreadChatRooms: next,
        hasUnreadChatParty: Object.keys(next).length > 0,
      });
    }
  }

  container.innerHTML = `
    <div class="page chat-page" id="chat-room-page">
      <div class="chat-header">
        <button class="chat-back" id="back-btn" aria-label="Volver">${ICONS.back}</button>
        <div class="chat-header-info">
          <div class="chat-header-title">${sanitize(title)}</div>
          <div class="chat-header-subtitle">${sanitize(subtitle)}</div>
        </div>
        <span class="chat-live-indicator" title="En vivo">●</span>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="chat-empty"><div class="chat-empty-icon">💬</div><p>Cargando mensajes...</p></div>
      </div>

      <!-- Preview del video adjunto (mismo patrón que el composer de DMs:
           tira sobre el input con miniatura + quitar). muted+playsinline:
           es solo una miniatura, jamás debe sonar ni ir a fullscreen. -->
      <div class="chat-attach-preview" id="video-attach-preview" hidden>
        <video id="video-attach-thumb" class="chat-attach-video-thumb" playsinline webkit-playsinline muted preload="metadata"></video>
        <span class="chat-attach-label">Video listo para enviar</span>
        <button type="button" class="chat-attach-remove" id="video-attach-remove" aria-label="Quitar video">✕</button>
      </div>

      <form class="chat-input-row" id="chat-form">
        <button type="button" class="chat-attach-btn chat-attach-btn-emoji" id="video-attach-btn" title="Adjuntar video" aria-label="Adjuntar video">🎬</button>
        <!-- Sin capture: en iOS capture fuerza solo-cámara y esconde la
             fototeca. accept = los 3 mime que admite el bucket videos. -->
        <input type="file" id="video-attach-file" accept="video/mp4,video/quicktime,video/webm" hidden />
        <input type="text" class="chat-input" id="chat-input"
               placeholder="Escribe un mensaje..." maxlength="500"
               autocomplete="off" />
        <button type="submit" class="chat-send" aria-label="Enviar">
          ${ICONS.send}
        </button>
      </form>
    </div>
  `;

  const messagesEl = container.querySelector('#chat-messages');
  const form = container.querySelector('#chat-form');
  const input = container.querySelector('#chat-input');
  const sendBtn = form.querySelector('.chat-send');

  // ====== Local in-memory message buffer (this page only) ======
  // We don't push chat into the global store because (a) the volume can
  // grow large and (b) the chat is page-scoped. State here:
  //
  //   messages           — array of {id, userId, content, createdAt, ...}
  //   pendingByContent   — set of contents currently flying to the server,
  //                        used to dedupe the realtime echo from the user's
  //                        own insert.
  //   userCache          — id → user lookup for foreign authors we haven't
  //                        seen in state.users yet (fills lazily).
  let messages = [];
  const pendingByContent = new Map(); // contentKey → [tempId, ...] (FIFO — ver pendingPush)
  const userCache = new Map();

  let lastRenderedSig = '';
  // paint() reconstruye la lista entera vía innerHTML, y eso DESTRUYE
  // cualquier <video> en reproducción (el elemento se recrea pausado en
  // frame 0): en una sala activa, el mensaje de cualquier otro usuario
  // mataba un video a mitad de play. Si hay un video del hilo sonando,
  // el repintado se DIFIERE a su pause/ended (flag pendingPaint); los
  // mensajes siguen acumulándose en el buffer y entran todos juntos.
  let pendingPaint = false;
  let paintDeferCleanup = null;
  function deferPaint(video) {
    pendingPaint = true;
    // Si ya había un defer colgado, soltarlo antes: aunque el repintado
    // se posponga N veces, sobre el video vive UN solo par de listeners.
    if (paintDeferCleanup) paintDeferCleanup();
    const onDone = () => {
      cleanup();
      if (pendingPaint) paint();
    };
    const cleanup = () => {
      video.removeEventListener('pause', onDone);
      video.removeEventListener('ended', onDone);
      if (paintDeferCleanup === cleanup) paintDeferCleanup = null;
    };
    paintDeferCleanup = cleanup;
    video.addEventListener('pause', onDone);
    video.addEventListener('ended', onDone);
  }

  function paint() {
    const playing = Array.from(messagesEl.querySelectorAll('video'))
      .find(v => !v.paused && !v.ended && v.readyState > 2);
    if (playing) {
      deferPaint(playing);
      return;
    }
    pendingPaint = false;

    const sig = messages.length + ':' + (messages.at(-1)?.id || '');
    if (sig === lastRenderedSig) return;
    lastRenderedSig = sig;

    const wasNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

    messagesEl.innerHTML = messages.length === 0
      ? `<div class="chat-empty">
           <div class="chat-empty-icon">💬</div>
           <p>Aún nadie ha escrito. ¡Rompe el hielo!</p>
         </div>`
      : messages.map((m, i) => renderMessage(m, messages[i - 1], user.id, userCache, isAdmin)).join('');

    if (wasNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // Un <video preload="metadata"> pinta primero a la altura por defecto
  // del replaced element y CRECE cuando llega la metadata (un 9:16 a
  // 240px de ancho pasa de ~120px a ~427px de alto) — si estábamos
  // pegados al fondo, el último mensaje quedaba bajo el pliegue. Los
  // VIDEO nunca disparan 'load': su señal es 'loadedmetadata' (no
  // burbujea → captura), y ahí re-pegamos el scroll si procede.
  messagesEl.addEventListener('loadedmetadata', (e) => {
    if (e.target.tagName !== 'VIDEO') return;
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }, true);

  // ====== Hydrate history from Supabase + subscribe to new inserts ======
  let unsubscribeRealtime = () => {};
  let roomMissing = false;

  (async () => {
    // Pre-flight: confirm the chat_room exists in Supabase. If not, the
    // most likely cause is migration 0009 not applied yet (no global
    // room with party_id IS NULL). Show a clear inline error instead of
    // letting the user type into a black hole.
    const roomId = await resolveChatRoomId(roomKey);
    if (!roomId) {
      roomMissing = true;
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">⚠️</div>
          <p style="color:var(--orange);font-weight:600;">No se pudo conectar al chat.</p>
          <p style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:8px;">
            La sala no existe en el servidor. Verifica que las migraciones
            <code>0008</code> y <code>0009</code> estén aplicadas en Supabase.
          </p>
        </div>
      `;
      // Disable input so the user doesn't keep trying.
      input.disabled = true;
      input.placeholder = 'Chat no disponible';
      const attach = container.querySelector('#video-attach-btn');
      if (attach) attach.disabled = true;
      return;
    }

    try {
      messages = await listChatMessages(roomKey);
    } catch (err) {
      console.warn('[chat] history fetch failed', err);
      messages = [];
    }
    // Fetch any missing author profiles in one batch so renderMessage
    // doesn't render empty bubbles for users not in state.users yet.
    await fillUserCache(messages, userCache);
    paint();
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  })();

  unsubscribeRealtime = subscribeChatRoom(roomKey, async (msg) => {
    // Drop the realtime echo of our own optimistic insert.
    const key = optimisticKey(msg);
    if (messages.some(m => m.id === msg.id)) {
      // Ya está en el buffer (el POST resolvió antes que su eco y ya
      // swapeó su burbuja) — no tocar nada, y sobre todo NO consumir un
      // tempId de otra burbuja pendiente con la misma clave.
    } else if (pendingByContent.has(key)) {
      // Eco de nuestro propio insert optimista. FIFO: el eco más viejo
      // casa con el tempId más viejo de esa clave (dos envíos idénticos
      // rápidos comparten clave — con un valor escalar el segundo send
      // pisaba el tempId del primero y quedaba una burbuja huérfana).
      const tempId = pendingShift(pendingByContent, key);
      const idx = messages.findIndex(m => m.id === tempId);
      if (idx !== -1) messages[idx] = msg;
      else messages.push(msg); // el temp ya no está — no perder la fila real
      lastRenderedSig = ''; // el swap no cambia length+lastId: forzar repintado
    } else {
      // Foreign message.
      messages.push(msg);
    }
    if (!userCache.has(msg.userId) && !store.getUserById(msg.userId)) {
      await fetchUserInto(msg.userId, userCache);
    }
    paint();
  });

  // ====== Adjuntar video (0039) ======
  // El File validado se sube a Storage RECIÉN al enviar: el optimistic
  // row necesita la URL pública definitiva (es la que pinta la burbuja y
  // la que dedupea el eco realtime).
  const videoAttachBtn = container.querySelector('#video-attach-btn');
  const videoAttachFile = container.querySelector('#video-attach-file');
  const videoAttachPreview = container.querySelector('#video-attach-preview');
  const videoAttachThumb = container.querySelector('#video-attach-thumb');
  let pendingVideo = null;      // File validado, aún sin subir
  let pendingVideoBlobUrl = null;

  function clearVideoAttachment() {
    pendingVideo = null;
    // Revocar SIEMPRE el blob del preview (presión de memoria en iOS).
    if (pendingVideoBlobUrl) { URL.revokeObjectURL(pendingVideoBlobUrl); pendingVideoBlobUrl = null; }
    videoAttachThumb.removeAttribute('src');
    videoAttachThumb.load();
    videoAttachPreview.hidden = true;
  }

  videoAttachBtn.addEventListener('click', () => videoAttachFile.click());
  videoAttachFile.addEventListener('change', async () => {
    const f = videoAttachFile.files && videoAttachFile.files[0];
    videoAttachFile.value = ''; // volver a elegir el mismo archivo debe re-disparar change
    if (!f) return;
    const res = await validateVideoFile(f);
    if (!res.ok) {
      showToast(res.error, 'error', 5000);
      return;
    }
    clearVideoAttachment();
    pendingVideo = f;
    pendingVideoBlobUrl = URL.createObjectURL(f);
    videoAttachThumb.src = pendingVideoBlobUrl;
    videoAttachPreview.hidden = false;
    input.focus();
  });
  const videoAttachRemove = container.querySelector('#video-attach-remove');
  videoAttachRemove.addEventListener('click', clearVideoAttachment);

  // Bloqueo TOTAL del composer durante la subida: además de send+input,
  // adjuntar/quitar. Sin esto, adjuntar un video de reemplazo mid-upload
  // era destruido en silencio por el clearVideoAttachment() post-subida.
  const setComposerLock = (locked) => {
    sendBtn.disabled = locked;
    input.disabled = locked;
    videoAttachBtn.disabled = locked;
    videoAttachRemove.disabled = locked;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (roomMissing) {
      showToast('Chat no disponible. Aplica migration 0009.', 'error', 5000);
      return;
    }
    const text = input.value.trim();
    const videoToSend = pendingVideo;
    if (!text && !videoToSend) return;

    // Subida ANTES del insert optimista: spinner en el send + composer
    // bloqueado por completo. Si falla, el adjunto sigue puesto para
    // reintentar. Conservamos el path del objeto subido para poder
    // borrarlo si luego el insert del mensaje falla (huérfanos en el
    // bucket videos).
    let videoUrl = null;
    let videoPath = null;
    if (videoToSend) {
      setComposerLock(true);
      const prevSendHtml = sendBtn.innerHTML;
      sendBtn.innerHTML = '<span class="btn-spinner"></span>';
      try {
        const uploaded = await uploadVideoToStorage(videoToSend, user.id);
        videoUrl = uploaded.url;
        videoPath = uploaded.path;
      } catch (err) {
        setComposerLock(false);
        sendBtn.innerHTML = prevSendHtml;
        showToast('No se subió el video: ' + (err?.message || 'error desconocido'), 'error', 5000);
        return;
      }
      setComposerLock(false);
      sendBtn.innerHTML = prevSendHtml;
      clearVideoAttachment();
    }

    input.value = '';
    input.focus();

    // Optimistic local insert: show the message immediately, dedupe the
    // realtime echo by content+timestamp.
    const tempId = 'pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const optimistic = {
      id: tempId,
      userId: user.id,
      content: text || null,
      videoUrl,
      authorTier: user.tier || 'general',
      authorRole: user.role || 'raver',
      isHost: false,
      createdAt: new Date(),
      _pending: true,
    };
    messages.push(optimistic);
    pendingPush(pendingByContent, optimisticKey(optimistic), tempId);
    paint();

    try {
      const real = await sendChatMessageDB(roomKey, text || null, { videoUrl });
      if (real) {
        pendingRemove(pendingByContent, optimisticKey(optimistic), tempId);
        const idx = messages.findIndex(m => m.id === tempId);
        // El eco realtime pudo ganarle al POST y haber colocado ya la
        // fila real — nunca escribirla dos veces (misma data-msg-id en
        // dos burbujas).
        if (idx !== -1 && !messages.some(m => m.id === real.id)) {
          messages[idx] = real;
        } else if (idx !== -1) {
          messages.splice(idx, 1); // la real ya está: retirar la optimista sobrante
        }
        lastRenderedSig = ''; // swap in situ: length+lastId no cambian
        paint();
      }
    } catch (err) {
      console.error('[chat] send failed', {
        code: err?.code, message: err?.message,
        details: err?.details, hint: err?.hint, raw: err,
        roomKey,
      });
      // Keep the message visible, mark it as failed-to-sync. The user
      // can still read what they typed; the toast tells them WHY it
      // didn't reach the server using the same describeApiError used
      // by posts / comments / likes.
      const m = messages.find(x => x.id === tempId);
      if (m) {
        m._pending = false;
        m._syncFailed = true;
      }
      pendingRemove(pendingByContent, optimisticKey(optimistic), tempId);
      // El insert falló pero la subida triunfó: sin mensaje que lo
      // referencie, el video quedaría huérfano en el bucket — borrado
      // best-effort (la burbuja local _syncFailed no sobrevive la sesión).
      removeUploadedVideo(videoPath);
      paint();

      // Special-case: the message bubbled up as 'room_not_found' from
      // resolveChatRoomId — that's almost always migration 0009 missing.
      // For anything else, surface the real Supabase error code/message.
      const reason = err?.message === 'room_not_found'
        ? 'Sala de chat no creada en el servidor (aplica migration 0009).'
        : describeApiError(err);
      showToast('No se envió: ' + reason, 'error', 5000);
    }
  });

  // ====== Salida de la sala ======
  // Limpieza única para TODAS las rutas de salida (botón back, tap a un
  // perfil, back-gesture/hashchange): cierra el canal realtime, revoca el
  // blob URL del preview pendiente (sin esto cada video adjuntado y
  // abandonado quedaba pinneado en memoria de por vida — la SPA nunca se
  // descarga) y suelta el defer de paint + el listener de hashchange.
  const cleanupRoom = () => {
    clearVideoAttachment();
    if (paintDeferCleanup) paintDeferCleanup();
    unsubscribeRealtime();
    detachListener(window, HASH_CLEANUP_KEY);
  };

  // El router no avisa al salir de una ruta: el back-gesture / un deep
  // link cambian el hash sin pasar por nuestros botones (mismo patrón que
  // chat-conversation.js). Ojo con el eco del _syncHash de NUESTRA propia
  // entrada: si el hash sigue apuntando a esta misma sala, no desmontar.
  replaceListener(window, 'hashchange', () => {
    const match = router.matchHash(window.location.hash);
    if (match && (
      (isGeneral && match.name === 'chat-general') ||
      (!isGeneral && match.name === 'chat-party' && match.params.partyId === roomKey.slice('party:'.length))
    )) return;
    cleanupRoom();
  }, HASH_CLEANUP_KEY);

  container.querySelector('#back-btn').addEventListener('click', () => {
    cleanupRoom();
    router.navigate(backRoute);
  });

  // Tap an author's avatar or name inside any message → open their profile.
  // Delegated on the messages list so it works for every message past and
  // future without re-binding on each paint().
  messagesEl.addEventListener('click', (e) => {
    // Admin moderation: soft-delete a message. Intercept before the
    // view-profile branch (stopPropagation so the tap doesn't also open
    // a profile).
    const del = e.target.closest('[data-action="admin-del-msg"]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.msgId;
      confirmAdminDelete({
        title: 'Eliminar mensaje',
        message: 'Este mensaje se ocultará para todos.',
        onConfirm: async (reason) => {
          await adminSoftDeleteChatMessage(id, reason);
          messages = messages.filter(x => x.id !== id);
          lastRenderedSig = ''; // force a repaint even if length+lastid look unchanged
          paint();
          showToast('Mensaje eliminado (admin) 🛡️', 'success');
        },
      });
      return;
    }

    const trigger = e.target.closest('[data-action="view-profile"]');
    if (!trigger) return;
    const userId = trigger.dataset.userId;
    if (!userId) return;
    // profile-other resuelve EXCLUSIVAMENTE vía store.getUserById y con un
    // miss rebota al muro. Un autor que solo vive en el userCache local
    // (perfil creado después de la hidratación) se inyecta al store antes
    // de navegar; si tampoco está en cache, ignorar el tap.
    if (!ensureUserInStore(userId, userCache)) return;
    cleanupRoom();
    store.setState({ viewingUserId: userId });
    router.navigate('profile-other', { userId });
  });
}

// Clave del listener de hashchange del desmontaje (ver replaceListener).
const HASH_CLEANUP_KEY = 'chat-room-cleanup';

// Garantiza que profile-other pueda resolver al usuario: si no está en
// state.users pero sí en el cache de la página, se inyecta con el mismo
// shape que produce la hidratación de perfiles. Devuelve false cuando no
// hay datos en ningún lado (mejor ignorar el tap que rebotar al muro).
function ensureUserInStore(userId, userCache) {
  if (store.getUserById(userId)) return true;
  const cached = userCache.get(userId);
  if (!cached) return false;
  store.setState({ users: [...(store.getState().users || []), cached] });
  return true;
}

function optimisticKey(msg) {
  // userId+content dedupes within a small time window — we delete the
  // entry as soon as the server echo lands so collisions are virtually
  // impossible. Con video el content puede ser null (dos videos sin texto
  // colisionarían siempre): la URL del video entra en la clave, igual que
  // en chat-conversation.js.
  return `${msg.userId}::${msg.content || ''}::${msg.videoUrl || ''}`;
}

// ---------------------------------------------------------------------
// pendingByContent es Map<key, tempId[]> y NO Map<key, tempId>: dos
// envíos idénticos rápidos ("jaja" Enter, "jaja" Enter) comparten clave,
// y con un valor escalar el segundo set() pisaba el tempId del primero —
// el eco realtime casaba entonces con la burbuja equivocada y el POST
// re-escribía la fila real en la otra: mensaje duplicado en pantalla.
// FIFO: push al enviar, shift cuando llega el eco (el eco más viejo casa
// con el tempId más viejo), remove puntual cuando resuelve/falla el POST.
// La clave se borra al vaciarse el array.
// ---------------------------------------------------------------------
function pendingPush(map, key, tempId) {
  const arr = map.get(key) || [];
  arr.push(tempId);
  map.set(key, arr);
}

function pendingShift(map, key) {
  const arr = map.get(key);
  if (!arr || arr.length === 0) return null;
  const tempId = arr.shift();
  if (arr.length === 0) map.delete(key);
  return tempId;
}

function pendingRemove(map, key, tempId) {
  const arr = map.get(key);
  if (!arr) return;
  const i = arr.indexOf(tempId);
  if (i !== -1) arr.splice(i, 1);
  if (arr.length === 0) map.delete(key);
}

async function fillUserCache(messages, cache) {
  const missing = new Set();
  for (const m of messages) {
    if (!cache.has(m.userId) && !store.getUserById(m.userId)) missing.add(m.userId);
  }
  if (missing.size === 0) return;
  const { data } = await supabase
    .from('profiles')
    .select('id, name, username, role, avatar_url, membership_tier')
    .in('id', Array.from(missing));
  for (const p of data || []) {
    cache.set(p.id, profileRowToUserShape(p));
  }
}

async function fetchUserInto(userId, cache) {
  const { data } = await supabase
    .from('profiles')
    .select('id, name, username, role, avatar_url, membership_tier')
    .eq('id', userId)
    .maybeSingle();
  if (data) cache.set(userId, profileRowToUserShape(data));
}

function profileRowToUserShape(p) {
  return {
    id: p.id,
    name: p.name,
    username: p.username?.startsWith('@') ? p.username : `@${p.username}`,
    role: p.role,
    avatar: p.avatar_url || null,
    premium: p.membership_tier && p.membership_tier !== 'general',
  };
}

function renderMessage(m, prev, currentUserId, userCache, isAdmin = false) {
  const author = store.getUserById(m.userId) || userCache.get(m.userId);
  if (!author) return '';
  const isMine = m.userId === currentUserId;
  const sameAsPrev = prev
    && prev.userId === m.userId
    && (m.createdAt.getTime() - prev.createdAt.getTime()) < 5 * 60_000;
  // Admin moderation control — never on still-pending optimistic rows
  // (their id is a temp id the RPC can't resolve).
  const canModerate = isAdmin && !m._pending && !m._syncFailed;

  // Burbuja de video (0039) — mismas clases que chat-conversation.js
  // (.chat-msg-media-bubble/.chat-msg-video). La URL pasa por
  // safeImageSrc (https de Storage pasa; nunca interpolar cruda). SIN
  // autoplay + playsinline: iOS secuestra a fullscreen sin él.
  const vid = m.videoUrl ? safeImageSrc(m.videoUrl) : null;
  const bubble = vid
    ? `<div class="chat-msg-bubble chat-msg-media-bubble">
         <video class="chat-msg-video" controls playsinline webkit-playsinline preload="metadata" src="${vid}"></video>
         ${m.content ? `<div class="chat-msg-caption">${sanitize(m.content)}</div>` : ''}
       </div>`
    : `<div class="chat-msg-bubble">${sanitize(m.content)}</div>`;

  return `
    <div class="chat-msg ${isMine ? 'chat-msg-mine' : ''} ${sameAsPrev ? 'chat-msg-stacked' : ''}" data-msg-id="${m.id}">
      ${sameAsPrev
        ? '<div class="chat-msg-avatar-slot"></div>'
        : `<span data-action="view-profile" data-user-id="${m.userId}" style="cursor:pointer;display:inline-flex;">${avatarHTML(author, 'avatar-sm chat-msg-avatar-slot')}</span>`
      }
      <div class="chat-msg-body">
        ${sameAsPrev ? '' : `
          <div class="chat-msg-meta">
            <span class="chat-msg-author" data-action="view-profile" data-user-id="${m.userId}" style="cursor:pointer;">${sanitize(author.name)}</span>
            <span class="badge ${roleBadgeClass(author.role)} chat-msg-role">${roleTitle(author.role)}</span>
            <span class="chat-msg-time">${formatRelative(m.createdAt)}</span>
          </div>
        `}
        <div style="display:flex;align-items:center;gap:6px;">
          ${isMine && canModerate ? `<button data-action="admin-del-msg" data-msg-id="${m.id}" title="Eliminar (admin)" aria-label="Eliminar (admin)" style="background:transparent;border:none;color:#dc2626;cursor:pointer;padding:0;font-size:0.95em;line-height:1;flex-shrink:0;">🗑️</button>` : ''}
          ${bubble}
          ${!isMine && canModerate ? `<button data-action="admin-del-msg" data-msg-id="${m.id}" title="Eliminar (admin)" aria-label="Eliminar (admin)" style="background:transparent;border:none;color:#dc2626;cursor:pointer;padding:0;font-size:0.95em;line-height:1;flex-shrink:0;">🗑️</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ============================================
// FEEDBACK — Hilo privado (DM o grupo, migración 0038)
// Clon del patrón de chat.js/renderChatRoom: buffer de mensajes page-
// scoped (nunca en el store/localStorage), envío optimista con dedupe del
// eco realtime, autoscroll near-bottom y delegación de clicks. Las
// diferencias: datos de conversation_messages (texto + foto base64 +
// video), setActiveConversation para que el feed global no marque unread
// mientras el hilo está abierto, y cabecera con mute + panel de grupo.
// ============================================

import { store, ICONS, formatRelative, describeApiError } from '../data/mock-data.js';
import { router } from '../router.js';
import { avatarHTML, roleBadgeClass, roleTitle, sanitize, safeImageSrc } from '../utils/helpers.js';
import {
  listConversationMessages,
  sendConversationMessage,
  subscribeConversation,
  setActiveConversation,
  getConversation,
} from '../data/api.js';
import { supabase } from '../data/supabase.js';
import { requireCurrentUser } from '../data/profile-sync.js';
import { showToast } from '../utils/toast.js';
import { createModal, replaceListener, detachListener } from '../utils/dom.js';
import { fileToResizedDataURL } from '../utils/image.js';
import { validateVideoFile, uploadVideoToStorage, removeUploadedVideo } from '../utils/video.js';
import { openMemberPickerModal } from './chats-private.js';

// Teardown del montaje ACTIVO (canal realtime + conversación activa).
// Módulo-level porque el router no tiene hook de unmount: el próximo
// montaje (u otro hashchange) debe poder limpiar el anterior aunque el
// DOM viejo ya haya sido barrido por innerHTML.
let _activeTeardown = null;
const HASH_TEARDOWN_KEY = 'chat-conversation-teardown';

export function renderChatConversation(container, params = {}) {
  if (!requireCurrentUser(container)) return;
  // Limpia cualquier montaje anterior que siga vivo (re-render de la
  // misma ruta, push tocado hacia OTRO hilo con uno abierto, etc.).
  if (_activeTeardown) _activeTeardown();

  const state = store.getState();
  const user = state.currentUser;
  const conversationId = params.conversationId || null;
  if (!conversationId) { router.navigate('chats-private'); return; }

  const conv = store.getConversationById(conversationId);
  if (!conv) {
    // Deep link frío (push tocado con la app recién abierta): la cabecera
    // aún no está en el store. Shell de carga + fetch dirigido; si RLS no
    // devuelve nada (no soy miembro / hilo borrado) → volver al inbox.
    renderLoadingShell(container);
    (async () => {
      let fetched = null;
      try { fetched = await getConversation(conversationId); } catch { fetched = null; }
      // El usuario pudo navegar mientras esperábamos — no pisar otra ruta.
      if (router.getCurrentRoute() !== 'chat-conversation'
          || router.getCurrentParams().conversationId !== conversationId) return;
      if (!fetched) {
        showToast('No se pudo abrir la conversación.', 'error');
        router.navigate('chats-private');
        return;
      }
      const rest = (store.getState().conversations || []).filter(c => c.id !== conversationId);
      const sorted = [fetched, ...rest].sort(
        (a, b) => (b.lastMessageAt?.getTime?.() || 0) - (a.lastMessageAt?.getTime?.() || 0)
      );
      store.setState({ conversations: sorted });
      renderChatConversation(container, params);
    })();
    return;
  }

  const isGroup = conv.kind === 'group';

  container.innerHTML = `
    <div class="page chat-page" id="chat-conversation-page">
      <div class="chat-header">
        <button class="chat-back" id="back-btn" aria-label="Volver">${ICONS.back}</button>
        <button type="button" class="chat-header-id" id="conv-head">
          <span class="chat-header-avatar" id="conv-avatar"></span>
          <div class="chat-header-info">
            <div class="chat-header-title" id="conv-title"></div>
            <div class="chat-header-subtitle" id="conv-subtitle"></div>
          </div>
        </button>
        <button type="button" class="chat-header-action" id="mute-btn"></button>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="chat-empty"><div class="chat-empty-icon">💬</div><p>Cargando mensajes...</p></div>
      </div>

      <div class="chat-attach-preview" id="attach-preview" hidden>
        <img id="attach-thumb" alt="Foto adjunta" />
        <span class="chat-attach-label">Foto lista para enviar</span>
        <button type="button" class="chat-attach-remove" id="attach-remove" aria-label="Quitar foto">✕</button>
      </div>

      <!-- Preview del video adjunto — miniatura muted+playsinline (jamás
           debe sonar ni saltar a fullscreen desde el composer). -->
      <div class="chat-attach-preview" id="video-attach-preview" hidden>
        <video id="video-attach-thumb" class="chat-attach-video-thumb" playsinline webkit-playsinline muted preload="metadata"></video>
        <span class="chat-attach-label">Video listo para enviar</span>
        <button type="button" class="chat-attach-remove" id="video-attach-remove" aria-label="Quitar video">✕</button>
      </div>

      <form class="chat-input-row" id="chat-form">
        <button type="button" class="chat-attach-btn" id="attach-btn" title="Adjuntar foto" aria-label="Adjuntar foto">
          ${ICONS.camera}
        </button>
        <input type="file" id="attach-file" accept="image/*" hidden />
        <button type="button" class="chat-attach-btn" id="video-attach-btn" title="Adjuntar video" aria-label="Adjuntar video">${ICONS.video}</button>
        <!-- Sin capture (iOS lo forzaría a solo-cámara); accept = los 3
             mime del bucket videos (0039). -->
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
  const muteBtn = container.querySelector('#mute-btn');
  const headAvatarEl = container.querySelector('#conv-avatar');
  const headTitleEl = container.querySelector('#conv-title');
  const headSubEl = container.querySelector('#conv-subtitle');

  // ====== Buffer local de mensajes (solo esta página) ======
  // Igual que chat.js: el volumen puede crecer y el hilo es page-scoped —
  // el store solo conoce la metadata del inbox (preview/unread).
  let messages = [];
  const pendingByContent = new Map(); // optimisticKey → [tempId, ...] (FIFO — ver pendingPush)
  const userCache = new Map();

  // ====== Ciclo de vida ======
  // Registrar el hilo como "activo" ANTES de cualquier await: el handler
  // global de 'conversations-feed' consulta este flag para no marcar
  // unread lo que el usuario está mirando en este momento.
  setActiveConversation(conversationId);
  store.markConversationRead(conversationId);

  let unsubscribeRealtime = () => {};
  const teardown = () => {
    if (_activeTeardown !== teardown) return; // otro montaje ya limpió
    _activeTeardown = null;
    setActiveConversation(null);
    unsubscribeRealtime();
    // Revocar el blob URL de un video adjuntado y nunca enviado: sin esto
    // cada composer abandonado dejaba el File pinneado en memoria de por
    // vida (la SPA nunca se descarga). clearVideoAttachment está hoisted.
    clearVideoAttachment();
    // Soltar el defer de paint (video en reproducción) y los listeners de
    // re-sync de suspensión — page-scoped, mueren con la página.
    if (paintDeferCleanup) paintDeferCleanup();
    detachResyncListeners();
    detachListener(window, HASH_TEARDOWN_KEY);
  };
  _activeTeardown = teardown;
  // El router no avisa al salir de una ruta: back-gesture / bottom-nav /
  // deep-link cambian el hash sin pasar por nuestros botones. Escuchamos
  // hashchange y desmontamos — salvo que el hash siga apuntando a ESTE
  // hilo (eco del _syncHash de nuestra propia navegación de entrada).
  replaceListener(window, 'hashchange', () => {
    const match = router.matchHash(window.location.hash);
    if (match && match.name === 'chat-conversation'
        && match.params.conversationId === conversationId) return;
    teardown();
  }, HASH_TEARDOWN_KEY);

  // ====== Cabecera ======
  function updateHeader() {
    const c = store.getConversationById(conversationId) || conv;
    const other = !isGroup ? (store.getUserById(c.otherUserId) || userCache.get(c.otherUserId)) : null;
    headAvatarEl.innerHTML = isGroup
      ? avatarHTML({ name: c.title || 'Grupo', avatar: c.photo }, 'avatar-sm')
      : avatarHTML(other || { name: '?' }, 'avatar-sm');
    headTitleEl.textContent = isGroup ? (c.title || 'Grupo') : (other?.name || 'Usuario');
    headSubEl.textContent = isGroup
      ? `${(c.members || []).length} miembro${(c.members || []).length === 1 ? '' : 's'}`
      : (other?.username || '');
    muteBtn.innerHTML = c.muted ? ICONS.bellOff : ICONS.bell;
    muteBtn.title = c.muted ? 'Activar notificaciones' : 'Silenciar notificaciones';
    muteBtn.setAttribute('aria-label', muteBtn.title);
  }
  updateHeader();

  // DM cuyo autor aún no está hidratado en state.users (perfil nuevo,
  // boot a medias): fetch puntual y refresco de cabecera.
  if (!isGroup && conv.otherUserId && !store.getUserById(conv.otherUserId)) {
    fetchUserInto(conv.otherUserId, userCache).then(updateHeader);
  }

  // ====== Pintado ======
  let lastRenderedSig = '';
  // paint() reconstruye la lista entera vía innerHTML, y eso DESTRUYE
  // cualquier <video> en reproducción (el elemento se recrea pausado en
  // frame 0): cada mensaje entrante mataba un video del hilo a mitad de
  // play. Si hay un video sonando, el repintado se DIFIERE a su
  // pause/ended (flag pendingPaint); el buffer sigue acumulando y entra
  // todo junto cuando el video suelta.
  let pendingPaint = false;
  let paintDeferCleanup = null;
  function deferPaint(video) {
    pendingPaint = true;
    // Si el repintado se pospone varias veces, soltar el defer anterior:
    // sobre el video vive UN solo par de listeners, nunca se acumulan.
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
           <p>Aún no hay mensajes. ¡Saluda! 👋</p>
         </div>`
      : messages.map((m, i) => renderConvMessage(m, messages[i - 1], user.id, userCache, isGroup)).join('');

    if (wasNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  // Las fotos base64 se decodifican DESPUÉS del paint: si estábamos
  // pegados al fondo, re-pegarse cuando la imagen infla el scrollHeight.
  // (load no burbujea → captura.)
  messagesEl.addEventListener('load', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }, true);

  // Mismo re-pin para VIDEO: un <video preload="metadata"> pinta primero
  // a la altura por defecto del replaced element y CRECE al llegar la
  // metadata (un 9:16 a 240px pasa de ~120px a ~427px de alto) — sin esto
  // el último mensaje quedaba bajo el pliegue. Los media elements nunca
  // disparan 'load': su señal es 'loadedmetadata' (no burbujea → captura).
  messagesEl.addEventListener('loadedmetadata', (e) => {
    if (e.target.tagName !== 'VIDEO') return;
    const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160;
    if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }, true);

  // ====== Historial + realtime ======
  (async () => {
    try {
      messages = await listConversationMessages(conversationId);
    } catch (err) {
      console.warn('[chat-conversation] history fetch failed', err);
      messages = [];
    }
    await fillUserCache(messages, userCache);
    paint();
    requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
  })();

  unsubscribeRealtime = subscribeConversation(conversationId, async (msg) => {
    const key = optimisticKey(msg);
    if (messages.some(m => m.id === msg.id)) {
      // Ya está en el buffer (el POST resolvió antes que su eco y swapeó
      // su burbuja) — no tocar nada, y sobre todo NO consumir el tempId
      // de OTRA burbuja pendiente con la misma clave.
    } else if (pendingByContent.has(key)) {
      // Eco de nuestro propio insert optimista → swap por la fila real.
      // FIFO: el eco más viejo casa con el tempId más viejo (dos envíos
      // idénticos rápidos comparten clave; un valor escalar hacía que el
      // segundo send pisara el tempId del primero → burbuja duplicada).
      const tempId = pendingShift(pendingByContent, key);
      const idx = messages.findIndex(m => m.id === tempId);
      if (idx !== -1) messages[idx] = msg;
      else messages.push(msg); // el temp ya no está — no perder la fila real
      lastRenderedSig = ''; // el swap puede no cambiar length+lastId
    } else {
      messages.push(msg);
      // Mensaje ajeno con el hilo ABIERTO: leído al instante (el feed
      // global ya no lo marcó unread gracias a setActiveConversation,
      // esto sincroniza además last_read_at con el servidor).
      if (msg.userId !== user.id) store.markConversationRead(conversationId);
    }
    if (!userCache.has(msg.userId) && !store.getUserById(msg.userId)) {
      await fetchUserInto(msg.userId, userCache);
    }
    paint();
  });

  // ====== Backfill tras suspensión (FIX PWA) ======
  // postgres_changes NO repite eventos perdidos con el socket muerto
  // (iOS mata el WS al bloquear el teléfono): los mensajes que llegaron
  // mientras tanto jamás entraban al hilo abierto (el inbox sí los
  // preview-aba — se re-hidrata en el resume global). Al volver a ser
  // visibles re-pedimos el historial completo y mezclamos por id:
  // ningún duplicado, y las filas optimistas (_pending/_syncFailed) que
  // el server aún no refleja se conservan al final del buffer.
  // Throttle de 5s: visibilitychange y pageshow suelen llegar en ráfaga
  // y el resume global ya cubre el resto de datos.
  let lastResyncAt = 0;
  const resyncMessages = async () => {
    const now = Date.now();
    if (now - lastResyncAt < 5000) return;
    lastResyncAt = now;
    let fresh;
    try {
      fresh = await listConversationMessages(conversationId);
    } catch {
      return; // sin red — el próximo resume reintenta
    }
    if (_activeTeardown !== teardown) return; // la página ya se desmontó
    const freshIds = new Set(fresh.map(m => m.id));
    const localExtras = messages.filter(m => !freshIds.has(m.id) && (m._pending || m._syncFailed));
    messages = [...fresh, ...localExtras];
    lastRenderedSig = ''; // el merge puede cambiar el medio sin tocar length+lastId
    paint();
    store.markConversationRead(conversationId);
  };
  const onVisibilityResync = () => {
    if (document.visibilityState === 'visible') resyncMessages();
  };
  const onPageShowResync = (e) => {
    if (e && e.persisted) resyncMessages(); // vuelta desde el bfcache
  };
  document.addEventListener('visibilitychange', onVisibilityResync);
  window.addEventListener('pageshow', onPageShowResync);
  // Hoisted: teardown() la invoca aunque esté declarada después de él.
  function detachResyncListeners() {
    document.removeEventListener('visibilitychange', onVisibilityResync);
    window.removeEventListener('pageshow', onPageShowResync);
  }

  // ====== Adjuntar foto ======
  const attachBtn = container.querySelector('#attach-btn');
  const attachFile = container.querySelector('#attach-file');
  const attachPreview = container.querySelector('#attach-preview');
  const attachThumb = container.querySelector('#attach-thumb');
  const attachRemove = container.querySelector('#attach-remove');
  let pendingImage = null;

  function clearAttachment() {
    pendingImage = null;
    attachThumb.removeAttribute('src');
    attachPreview.hidden = true;
  }

  attachBtn.addEventListener('click', () => attachFile.click());
  attachFile.addEventListener('change', async () => {
    const f = attachFile.files && attachFile.files[0];
    attachFile.value = ''; // volver a elegir el mismo archivo debe re-disparar change
    if (!f) return;
    try {
      // 1024px/q0.78 (y no el 1280/0.82 de create-post): el mensaje viaja
      // ENTERO por postgres_changes y Realtime recorta del payload los
      // campos de una fila que supere max_record_bytes (~1MiB por
      // defecto) — una foto detallada a 1280/0.82 puede pasarse y el
      // receptor con el hilo abierto vería una burbuja sin imagen hasta
      // reabrir. A 1024/0.78 el base64 queda con margen bajo el cap.
      pendingImage = await fileToResizedDataURL(f, 1024, 0.78);
      attachThumb.src = pendingImage; // data URL de nuestro canvas — origen confiable
      attachPreview.hidden = false;
      clearVideoAttachment(); // foto y video son mutuamente excluyentes
      input.focus();
    } catch (err) {
      console.warn('[chat-conversation] image resize failed', err);
      showToast('No se pudo procesar la imagen', 'error');
    }
  });
  attachRemove.addEventListener('click', clearAttachment);

  // ====== Adjuntar video (0039) ======
  // El File validado se sube a Storage al ENVIAR (no aquí): el optimistic
  // row necesita la URL pública definitiva — misma razón que create-post.
  const videoAttachBtn = container.querySelector('#video-attach-btn');
  const videoAttachFile = container.querySelector('#video-attach-file');
  const videoAttachPreview = container.querySelector('#video-attach-preview');
  const videoAttachThumb = container.querySelector('#video-attach-thumb');
  let pendingVideo = null;
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
    videoAttachFile.value = '';
    if (!f) return;
    const res = await validateVideoFile(f);
    if (!res.ok) {
      showToast(res.error, 'error', 5000);
      return;
    }
    clearAttachment(); // foto y video son mutuamente excluyentes
    clearVideoAttachment();
    pendingVideo = f;
    pendingVideoBlobUrl = URL.createObjectURL(f);
    videoAttachThumb.src = pendingVideoBlobUrl;
    videoAttachPreview.hidden = false;
    input.focus();
  });
  const videoAttachRemove = container.querySelector('#video-attach-remove');
  videoAttachRemove.addEventListener('click', clearVideoAttachment);

  // ====== Envío optimista ======
  const sendBtn = form.querySelector('.chat-send');

  // Bloqueo TOTAL del composer durante la subida: además de send+input,
  // los pickers de foto/video y las X de los previews. Sin esto, una foto
  // adjuntada mid-upload era borrada en silencio por el clearAttachment()
  // post-subida (capturamos image/videoToSend ANTES del await).
  const setComposerLock = (locked) => {
    sendBtn.disabled = locked;
    input.disabled = locked;
    attachBtn.disabled = locked;
    videoAttachBtn.disabled = locked;
    attachRemove.disabled = locked;
    videoAttachRemove.disabled = locked;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const image = pendingImage;
    const videoToSend = pendingVideo;
    if (!text && !image && !videoToSend) return;

    // Video: subir a Storage ANTES del optimistic row (la burbuja pinta
    // la URL pública definitiva y esa URL entra en la clave de dedupe del
    // eco realtime). Spinner en el send + composer bloqueado mientras
    // sube; si falla, el adjunto queda puesto para reintentar. El path
    // del objeto se conserva para poder borrarlo si el insert del
    // mensaje falla después (huérfanos en el bucket videos).
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
    clearAttachment();
    input.focus();

    const tempId = 'pending_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const optimistic = {
      id: tempId,
      conversationId,
      userId: user.id,
      content: text || null,
      image: image || null,
      videoUrl,
      createdAt: new Date(),
      _pending: true,
    };
    messages.push(optimistic);
    pendingPush(pendingByContent, optimisticKey(optimistic), tempId);
    paint();

    try {
      // API directa (no store.sendConversationMessage): el buffer es
      // nuestro y el push lo dispara la propia api — exactamente UN push
      // por mensaje. El preview del inbox se refresca con la fila real.
      const real = await sendConversationMessage(conversationId, { content: text || null, image, videoUrl });
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
        lastRenderedSig = '';
        paint();
        store.touchConversation(conversationId, real);
      }
    } catch (err) {
      console.error('[chat-conversation] send failed', {
        code: err?.code, message: err?.message,
        details: err?.details, hint: err?.hint, conversationId,
      });
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
      lastRenderedSig = '';
      paint();
      showToast('No se envió: ' + describeApiError(err), 'error', 5000);
    }
  });

  // ====== Cabecera: back / mute / identidad ======
  container.querySelector('#back-btn').addEventListener('click', () => {
    teardown();
    router.navigate('chats-private');
  });

  muteBtn.addEventListener('click', () => {
    // Optimista con rollback en el store; esta página no está en las
    // rutas auto-repintadas, así que actualizamos el botón a mano.
    store.toggleConversationMute(conversationId);
    updateHeader();
    const c = store.getConversationById(conversationId);
    showToast(c?.muted ? 'Conversación silenciada 🔕' : 'Notificaciones activadas 🔔', 'info');
  });

  // profile-other resuelve EXCLUSIVAMENTE vía store.getUserById y con un
  // miss rebota al muro: un autor que solo vive en el userCache local
  // (perfil creado después de la hidratación) hay que inyectarlo al store
  // ANTES de navegar; si tampoco está en cache, mejor ignorar el tap que
  // arrancar al usuario del hilo y soltarlo en el muro sin explicación.
  const ensureUserInStore = (userId) => {
    if (store.getUserById(userId)) return true;
    const cached = userCache.get(userId);
    if (!cached) return false;
    store.setState({ users: [...(store.getState().users || []), cached] });
    return true;
  };

  container.querySelector('#conv-head').addEventListener('click', () => {
    if (isGroup) {
      openGroupDetails();
    } else if (conv.otherUserId) {
      if (!ensureUserInStore(conv.otherUserId)) return;
      teardown();
      store.setState({ viewingUserId: conv.otherUserId });
      router.navigate('profile-other', { userId: conv.otherUserId });
    }
  });

  // ====== Delegación en la lista: perfiles + lightbox de fotos ======
  messagesEl.addEventListener('click', (e) => {
    const img = e.target.closest('[data-action="open-image"]');
    if (img) {
      // getAttribute devuelve el valor ya decodificado (sin entidades) —
      // re-pasar por safeImageSrc antes de re-interpolar en el lightbox.
      showImageLightbox(safeImageSrc(img.getAttribute('src')));
      return;
    }
    const trigger = e.target.closest('[data-action="view-profile"]');
    if (!trigger) return;
    const userId = trigger.dataset.userId;
    if (!userId || userId === user.id) return;
    if (!ensureUserInStore(userId)) return;
    teardown();
    store.setState({ viewingUserId: userId });
    router.navigate('profile-other', { userId });
  });

  // ====== Panel de detalles del grupo ======
  function openGroupDetails() {
    const c = store.getConversationById(conversationId);
    if (!c || c.kind !== 'group') return;
    const isOwner = c.myRole === 'owner';
    const members = c.members || [];

    const membersHTML = members.map((m) => {
      const u = store.getUserById(m.userId) || userCache.get(m.userId) || { name: 'Usuario' };
      const isMe = m.userId === user.id;
      return `
        <div class="group-member-row" ${!isMe ? `data-action="view-profile" data-user-id="${m.userId}"` : ''}>
          ${avatarHTML(u, 'avatar-sm')}
          <span class="group-member-name">${sanitize(u.name)}${isMe ? ' (tú)' : ''}</span>
          ${m.role === 'owner' ? '<span class="badge badge-orange group-owner-badge" title="Creador del grupo">Owner</span>' : ''}
        </div>
      `;
    }).join('');

    const overlay = createModal(`
      <div class="modal" style="max-height:92dvh;overflow-y:auto;">
        <div class="modal-handle"></div>
        <div style="text-align:center;margin-bottom:var(--space-md);">
          <div style="display:flex;justify-content:center;margin-bottom:var(--space-sm);">
            ${avatarHTML({ name: c.title || 'Grupo', avatar: c.photo }, 'avatar-xl')}
          </div>
          <div class="modal-title" style="margin-bottom:2px;">${sanitize(c.title || 'Grupo')}</div>
          <div style="font-size:var(--text-xs);color:var(--text-tertiary);">
            ${members.length} miembro${members.length === 1 ? '' : 's'}
          </div>
        </div>

        <div class="group-members-list">${membersHTML}</div>

        <div style="display:flex;flex-direction:column;gap:var(--space-sm);margin-top:var(--space-md);">
          ${isOwner ? `<button type="button" class="btn btn-secondary btn-full btn-sm" id="grp-add">Añadir miembros</button>` : ''}
          ${isOwner ? `<button type="button" class="btn btn-secondary btn-full btn-sm" id="grp-edit">Cambiar nombre/foto</button>` : ''}
          <button type="button" class="btn btn-secondary btn-full btn-sm" id="grp-mute">
            ${c.muted ? 'Activar notificaciones' : 'Silenciar notificaciones'}
          </button>
          <button type="button" class="btn btn-full btn-sm conv-danger-btn" id="grp-leave">Salir del grupo</button>
        </div>
      </div>
    `);

    // Tap en un miembro → su perfil (cerrando hilo + modal). Igual que en
    // la lista: si el perfil no es resoluble ni desde el cache, ignorar.
    overlay.querySelectorAll('[data-action="view-profile"]').forEach((row) => {
      row.addEventListener('click', () => {
        const userId = row.dataset.userId;
        if (!ensureUserInStore(userId)) return;
        overlay.close();
        teardown();
        store.setState({ viewingUserId: userId });
        router.navigate('profile-other', { userId });
      });
    });

    overlay.querySelector('#grp-add')?.addEventListener('click', () => {
      overlay.close();
      openMemberPickerModal({
        title: 'Añadir miembros',
        confirmLabel: 'Añadir',
        excludeIds: members.map(m => m.userId),
        max: 30 - members.length,
        onConfirm: async (ids) => {
          const ok = await store.addGroupMembers(conversationId, ids);
          if (ok) {
            showToast('Miembros añadidos ✓', 'success');
            updateHeader();
          }
          return ok;
        },
      });
    });

    overlay.querySelector('#grp-edit')?.addEventListener('click', () => {
      overlay.close();
      openEditGroupModal();
    });

    overlay.querySelector('#grp-mute').addEventListener('click', () => {
      store.toggleConversationMute(conversationId);
      updateHeader();
      const cc = store.getConversationById(conversationId);
      overlay.querySelector('#grp-mute').textContent =
        cc?.muted ? 'Activar notificaciones' : 'Silenciar notificaciones';
    });

    const leaveBtn = overlay.querySelector('#grp-leave');
    leaveBtn.addEventListener('click', () => {
      // Confirm de dos toques (mismo patrón que el menú del inbox).
      if (!leaveBtn.dataset.armed) {
        leaveBtn.dataset.armed = '1';
        leaveBtn.textContent = '¿Seguro? Toca de nuevo para salir';
        return;
      }
      overlay.close();
      teardown();
      store.leaveConversation(conversationId);
      showToast('Saliste del grupo', 'info');
      router.navigate('chats-private');
    });
  }

  // Cambiar nombre/foto (solo owner — RLS lo re-verifica server-side).
  function openEditGroupModal() {
    const c = store.getConversationById(conversationId);
    if (!c) return;
    let photoData = c.photo || null;

    const overlay = createModal(`
      <div class="modal">
        <div class="modal-handle"></div>
        <div class="modal-title">Editar grupo</div>

        <div class="input-group mb-md">
          <label class="input-label">Nombre del grupo *</label>
          <input type="text" class="input" id="edit-group-name" maxlength="60" value="${sanitize(c.title || '')}" />
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Foto</label>
          <div class="group-photo-row">
            <img id="edit-group-photo" class="group-photo-preview" alt=""
                 ${safeImageSrc(photoData) ? `src="${safeImageSrc(photoData)}"` : 'hidden'} />
            <button type="button" class="btn btn-ghost btn-sm" id="edit-photo-pick">
              ${photoData ? 'Cambiar foto' : 'Subir foto'}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" id="edit-photo-remove" ${photoData ? '' : 'hidden'}>Quitar</button>
            <input type="file" id="edit-photo-file" accept="image/*" hidden />
          </div>
        </div>

        <button class="btn btn-primary btn-full" id="edit-group-save">Guardar</button>
      </div>
    `);

    const nameEl = overlay.querySelector('#edit-group-name');
    const fileEl = overlay.querySelector('#edit-photo-file');
    const previewEl = overlay.querySelector('#edit-group-photo');
    const pickBtn = overlay.querySelector('#edit-photo-pick');
    const removeBtn = overlay.querySelector('#edit-photo-remove');

    pickBtn.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      const f = fileEl.files && fileEl.files[0];
      fileEl.value = '';
      if (!f) return;
      try {
        photoData = await fileToResizedDataURL(f, 256, 0.8);
        previewEl.src = photoData;
        previewEl.hidden = false;
        removeBtn.hidden = false;
        pickBtn.textContent = 'Cambiar foto';
      } catch (err) {
        console.warn('[chat-conversation] group photo resize failed', err);
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

    overlay.querySelector('#edit-group-save').addEventListener('click', () => {
      const title = nameEl.value.trim();
      if (!title) { showToast('El grupo necesita un nombre', 'warning'); nameEl.focus(); return; }
      if (title.length > 60) { showToast('El nombre no puede superar 60 caracteres', 'warning'); return; }
      // Optimista con rollback en el store — sin spinner: el cambio se ve
      // al instante y un fallo lo revierte con toast.
      store.updateGroupMeta(conversationId, { title, photo: photoData });
      overlay.close();
      updateHeader();
      showToast('Grupo actualizado ✓', 'success');
    });
  }
}

// ---------------------------------------------------------------------
// Shell de carga para el deep-link frío (cabecera aún sin hidratar).
// ---------------------------------------------------------------------
function renderLoadingShell(container) {
  container.innerHTML = `
    <div class="page chat-page">
      <div class="chat-header">
        <button class="chat-back" id="back-btn" aria-label="Volver">${ICONS.back}</button>
        <div class="chat-header-info">
          <div class="chat-header-title">Cargando…</div>
        </div>
      </div>
      <div class="chat-messages">
        <div class="chat-empty"><div class="chat-empty-icon">💬</div><p>Cargando conversación...</p></div>
      </div>
    </div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => router.navigate('chats-private'));
}

// Dedupe del eco realtime del propio insert. userId+content no basta con
// media (dos fotos sin texto colisionarían siempre): incluimos la
// longitud del base64 y la url del video en la clave. La entrada se
// borra en cuanto llega el eco, así que la ventana de colisión es mínima.
function optimisticKey(msg) {
  return `${msg.userId}::${msg.content || ''}::${msg.image ? 'i' + msg.image.length : ''}::${msg.videoUrl || ''}`;
}

// ---------------------------------------------------------------------
// pendingByContent es Map<key, tempId[]> y NO Map<key, tempId>: dos
// envíos idénticos rápidos ("jaja" Enter, "jaja" Enter) comparten clave,
// y con un valor escalar el segundo set() pisaba el tempId del primero —
// el eco realtime casaba con la burbuja equivocada y el POST re-escribía
// la fila real en la otra: mensaje duplicado en pantalla. FIFO: push al
// enviar, shift cuando llega el eco (el más viejo casa con el más viejo),
// remove puntual cuando resuelve/falla el POST. La clave se borra al
// vaciarse el array. Mismo patrón que chat.js.
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

// ---------------------------------------------------------------------
// Burbuja de mensaje: texto sanitizado, foto (tap → lightbox bloqueado)
// o video (subido por el flujo de adjuntos; aquí solo se renderiza).
// safeImageSrc valida y escapa ambas urls — nunca interpolar m.image /
// m.videoUrl crudos. Sin loading="lazy": las fotos son base64 y iOS
// no las pinta con lazy.
// ---------------------------------------------------------------------
function renderConvMessage(m, prev, currentUserId, userCache, isGroup) {
  const author = store.getUserById(m.userId) || userCache.get(m.userId);
  if (!author) return '';
  const isMine = m.userId === currentUserId;
  // Defensivo: createdAt siempre debería ser Date (convMessageFromRow),
  // pero un payload realtime recortado no debe tumbar el hilo entero.
  const sameAsPrev = prev
    && prev.userId === m.userId
    && ((m.createdAt?.getTime?.() || 0) - (prev.createdAt?.getTime?.() || 0)) < 5 * 60_000;

  const img = m.image ? safeImageSrc(m.image) : null;
  const vid = !img && m.videoUrl ? safeImageSrc(m.videoUrl) : null;
  let bubble;
  if (img) {
    bubble = `
      <div class="chat-msg-bubble chat-msg-media-bubble">
        <img class="chat-msg-image" src="${img}" alt="Foto" data-action="open-image" draggable="false" />
        ${m.content ? `<div class="chat-msg-caption">${sanitize(m.content)}</div>` : ''}
      </div>`;
  } else if (vid) {
    bubble = `
      <div class="chat-msg-bubble chat-msg-media-bubble">
        <video class="chat-msg-video" controls playsinline webkit-playsinline preload="metadata" src="${vid}"></video>
        ${m.content ? `<div class="chat-msg-caption">${sanitize(m.content)}</div>` : ''}
      </div>`;
  } else if (m.content) {
    bubble = `<div class="chat-msg-bubble">${sanitize(m.content)}</div>`;
  } else {
    // Sin content, foto ni video: pasa cuando Realtime recorta del
    // payload un image_url que supera max_record_bytes (~1MiB). Un
    // placeholder en vez de una burbuja vacía; el backfill de
    // visibilidad / la reentrada al hilo traen la foto completa.
    bubble = `<div class="chat-msg-bubble">📷 Foto</div>`;
  }

  return `
    <div class="chat-msg ${isMine ? 'chat-msg-mine' : ''} ${sameAsPrev ? 'chat-msg-stacked' : ''} ${m._pending ? 'chat-msg-pending' : ''} ${m._syncFailed ? 'chat-msg-failed' : ''}" data-msg-id="${m.id}">
      ${sameAsPrev
        ? '<div class="chat-msg-avatar-slot"></div>'
        : `<span data-action="view-profile" data-user-id="${m.userId}" style="cursor:pointer;display:inline-flex;">${avatarHTML(author, 'avatar-sm chat-msg-avatar-slot')}</span>`
      }
      <div class="chat-msg-body">
        ${sameAsPrev ? '' : `
          <div class="chat-msg-meta">
            <span class="chat-msg-author" data-action="view-profile" data-user-id="${m.userId}" style="cursor:pointer;">${sanitize(author.name)}</span>
            ${isGroup ? `<span class="badge ${roleBadgeClass(author.role)} chat-msg-role">${roleTitle(author.role)}</span>` : ''}
            <span class="chat-msg-time">${formatRelative(m.createdAt)}</span>
          </div>
        `}
        ${bubble}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Lightbox de foto — clon local del visor de flyers de party-detail
// (mismos bloqueos de guardado: callout iOS, drag, pointer-events:none
// en el img, contextmenu). Clase modal-overlay para que el teardown del
// router lo barra en cualquier navegación; hashchange cierra además para
// no filtrar el listener de teclado.
// ---------------------------------------------------------------------
function showImageLightbox(src) {
  if (!src) return;
  if (document.querySelector('.chat-image-lightbox-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay chat-image-lightbox-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:16px;-webkit-user-select:none;user-select:none;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
  overlay.innerHTML = `
    <button type="button" class="chat-image-lightbox-close" aria-label="Cerrar"
            style="position:absolute;top:calc(env(safe-area-inset-top, 0px) + 12px);right:16px;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.25);color:#fff;font-size:1.3rem;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</button>
    <img src="${src}" alt="Foto" draggable="false"
         style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.6);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none;user-drag:none;pointer-events:none;" />
  `;
  const close = () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    overlay.remove();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', close);
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  document.body.appendChild(overlay);
}

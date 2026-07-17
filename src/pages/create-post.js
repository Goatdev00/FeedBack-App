// ============================================
// FEEDBACK — Create Post Page
// ============================================

import { store, ICONS, REPORT_CATEGORIES } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast, showPointsToast } from '../utils/toast.js';
import { avatarHTML, sanitize, safeImageSrc } from '../utils/helpers.js';
import { fileToResizedDataURL, fileToResizedBlob, uploadImageToStorage, removeUploadedImage } from '../utils/image.js';
import { validateVideoFile, uploadVideoToStorage, removeUploadedVideo } from '../utils/video.js';

export function renderCreatePost(container, params = {}) {
  const state = store.getState();
  const user = state.currentUser;
  // Modo remates: explícito por param (FAB/selector de la pestaña Remates)
  // o inferido del kind de la party vinculada ("Publicar aquí" desde el
  // detalle de un remate llega solo con partyId).
  const feedParam = params.feed === 'remates';
  // En modo remates-libre partyId es null A PROPÓSITO: no caer al
  // viewingPartyId pegajoso o el post libre se colgaría de la última
  // fiesta visitada.
  const partyId = params.partyId || (feedParam ? null : state.viewingPartyId);
  const party = store.getPartyById(partyId);
  const isRemates = feedParam || party?.kind === 'remate';
  // Post libre (sin evento): solo existe en el muro de remates.
  const isFreePost = isRemates && !partyId;

  if (!party && !isFreePost) {
    // Sin party resoluble: en fiestas SIEMPRE se rebota al selector; en
    // remates solo si venía con un partyId concreto que ya no está en el
    // store (deep link frío). El feed va SIEMPRE explícito: sin él,
    // select-party cae al fallback de store.wallTab, que puede ser
    // 'remates' aunque este post fuera de fiestas.
    router.navigate('select-party', { feed: isRemates ? 'remates' : 'fiestas' });
    return;
  }

  if (!user) {
    router.navigate('login');
    return;
  }

  const postsToday = store.getUserPostsToday(user.id);
  const remaining = 5 - postsToday;

  container.innerHTML = `
    <div class="page" id="create-post-page">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-sm);margin-bottom:var(--space-md);">
        <button class="back-btn" id="back-btn" style="margin-bottom:0;">
          ${ICONS.back}
          <span>Volver</span>
        </button>
        <div class="post-counter" title="Publicaciones hechas hoy">
          📝 <span class="post-counter-value">${postsToday}</span>/5 hoy
        </div>
        <button class="btn btn-primary btn-sm" id="publish-btn">
          Publicar
        </button>
      </div>

      <!-- Party tag (like Instagram location). En remates-libre no hay
           evento: chip fijo que identifica la sección, con el mismo botón
           Cambiar (vuelve al selector en modo remates). -->
      <div class="card" style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);padding:var(--space-sm) var(--space-md);">
        ${party ? `
          ${(() => { const f = safeImageSrc(party.flyer); return f
            ? `<img src="${f}" alt="" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0;" />`
            : `<span style="font-size:1.2rem;">${isRemates ? '🔥' : '📍'}</span>`; })()}
          <div style="flex:1;">
            <div style="font-size:var(--text-sm);font-weight:600;">${sanitize(party.name)}</div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">${sanitize(party.venue)} · ${sanitize(party.city)}</div>
          </div>
        ` : `
          <div style="flex:1;">
            <div style="font-size:var(--text-sm);font-weight:600;">Remate libre</div>
            <div style="font-size:var(--text-xs);color:var(--text-tertiary);">Publicación sin evento en el muro de remates</div>
          </div>
        `}
        <button class="btn btn-ghost btn-sm" id="change-party" style="font-size:var(--text-xs);">Cambiar</button>
      </div>

      <!-- Author info -->
      <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:var(--space-md);">
        ${avatarHTML(user, 'avatar-sm')}
        <span style="font-size:var(--text-sm);font-weight:500;">${sanitize(user.name)}</span>
        <span class="post-counter" style="margin-left:auto;font-size:0.625rem;">
          ${remaining} publicaciones restantes
        </span>
      </div>

      <!-- Post content. Caja de input normal (.input aporta padding y
           borde): el hack viejo de border:none+padding:0 dejaba el texto
           pegado a los bordes del recuadro. -->
      <textarea
        class="input textarea"
        id="post-content"
        placeholder="${isRemates
          ? '¿Qué está pasando en el remate? Comparte tu experiencia...'
          : `¿Qué está pasando en ${sanitize(party.name)}? Comparte tu experiencia...`}"
        maxlength="500"
        style="min-height:140px;font-size:var(--text-base);resize:none;"
        autofocus
      ></textarea>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:var(--space-sm);">
        <span style="font-size:var(--text-xs);color:var(--text-muted);" id="char-counter">0/500</span>
        <span style="font-size:var(--text-xs);color:var(--text-muted);">Desaparece en 7 días</span>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:var(--border-subtle);margin:var(--space-lg) 0;"></div>

      <!-- Media options: foto O video, nunca ambos (elegir uno limpia
           el otro — un post tiene un solo slot de media). -->
      <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-lg);">
        <button class="btn btn-secondary btn-sm" id="add-photo">
          ${ICONS.image}
          Foto
        </button>
        <button class="btn btn-secondary btn-sm" id="add-video">
          ${ICONS.video}
          Video
        </button>
      </div>

      <!-- Photo preview -->
      <div id="photo-preview" style="display:none;margin-bottom:var(--space-lg);position:relative;">
        <img id="preview-img" style="width:100%;border-radius:var(--radius-md);max-height:300px;object-fit:cover;" />
        <button class="btn btn-icon btn-secondary" id="remove-photo" style="position:absolute;top:8px;right:8px;width:32px;height:32px;">
          ${ICONS.x}
        </button>
      </div>
      <input type="file" id="photo-file" accept="image/*" style="display:none;" />

      <!-- Video preview — controls+playsinline: en iOS un video sin
           playsinline secuestra la pantalla a fullscreen al reproducir.
           preload=metadata pinta el primer frame sin bajar el archivo. -->
      <div id="video-preview" style="display:none;margin-bottom:var(--space-lg);position:relative;">
        <video id="preview-video" class="create-post-video" controls playsinline webkit-playsinline preload="metadata" muted></video>
        <button class="btn btn-icon btn-secondary" id="remove-video" style="position:absolute;top:8px;right:8px;width:32px;height:32px;z-index:1;">
          ${ICONS.x}
        </button>
      </div>
      <!-- Sin atributo capture: en iOS capture fuerza SOLO cámara y
           esconde la fototeca. accept explícito = los 3 mime del bucket. -->
      <input type="file" id="video-file" accept="video/mp4,video/quicktime,video/webm" style="display:none;" />

      <!-- Live Report Section (solo con evento vinculado: un post libre
           no tiene fiesta/remate que reportar) -->
      ${party ? `
        <div style="margin-bottom:var(--space-lg);">
          <h3 style="font-size:var(--text-sm);font-weight:600;color:var(--text-secondary);margin-bottom:var(--space-md);">
            ¿Cómo está ${isRemates ? 'el remate' : 'la fiesta'}? (opcional)
          </h3>
          <div class="report-grid" id="report-grid">
            ${REPORT_CATEGORIES.map(cat => `
              <div class="report-chip" data-report="${cat.id}">
                <span class="report-chip-emoji">${cat.emoji}</span>
                ${cat.label}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Publicar también al FINAL del formulario: tras adjuntar media y
           marcar chips el usuario está abajo del todo — subir hasta la
           cabecera para publicar era un viaje innecesario. -->
      <button class="btn btn-primary btn-full" id="publish-btn-bottom" style="margin-top:var(--space-sm);">
        Publicar
      </button>
    </div>
  `;

  let selectedReports = [];
  // Foto: el base64 del preview se conserva como FALLBACK de publicación
  // (si Storage no está disponible el post sale igual con él, como
  // siempre); el File original se guarda para re-procesarlo a Blob y
  // subirlo al bucket `images` (0040) recién al publicar.
  let photoData = null;
  let photoFile = null;
  // Video: se guarda el File validado y se sube a Storage RECIÉN al
  // publicar (addPost es optimista-instantáneo — la URL pública tiene que
  // existir ANTES de crear el post). El blob URL es solo para el preview.
  let videoData = null;
  let videoBlobUrl = null;

  // Token de montaje: la raíz del DOM que ESTE render creó. Tras el await
  // de la subida hay que verificar que siga conectada — si el usuario
  // navegó (back-gesture/hashchange esquivan los botones bloqueados) el
  // handler viejo NO debe publicar ni forzar navigate('wall') encima de
  // la página nueva.
  const pageEl = container.querySelector('#create-post-page');

  // Candado de subida: mientras el video sube, TODA salida/mutación de la
  // página queda bloqueada (Back/Cambiar navegarían con la subida en
  // vuelo; quitar el adjunto mid-upload publicaría igual el File ya
  // capturado por el closure; los chips mutarían un post ya en curso).
  let uploading = false;
  const setUploadLock = (locked) => {
    uploading = locked;
    ['#back-btn', '#change-party', '#add-photo', '#add-video', '#remove-photo', '#remove-video']
      .forEach((sel) => {
        const el = container.querySelector(sel);
        if (el) el.disabled = locked;
      });
    container.querySelectorAll('.report-chip').forEach((chip) => {
      // Los chips son divs (sin .disabled): pointer-events + el guard del
      // flag `uploading` en su handler.
      chip.style.pointerEvents = locked ? 'none' : '';
      chip.style.opacity = locked ? '0.5' : '';
    });
  };

  // Back / Change party — ambos vuelven al selector conservando el modo.
  // El feed va SIEMPRE explícito: sin él select-party hereda store.wallTab
  // (que puede ser 'remates' aunque este post sea de fiestas — p.ej.
  // "Publicar aquí" desde la agenda con la pestaña Remates activa) y
  // soltaría al usuario en el selector equivocado.
  const backToSelector = () => {
    if (uploading) return;
    clearVideo(); // liberar el blob del preview al abandonar el composer
    router.navigate('select-party', { feed: isRemates ? 'remates' : 'fiestas' });
  };
  container.querySelector('#back-btn').addEventListener('click', backToSelector);
  container.querySelector('#change-party').addEventListener('click', backToSelector);

  // Char counter
  const textarea = container.querySelector('#post-content');
  const counter = container.querySelector('#char-counter');
  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length}/500`;
  });

  // Photo
  const photoBtn = container.querySelector('#add-photo');
  const fileInput = container.querySelector('#photo-file');
  const preview = container.querySelector('#photo-preview');
  const previewImg = container.querySelector('#preview-img');

  // Video
  const videoBtn = container.querySelector('#add-video');
  const videoInput = container.querySelector('#video-file');
  const videoPreview = container.querySelector('#video-preview');
  const previewVideo = container.querySelector('#preview-video');

  const clearPhoto = () => {
    photoData = null;
    photoFile = null;
    preview.style.display = 'none';
    fileInput.value = '';
  };
  const clearVideo = () => {
    videoData = null;
    // Revocar SIEMPRE el blob del preview — 25MB retenidos en memoria es
    // justo lo que revienta Safari iOS en gama baja.
    if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); videoBlobUrl = null; }
    previewVideo.removeAttribute('src');
    previewVideo.load();
    videoPreview.style.display = 'none';
    videoInput.value = '';
  };

  photoBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Downscale + JPEG-compress so post photos don't get stored as
      // multi-MB base64 (which bloats the feed query and localStorage).
      photoData = await fileToResizedDataURL(file, 1280, 0.82);
      photoFile = file; // el original se re-procesa a Blob al publicar
      previewImg.src = photoData;
      preview.style.display = 'block';
      clearVideo(); // foto y video son mutuamente excluyentes
    } catch {
      showToast('No se pudo procesar la imagen', 'error');
    }
  });

  container.querySelector('#remove-photo').addEventListener('click', clearPhoto);

  videoBtn.addEventListener('click', () => videoInput.click());
  videoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // iOS "prepara" (exporta) el video de Fotos ANTES de disparar change,
    // así que aquí ya tenemos el archivo real. Validar puede tardar un
    // instante (lee metadata) — feedback en el propio botón.
    videoBtn.disabled = true;
    videoBtn.textContent = 'Revisando…';
    const res = await validateVideoFile(file);
    videoBtn.disabled = false;
    videoBtn.innerHTML = `${ICONS.video} Video`;
    if (!res.ok) {
      videoInput.value = '';
      showToast(res.error, 'error', 5000);
      return;
    }
    clearPhoto(); // foto y video son mutuamente excluyentes
    if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
    videoData = file;
    videoBlobUrl = URL.createObjectURL(file);
    previewVideo.src = videoBlobUrl;
    videoPreview.style.display = 'block';
  });

  container.querySelector('#remove-video').addEventListener('click', clearVideo);

  // Report chips
  container.querySelectorAll('.report-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (uploading) return; // página congelada durante la subida
      chip.classList.toggle('active');
      const id = chip.dataset.report;
      if (selectedReports.includes(id)) {
        selectedReports = selectedReports.filter(r => r !== id);
      } else {
        selectedReports.push(id);
      }
    });
  });

  // Publish — dos botones (cabecera + final del formulario), un solo
  // handler. El estado de "subiendo" se refleja en AMBOS: el que no se
  // tocó también debe quedar bloqueado o sería una vía de doble publish.
  const publishBtn = container.querySelector('#publish-btn');
  const publishBtnBottom = container.querySelector('#publish-btn-bottom');
  const publishButtons = [publishBtn, publishBtnBottom].filter(Boolean);
  const setPublishing = (busy) => {
    publishButtons.forEach((b) => {
      b.disabled = busy;
      if (busy) b.innerHTML = '<span class="btn-spinner"></span>&nbsp;Subiendo…';
      else b.textContent = 'Publicar';
    });
  };
  const publish = async () => {
    const content = textarea.value.trim();
    if (!content && !photoData && !videoData) {
      showToast('Escribe algo o agrega una foto o un video', 'error');
      return;
    }

    if (!store.canUserPost(user.id)) {
      showToast('Has alcanzado el límite de 5 publicaciones diarias', 'warning');
      return;
    }

    // Check for duplicate content. partyId normalizado a null en ambos
    // lados: los posts libres (partyId null) comparan contra los otros
    // posts libres, no contra undefined. Solo aplica con texto: dos posts
    // solo-media (content vacío) son legítimamente distintos.
    const recentPosts = store.getState().posts.filter(p => p.userId === user.id);
    const isDuplicate = !!content && recentPosts.some(p => p.content === content && (p.partyId || null) === (partyId || null));
    if (isDuplicate) {
      showToast('Publicación duplicada. No suma puntos.', 'warning');
      return;
    }

    // La subida a Storage va ANTES de store.addPost: addPost es
    // optimista-instantáneo y necesita la URL pública definitiva. Spinner
    // + disabled en Publicar mientras sube (también evita el doble tap) y
    // candado sobre el resto de la página (Back/Cambiar/adjuntos/chips) —
    // sin él, quitar el video o navegar mid-upload publicaba igual el
    // post viejo y arrancaba al usuario de donde estuviera.
    let videoUrl = null;
    let videoPath = null;
    if (videoData) {
      setPublishing(true);
      setUploadLock(true);
      try {
        const uploaded = await uploadVideoToStorage(videoData, user.id);
        videoUrl = uploaded.url;
        videoPath = uploaded.path;
      } catch (err) {
        // El video sigue adjunto — el usuario puede reintentar sin
        // volver a elegirlo.
        setUploadLock(false);
        setPublishing(false);
        showToast('No se subió el video: ' + (err?.message || 'error desconocido'), 'error', 5000);
        return;
      }
      setUploadLock(false);

      // ¿La página sigue montada? El candado bloquea los botones, pero el
      // back-gesture (hashchange) no pasa por ellos. Si el usuario navegó
      // durante el await, ABORTAR: nada de addPost ni navigate('wall')
      // (destruiría lo que esté escribiendo ahora) — y borrar el video ya
      // subido, que sin post quedaría huérfano en el bucket.
      if (!pageEl.isConnected) {
        removeUploadedVideo(videoPath);
        // El preview tampoco sobrevive: liberar el blob (presión iOS).
        if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); videoBlobUrl = null; }
        return;
      }
    }

    // Foto: mismo esquema que el video (subir a Storage ANTES de addPost
    // para que la fila optimista lleve la URL definitiva), con una
    // diferencia clave: ante CUALQUIER fallo — bucket `images` inexistente
    // porque la 0040 aún no se aplicó (el frontend se despliega antes de
    // migrar) o un error de red — se degrada EN SILENCIO al base64 del
    // preview, el comportamiento de siempre. La foto SIEMPRE se publica;
    // Storage es solo optimización.
    let imageUrl = null;
    let imagePath = null;
    if (photoData && photoFile) {
      setPublishing(true);
      setUploadLock(true);
      try {
        const blob = await fileToResizedBlob(photoFile, 1280, 0.82);
        const uploaded = await uploadImageToStorage(blob, user.id, 'p');
        imageUrl = uploaded.url;
        imagePath = uploaded.path;
      } catch {
        imageUrl = null;
        imagePath = null;
      }
      setUploadLock(false);

      // Igual que con el video: el back-gesture (hashchange) esquiva los
      // botones bloqueados. Si el usuario navegó durante el await, ABORTAR
      // sin addPost ni navigate — y borrar la imagen ya subida, que sin
      // post quedaría huérfana en el bucket.
      if (!pageEl.isConnected) {
        if (imagePath) removeUploadedImage(imagePath);
        return;
      }
    }

    // El muro destino sale del kind del evento vinculado (el trigger
    // check_post_party_kind del server exige coherencia wall↔kind), o del
    // modo cuando es un post libre.
    const wall = isRemates ? 'remates' : 'fiestas';
    const optimisticPost = store.addPost({
      userId: user.id,
      partyId: partyId || null,
      type: videoUrl ? 'video' : (photoData ? 'photo' : 'text'),
      content: content,
      image: imageUrl || photoData,
      videoUrl,
      wall,
    });
    // addPost es optimista y su insert real se resuelve DENTRO del store
    // (sin catch en este call site). Si el insert acaba fallando, el media
    // ya subido (video o foto) quedaría huérfano en su bucket: vigilamos
    // la fila optimista y limpiamos best-effort cuando el store la marque
    // _syncFailed. Foto y video son excluyentes → como mucho UNA limpieza.
    const mediaCleanup = videoPath
      ? () => removeUploadedVideo(videoPath)
      : (imagePath ? () => removeUploadedImage(imagePath) : null);
    if (mediaCleanup && optimisticPost?.id) {
      watchPostMediaOrphan(optimisticPost.id, mediaCleanup);
    }
    // El preview local ya no se necesita — liberar el blob antes de salir.
    if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); videoBlobUrl = null; }

    // No optimistic success/points toast — those used to overlap with
    // any error toast from the API call landing ~200-500ms later, hiding
    // the failure reason from the user. The post appears immediately
    // on the wall; a toast fires only if the API actually rejects.
    // Aterriza en la pestaña donde quedó el post (p.ej. publicaste en un
    // remate desde su detalle con la pestaña fiestas activa).
    store.setState({ wallTab: wall });
    router.navigate('wall');
  };
  publishButtons.forEach((b) => b.addEventListener('click', publish));
}

// ---------------------------------------------------------------------
// Vigila la fila optimista de addPost: si el insert real falla, el store
// la deja con su tempId + _syncFailed (y notifica); si triunfa, la fila
// se SWAPEA por la del server (el tempId desaparece). En el primer caso
// ejecutamos cleanupFn — borra del bucket el media ya subido (video o
// imagen, best-effort) para no acumular huérfanos; en el segundo dejamos
// de mirar. Red de seguridad de 2min para no dejar el subscriber vivo si
// nunca llega ni el swap ni el fallo (p.ej. Supabase sin configurar).
// ---------------------------------------------------------------------
function watchPostMediaOrphan(tempId, cleanupFn) {
  let done = false;
  const stop = store.subscribe(() => {
    if (done) return;
    const row = store.getState().posts.find(p => p.id === tempId);
    if (row && row._syncFailed) {
      done = true;
      stop();
      cleanupFn();
    } else if (!row) {
      // Swap por la fila real (insert OK) o purga — el media tiene dueño.
      done = true;
      stop();
    }
  });
  setTimeout(() => {
    if (!done) { done = true; stop(); }
  }, 120_000);
}

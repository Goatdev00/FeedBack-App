// ============================================
// FEEDBACK — Create Party (Promotor) / Create Remate (cualquier usuario)
// ============================================
// Un solo formulario con dos "skins" según params.kind:
//   * kind 'party' (default): flujo clásico de promotor (gate de rol) +
//     campo opcional de venta de boletería (parties.ticket_contact_url).
//   * kind 'remate': abierto a CUALQUIER usuario logueado (la política
//     parties_create de 0037 permite kind='remate' sin rol promotor),
//     sin CTA de patrocinio y sin boletería.

import { store, ICONS } from '../data/mock-data.js';
import { router } from '../router.js';
import { showToast } from '../utils/toast.js';
import { fileToResizedDataURL, fileToResizedBlob, uploadImageToStorage, removeUploadedImage } from '../utils/image.js';

const GENRES = [
  'Techno', 'Hardtechno', 'House', 'Deep House', 'Tech House', 'Melodic Techno',
  'Dark Techno', 'Acid Techno', 'Schranz', 'Gabber', 'Hardcore', 'Hardstyle',
  'Minimal', 'Drum & Bass', 'Jungle', 'Breakbeat', 'Trance', 'Psytrance',
  'Disco', 'Electro', 'Progressive', 'Ambient', 'Reggaeton', 'Guaracha',
];

const PARTY_CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Yopal', 'Bucaramanga'];

// Normaliza el contacto de boletería a una URL https:// (el constraint
// parties_ticket_contact_url_ck exige https y ≤500 chars):
//   * número (dígitos con +, espacios, guiones, paréntesis) → wa.me
//   * https:// → tal cual; http:// / www. / dominio pelado → forzar https
//   * cualquier otra cosa → { ok:false } y NO se publica.
// Devuelve url null cuando el campo quedó vacío (boletería es opcional).
function normalizeTicketContact(raw) {
  const value = (raw || '').trim();
  if (!value) return { ok: true, url: null };

  const compact = value.replace(/[\s\-().]/g, '');
  if (/^\+?\d{7,15}$/.test(compact)) {
    return { ok: true, url: `https://wa.me/${compact.replace(/\D/g, '')}` };
  }

  let candidate = value;
  if (/^http:\/\//i.test(candidate)) candidate = 'https://' + candidate.slice(7);
  else if (/^www\./i.test(candidate)) candidate = 'https://' + candidate;
  else if (!/^https:\/\//i.test(candidate)) {
    // "Parece dominio": algo.tld con path opcional y sin espacios.
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(candidate)) candidate = 'https://' + candidate;
    else return { ok: false, url: null };
  }

  try {
    const u = new URL(candidate);
    // u.href re-serializa con protocolo/host en minúsculas ("HTTPS://" no
    // pasaría el LIKE 'https://%' del check de la migración 0037).
    if (u.protocol !== 'https:' || /\s/.test(candidate) || u.href.length > 500) {
      return { ok: false, url: null };
    }
    return { ok: true, url: u.href };
  } catch {
    return { ok: false, url: null };
  }
}

// Duplicado por similitud de nombre, ámbito por kind: los remates suelen
// llamarse como la fiesta madre ("NEXUS after"), así que compararlos
// contra las fiestas (como hace store.detectDuplicate, que es global)
// daría falsos positivos constantes — y viceversa.
function detectDuplicateByKind(name, isRemate) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return store.getState().parties
    .filter(p => (((p.kind || 'party') === 'remate') === isRemate))
    .find(p => {
      const pNorm = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return pNorm === normalized || pNorm.includes(normalized) || normalized.includes(pNorm);
    });
}

export function renderCreateParty(container, params = {}) {
  const isRemate = params.kind === 'remate';
  const user = store.getState().currentUser;

  if (!user) {
    router.navigate('login');
    return;
  }
  // El gate de promotor SOLO aplica a fiestas: los remates son de toda la
  // comunidad (el server lo respalda: parties_create 0037 acepta
  // kind='remate' con cualquier rol).
  if (!isRemate && user.role !== 'promotor') {
    showToast('Solo promotores pueden crear fiestas', 'warning');
    router.navigate('parties');
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="page" id="create-party-page">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-lg);">
        <button class="back-btn" id="back-btn" style="margin-bottom:0;">
          ${ICONS.back}
          <span>${isRemate ? 'Muro' : 'Fiestas'}</span>
        </button>
        <button class="btn btn-primary btn-sm" id="publish-party-btn">
          ${isRemate ? 'Publicar remate' : 'Publicar evento'}
        </button>
      </div>

      <h1 class="page-title" style="margin-bottom:var(--space-xs);">${isRemate ? 'Crear remate' : 'Crear fiesta'}</h1>
      <p class="page-subtitle" style="margin-bottom:var(--space-xl);">${isRemate ? 'Comparte tu after con la comunidad' : 'Sube tu evento y llega a la comunidad'}</p>

      <!-- Flyer Upload -->
      <div class="form-section">
        <div class="form-section-title">${isRemate ? 'Flyer del remate' : 'Flyer del evento'}</div>
        <div class="flyer-upload" id="flyer-upload">
          ${ICONS.image}
          <span style="font-size:var(--text-sm);">Subir flyer</span>
          <span style="font-size:var(--text-xs);color:var(--text-muted);">JPG, PNG · Recomendado 1:1</span>
        </div>
        <input type="file" id="flyer-file" accept="image/*" style="display:none;" />
        <div id="flyer-preview" style="display:none;margin-top:var(--space-md);position:relative;">
          <img id="flyer-preview-img" style="width:100%;border-radius:var(--radius-md);max-height:300px;object-fit:cover;" />
          <button class="btn btn-icon btn-secondary" id="remove-flyer" style="position:absolute;top:8px;right:8px;width:32px;height:32px;">${ICONS.x}</button>
        </div>
      </div>

      <!-- Event Info -->
      <div class="form-section">
        <div class="form-section-title">${isRemate ? 'Información del remate' : 'Información del evento'}</div>

        <div class="input-group mb-md">
          <label class="input-label">${isRemate ? 'Nombre del remate *' : 'Nombre del evento *'}</label>
          <input type="text" class="input" id="party-name" placeholder="${isRemate ? 'Ej: After NEXUS' : 'Ej: NEXUS Underground Session'}" maxlength="50" />
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Descripción</label>
          <textarea class="input textarea" id="party-description" placeholder="${isRemate ? 'Describe tu remate...' : 'Describe tu evento...'}" maxlength="300" style="min-height:80px;"></textarea>
        </div>

        <div class="input-group mb-md">
          <label class="input-label">Venue / Lugar *</label>
          <input type="text" class="input" id="party-venue" placeholder="${isRemate ? 'Ej: Casa del after, terraza...' : 'Ej: Warehouse Club'}" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Ciudad *</label>
            <select class="input" id="party-city">
              ${PARTY_CITIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fecha *</label>
            <input type="date" class="input" id="party-date" value="${todayStr}" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);">
          <div class="input-group mb-md">
            <label class="input-label">Inicio</label>
            <input type="time" class="input" id="party-start" value="${isRemate ? '06:00' : '22:00'}" />
          </div>
          <div class="input-group mb-md">
            <label class="input-label">Fin</label>
            <input type="time" class="input" id="party-end" value="${isRemate ? '14:00' : '06:00'}" />
          </div>
        </div>
      </div>

      <!-- Genres -->
      <div class="form-section">
        <div class="form-section-title">Géneros musicales</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;" id="genre-picker">
          ${GENRES.map(g => `
            <button class="tag" data-genre="${g}">${g}</button>
          `).join('')}
        </div>
      </div>

      ${isRemate ? '' : `
        <!-- Venta de boletería (solo fiestas de promotor) -->
        <div class="form-section">
          <div class="form-section-title">Venta de boletería (opcional)</div>
          <div class="input-group">
            <input type="text" class="input" id="party-ticket" placeholder="WhatsApp o enlace de venta" maxlength="200" autocomplete="off" />
            <p style="font-size:var(--text-xs);color:var(--text-muted);margin-top:6px;">
              Número de WhatsApp o enlace https:// donde vendes las boletas.
            </p>
          </div>
        </div>

        <!-- Premium CTA -->
        <div class="card" style="background:linear-gradient(135deg, rgba(255,200,0,0.05), rgba(255,106,0,0.05));border-color:rgba(255,200,0,0.2);margin-top:var(--space-lg);">
          <div style="display:flex;align-items:center;gap:var(--space-md);">
            <div style="flex:1;">
              <h4 style="font-size:var(--text-sm);font-weight:600;color:#FFC800;">Evento Patrocinado</h4>
              <p style="font-size:var(--text-xs);color:var(--text-tertiary);">Destaca tu evento para mayor visibilidad</p>
            </div>
            <button class="btn btn-ghost btn-sm" style="color:#FFC800;border:1px solid rgba(255,200,0,0.3);">PRO</button>
          </div>
        </div>
      `}

      <!-- Publicar también al FINAL del formulario: quien acaba de llenar
           géneros/boletería está abajo del todo — no debería volver a la
           cabecera para publicar. Mismo handler que el botón de arriba. -->
      <button class="btn btn-primary btn-full" id="publish-party-btn-bottom" style="margin-top:var(--space-lg);">
        ${isRemate ? 'Publicar remate' : 'Publicar evento'}
      </button>
    </div>
  `;

  let selectedGenres = [];
  // Flyer: el base64 del preview se conserva como FALLBACK de publicación
  // (si Storage falla el evento sale igual con él); el File original se
  // guarda para re-procesarlo a Blob y subirlo al bucket `images` (0040)
  // recién al publicar.
  let flyerData = null;
  let flyerFile = null;

  // Token de montaje (mismo patrón que create-post): tras el await de la
  // subida hay que verificar que la página siga conectada — el back no
  // queda bloqueado durante la subida y publicar/navegar encima de otra
  // ruta arrancaría al usuario de donde esté.
  const pageEl = container.querySelector('#create-party-page');

  // Back: el remate nace en la pestaña Remates del muro; la fiesta, en la
  // agenda de fiestas.
  container.querySelector('#back-btn').addEventListener('click', () => {
    if (isRemate) {
      store.setState({ wallTab: 'remates' });
      router.navigate('wall');
    } else {
      router.navigate('parties');
    }
  });

  // Flyer upload
  const flyerUpload = container.querySelector('#flyer-upload');
  const flyerInput = container.querySelector('#flyer-file');
  const flyerPreview = container.querySelector('#flyer-preview');
  const flyerPreviewImg = container.querySelector('#flyer-preview-img');

  flyerUpload.addEventListener('click', () => flyerInput.click());
  flyerInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Flyers are content images, so allow a larger max than avatars,
      // but still downscale + JPEG-compress so they don't land in the DB
      // as multi-MB base64 (which times out party reads).
      flyerData = await fileToResizedDataURL(file, 1280, 0.82);
      flyerFile = file; // el original se re-procesa a Blob al publicar
      flyerPreviewImg.src = flyerData;
      flyerPreview.style.display = 'block';
      flyerUpload.style.display = 'none';
    } catch {
      showToast('No se pudo procesar la imagen', 'error');
    }
  });

  container.querySelector('#remove-flyer').addEventListener('click', () => {
    flyerData = null;
    flyerFile = null;
    flyerPreview.style.display = 'none';
    flyerUpload.style.display = '';
    flyerInput.value = '';
  });

  // Genre selection
  container.querySelectorAll('[data-genre]').forEach(tag => {
    tag.addEventListener('click', () => {
      const genre = tag.dataset.genre;
      tag.classList.toggle('active');
      if (selectedGenres.includes(genre)) {
        selectedGenres = selectedGenres.filter(g => g !== genre);
      } else {
        selectedGenres.push(genre);
      }
    });
  });

  // Publish — cabecera + botón de cierre del formulario, un solo handler.
  // Mientras el flyer sube, AMBOS botones quedan bloqueados con spinner
  // (patrón .btn-spinner de create-post): el que no se tocó también sería
  // una vía de doble publish.
  const publishBtnTop = container.querySelector('#publish-party-btn');
  const publishBtnBottom = container.querySelector('#publish-party-btn-bottom');
  const publishLabel = isRemate ? 'Publicar remate' : 'Publicar evento';
  const setPublishing = (busy) => {
    [publishBtnTop, publishBtnBottom].forEach((b) => {
      b.disabled = busy;
      if (busy) b.innerHTML = '<span class="btn-spinner"></span>&nbsp;Subiendo…';
      else b.textContent = publishLabel;
    });
  };
  const publishParty = async () => {
    const name = container.querySelector('#party-name').value.trim();
    const venue = container.querySelector('#party-venue').value.trim();
    const city = container.querySelector('#party-city').value;
    const date = container.querySelector('#party-date').value;
    const startTime = container.querySelector('#party-start').value;
    const endTime = container.querySelector('#party-end').value;
    const description = container.querySelector('#party-description').value.trim();

    if (!name) { showToast('El nombre es obligatorio', 'error'); return; }
    if (!venue) { showToast('El lugar es obligatorio', 'error'); return; }

    // Boletería: si el promotor escribió algo que no se puede normalizar
    // a un enlace https válido, NO se publica (mejor corregir ahora que
    // un botón "Comprar boletas" roto en el detalle).
    let ticketContactUrl = null;
    if (!isRemate) {
      const ticket = normalizeTicketContact(container.querySelector('#party-ticket')?.value);
      if (!ticket.ok) {
        showToast('Enlace de boletería no válido. Usa un número de WhatsApp o un enlace https://', 'error');
        return;
      }
      ticketContactUrl = ticket.url;
    }

    // Check duplicate (ámbito por kind — ver detectDuplicateByKind)
    const dup = detectDuplicateByKind(name, isRemate);
    if (dup) {
      showToast(`⚠️ Ya existe "${dup.name}". Verifica que no sea duplicado.`, 'warning');
      return;
    }

    // Flyer: intentar Storage (bucket `images`, 0040) y publicar la URL;
    // ante CUALQUIER fallo — bucket inexistente porque la 0040 aún no se
    // aplicó (el frontend se despliega antes de migrar) o error de red —
    // degradar EN SILENCIO al base64 del preview, el comportamiento de
    // siempre. Sin orphan-watch como el de create-post: el flyer es
    // pequeño (~decenas de KB) y addParty ya hace rollback silencioso si
    // su insert falla — no compensa un subscriber por un huérfano
    // ocasional y diminuto.
    let flyerValue = flyerData;
    if (flyerData && flyerFile) {
      setPublishing(true);
      let flyerPath = null;
      try {
        const blob = await fileToResizedBlob(flyerFile, 1280, 0.82);
        const uploaded = await uploadImageToStorage(blob, user.id, 'f');
        flyerValue = uploaded.url;
        flyerPath = uploaded.path;
      } catch {
        // flyerValue conserva el base64 capturado ANTES del await (no
        // re-leer flyerData: "Quitar" no está bloqueado durante la
        // subida y pudo ponerlo a null). Restaurar los botones: se
        // publica igual con base64, sin dejar el spinner colgado.
        setPublishing(false);
      }
      // ¿La página sigue montada? Si el usuario navegó durante el await
      // (el back no queda bloqueado), abortar sin addParty ni navigate —
      // y borrar el flyer ya subido, que sin party quedaría huérfano.
      if (!pageEl.isConnected) {
        if (flyerPath) removeUploadedImage(flyerPath);
        return;
      }
    }

    store.addParty({
      name,
      venue,
      city,
      date,
      startTime,
      endTime,
      genres: selectedGenres,
      promotor: user.id,
      djs: [],
      flyer: flyerValue,
      description,
      kind: isRemate ? 'remate' : 'party',
      ticketContactUrl,
    });

    if (isRemate) {
      showToast('¡Remate publicado! 🔥', 'success');
      // Aterriza en la pestaña Remates, donde el nuevo remate ya aparece
      // en la tira "Lo que está pasando".
      store.setState({ wallTab: 'remates' });
      router.navigate('wall');
    } else {
      showToast('¡Evento creado con éxito! 🎉', 'success');
      router.navigate('parties');
    }
  };
  container.querySelector('#publish-party-btn').addEventListener('click', publishParty);
  container.querySelector('#publish-party-btn-bottom').addEventListener('click', publishParty);
}

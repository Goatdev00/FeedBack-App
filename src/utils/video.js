// ============================================
// FEEDBACK — Video utils (validación + subida a Supabase Storage)
// Primer (y único) consumidor de supabase.storage en el cliente: los
// videos NO siguen el pipeline base64 de las fotos (30s de video no
// caben en localStorage ni en una columna text) — van al bucket público
// `videos` (migración 0039) y las tablas guardan solo la URL https.
// ============================================

import { supabase, isSupabaseConfigured } from '../data/supabase.js';
import { describeApiError } from '../data/mock-data.js';

const MAX_BYTES = 25 * 1024 * 1024; // espejo del file_size_limit del bucket (0039)
// 30s de producto + 0.9s de tolerancia: los contenedores redondean la
// duración hacia arriba (un clip de exactamente 30.0s puede reportar
// 30.03–30.5s según el muxer) — sin margen rechazaríamos videos válidos.
const MAX_DURATION_S = 30.9;

// Mismos mime types que allowed_mime_types del bucket. iOS entrega .mov
// como video/quicktime (¡aceptarlo — es TODO iPhone!); Android a veces
// entrega file.type VACÍO desde el picker → fallback por extensión.
const MIME_BY_EXT = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const ALLOWED_MIMES = new Set(Object.values(MIME_BY_EXT));

function extOf(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file?.name || '');
  return m ? m[1].toLowerCase() : '';
}

/** Mime efectivo del archivo: el declarado si es válido, o el inferido
 *  de la extensión cuando el picker no puso type. null = no soportado. */
function resolveMime(file) {
  const t = (file.type || '').toLowerCase();
  if (ALLOWED_MIMES.has(t)) return t;
  if (!t) return MIME_BY_EXT[extOf(file)] || null;
  return null;
}

/**
 * Valida tipo, tamaño y duración (≤30s) de un video ANTES de subirlo.
 * Resuelve SIEMPRE (nunca rechaza): { ok:true, duration } o
 * { ok:false, error } con mensaje en español listo para el toast.
 * La duración se lee con un <video preload="metadata"> desmontado —
 * en iOS eso NO reproduce nada ni requiere gesto (solo carga metadata).
 */
export function validateVideoFile(file) {
  return new Promise((resolve) => {
    if (!file) { resolve({ ok: false, error: 'No se seleccionó ningún video' }); return; }

    if (!resolveMime(file)) {
      resolve({ ok: false, error: 'Formato no soportado. Usa un video MP4, MOV o WebM.' });
      return;
    }
    if (file.size > MAX_BYTES) {
      resolve({ ok: false, error: 'El video pesa demasiado (máx 25MB)' });
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true; // paranoia iOS: jamás debe intentar sonar

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // SIEMPRE revocar: los blob URLs de videos de 25MB retenidos son
      // exactamente la presión de memoria que mata Safari iOS.
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    // Timeout de seguridad: si en ~10s el navegador no pudo leer la
    // metadata (archivo corrupto, códec exótico), no dejamos al usuario
    // con un botón colgado para siempre.
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'No se pudo leer el video. Intenta con otro archivo.' });
    }, 10_000);

    const checkDuration = () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        finish({ ok: false, error: 'No se pudo leer la duración del video.' });
        return;
      }
      if (duration > MAX_DURATION_S) {
        finish({ ok: false, error: `El video dura ${Math.round(duration)}s — el máximo es 30s` });
        return;
      }
      finish({ ok: true, duration });
    };

    video.addEventListener('loadedmetadata', () => {
      if (video.duration === Infinity) {
        // Quirk conocido (streams/MediaRecorder): duration llega Infinity
        // hasta forzar un seek imposible; el navegador entonces calcula la
        // duración real y dispara timeupdate/durationchange.
        video.addEventListener('timeupdate', function onTime() {
          video.removeEventListener('timeupdate', onTime);
          video.currentTime = 0;
          checkDuration();
        });
        video.currentTime = 1e101;
        return;
      }
      checkDuration();
    });

    video.addEventListener('error', () => {
      finish({ ok: false, error: 'No se pudo leer el video. Intenta con otro archivo.' });
    });

    video.src = url;
  });
}

/**
 * Sube el video al bucket público `videos` y devuelve `{ url, path }`:
 * url = URL pública (https://<ref>.supabase.co/storage/v1/object/public/videos/...)
 * path = key dentro del bucket — los call sites lo conservan para poder
 * borrar el objeto (best-effort, policy videos_delete_own de 0039) si el
 * insert del post/mensaje falla después de subir; sin eso cada fallo
 * dejaba un video huérfano en el bucket para siempre.
 * Lanza Error con mensaje en español listo para toast. El path arranca
 * con el uid porque la policy videos_insert_own (0039) exige
 * (storage.foldername(name))[1] = auth.uid().
 */
export async function uploadVideoToStorage(file, userId) {
  if (!isSupabaseConfigured()) throw new Error('Servidor no configurado');
  if (!userId) throw new Error('Debes iniciar sesión para subir videos');

  const mime = resolveMime(file) || 'video/mp4';
  // Extensión desde el mime (fuente de verdad tras validar) con fallback
  // al nombre del archivo — nunca subir sin extensión, el CDN la usa
  // para el Content-Type de la respuesta.
  const extByMime = Object.keys(MIME_BY_EXT).find(k => MIME_BY_EXT[k] === mime);
  const ext = extByMime || extOf(file) || 'mp4';
  const path = `${userId}/v_${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('videos')
    .upload(path, file, { contentType: mime, cacheControl: '3600', upsert: false });

  if (error) {
    const msg = error.message || '';
    // Bucket inexistente = migración 0039 sin aplicar (deploy-before-
    // migrate). Mensaje accionable en vez del "Bucket not found" crudo.
    if (/bucket.*not.*found/i.test(msg) || error.statusCode === '404' || error.status === 404) {
      throw new Error('La subida de videos se está activando (migración pendiente)');
    }
    if (/payload too large|exceeded.*size|maximum allowed size/i.test(msg)) {
      throw new Error('El video pesa demasiado (máx 25MB)');
    }
    if (/mime.?type.*not supported/i.test(msg)) {
      throw new Error('Formato no soportado. Usa un video MP4, MOV o WebM.');
    }
    throw new Error(describeApiError(error));
  }

  const { data } = supabase.storage.from('videos').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('No se pudo obtener la URL del video');
  return { url: data.publicUrl, path };
}

/**
 * Borra (best-effort) un video ya subido cuyo post/mensaje nunca llegó a
 * existir — el insert falló o la página se desmontó antes de publicarlo.
 * Nunca lanza: es limpieza oportunista, el flujo de error del caller no
 * debe romperse porque el remove también falle (p.ej. sin red).
 */
export function removeUploadedVideo(path) {
  if (!path || !isSupabaseConfigured()) return;
  try {
    Promise.resolve(supabase.storage.from('videos').remove([path])).catch(() => {});
  } catch { /* best-effort */ }
}

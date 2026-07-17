// =====================================================================
// FEEDBACK — Image helpers
// =====================================================================
// Avatars were being stored as raw FileReader data URLs straight from the
// camera roll — a single photo could be 12 MB of base64 in the profiles
// table. That blew up two things: (1) profile SELECTs timed out server-side
// (statement timeout 57014) because Postgres had to encode megabytes of
// text, and (2) the same blob in localStorage tripped QuotaExceededError
// and froze the main thread on every JSON.stringify.
//
// fileToResizedDataURL downscales to a small square-ish JPEG (~256px,
// q0.82) before we ever store it: ~15-40 KB instead of multiple MB.
// =====================================================================

import { supabase, isSupabaseConfigured } from '../data/supabase.js';

const DEFAULT_MAX = 256;
const DEFAULT_QUALITY = 0.82;

export function fileToResizedDataURL(file, maxSize = DEFAULT_MAX, quality = DEFAULT_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('not_an_image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        let { width, height } = img;
        // Scale the longest side down to maxSize, preserving aspect ratio.
        if (width >= height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // JPEG (not PNG) so photos compress well; avatars don't need alpha.
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------
// fileToResizedBlob — mismo pipeline de downscale+JPEG que arriba, pero
// devuelve un Blob para subirlo a Storage (un Blob no infla 33% como el
// base64 y el CDN lo sirve cacheable). Comparte la lógica de resize.
// ---------------------------------------------------------------------
export function fileToResizedBlob(file, maxSize = DEFAULT_MAX, quality = DEFAULT_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      reject(new Error('not_an_image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode_failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width >= height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))),
          'image/jpeg',
          quality,
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------
// uploadImageToStorage — sube un Blob al bucket público `images` (0040)
// bajo la carpeta del usuario y devuelve { url, path } (misma forma que
// uploadVideoToStorage). Lanza con mensaje claro si el bucket no existe
// aún (migración 0040 pendiente) — el caller decide si degrada a base64.
// ---------------------------------------------------------------------
export async function uploadImageToStorage(blob, userId, label = 'img') {
  if (!isSupabaseConfigured()) throw new Error('supabase_not_configured');
  if (!blob || !userId) throw new Error('missing_upload_args');
  const path = `${userId}/${label}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('images').upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000', // inmutable en la práctica: cada subida usa un path nuevo
    upsert: false,
  });
  if (error) {
    if (/bucket.*not.*found/i.test(error.message || '')) {
      throw new Error('bucket_images_missing');
    }
    throw error;
  }
  const { data } = supabase.storage.from('images').getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('public_url_failed');
  return { url: data.publicUrl, path };
}

// Best-effort: limpia un archivo ya subido cuyo dueño (post/perfil) no
// llegó a existir. Nunca lanza.
export function removeUploadedImage(path) {
  if (!path || !isSupabaseConfigured()) return;
  try {
    supabase.storage.from('images').remove([path]).catch(() => {});
  } catch { /* best-effort */ }
}

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

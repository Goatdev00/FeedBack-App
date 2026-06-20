// =====================================================================
// generate-vapid.mjs — genera UN par VAPID válido, lo AUTO-VERIFICA, y lo
// escribe en vapid-keys.txt para copiar sin errores. SIN npm, SIN internet.
//     node generate-vapid.mjs
// Después abrí vapid-keys.txt en VSCode y copiá cada clave desde ahí.
// Borrá vapid-keys.txt cuando termines (tiene la clave privada).
// =====================================================================
import crypto from 'node:crypto';
import fs from 'node:fs';

const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url');

const PUBLIC = Buffer.concat([Buffer.from([0x04]), b64(jwk.x), b64(jwk.y)]).toString('base64url');
const PRIVATE = jwk.d;

// Auto-verificación: derivar la pública desde la privada y comparar.
const ecdh = crypto.createECDH('prime256v1');
ecdh.setPrivateKey(Buffer.from(PRIVATE, 'base64url'));
const ok = ecdh.getPublicKey().toString('base64url') === PUBLIC;

const out = [
  `VAPID KEYS  (par valido: ${ok ? 'SI' : 'NO'})`,
  ``,
  `# PUBLIC  ->  GitHub VITE_VAPID_PUBLIC_KEY  +  Supabase VAPID_PUBLIC_KEY  +  .env VITE_VAPID_PUBLIC_KEY`,
  PUBLIC,
  ``,
  `# PRIVATE ->  SOLO en Supabase VAPID_PRIVATE_KEY`,
  PRIVATE,
  ``,
].join('\n');

fs.writeFileSync('vapid-keys.txt', out);

console.log(`\n${ok ? '✅' : '❌'} Par ${ok ? 'VALIDO' : 'INVALIDO'} generado.`);
console.log('📄 Escrito en: vapid-keys.txt');
console.log('   Abrilo en VSCode y copiá cada clave desde ahí (linea completa, sin espacios).\n');

// check-vapid-pair.mjs — verifica si una pública y una privada VAPID son pareja.
// Uso: node check-vapid-pair.mjs <PUBLIC> <PRIVATE>
import crypto from 'node:crypto';
const [, , pub, priv] = process.argv;
if (!pub || !priv) { console.log('Uso: node check-vapid-pair.mjs <PUBLIC> <PRIVATE>'); process.exit(1); }
try {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(priv, 'base64url'));
  const derived = ecdh.getPublicKey().toString('base64url');
  console.log(derived === pub
    ? '\n  ✅ MATCH — la pública y la privada SON pareja. Usalas.\n'
    : '\n  ❌ NO MATCH — NO son pareja (esa privada no corresponde a esa pública).\n');
} catch (e) {
  console.log('\n  ❌ Error de formato:', e.message, '\n');
}

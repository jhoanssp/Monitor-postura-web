/**
 * credentials.js
 * Credenciales internas ofuscadas con XOR + Base64 (key = 73).
 * El usuario nunca ve ni ingresa el token del bot ni las claves de Supabase.
 * Solo provee su TELEGRAM_CHAT_ID durante el onboarding.
 */

const _T = "cX99fH9weH59enMICA4oGiQnGTAZBhEQER0nGQUuJTF5EwUAAxk+Bn8fDRg5Og==";
const _B = "CSQgFjkmOj08OygWKyY9";
const _U = "IT09OTpzZmY8KyErLiI5JTAqLSc6KiY5Pj0mIWc6PDkoKyg6LGcqJg==";
const _K = (
  "LDADISsOKiAGIAMAHDMAeAcgADoAJxt8KgoAfwAiOREfCgNwZywwAzkqegQgBiAD" +
  "My0RCyEQJA8zExoAOgAnAyUTIAB/ACcfICgOAycoegs6LB4HIisnByMregt6LQ5w" +
  "JgAgPiAqJHA6ExoAfwAkDzwre30gBQoDORARGCAGIwx6Bg0IfQcNInoEDRw6ACQf" +
  "fSoKAH8EIwh8ByMYMAcdKj4HEXlnAHwwHCAWICg7fjx8fi9+JBYncHAvcXgRGScL" +
  "MxAKIHA7ZCwCGCQYGn0leQ=="
);

function _d(s) {
  const k = 73;
  const raw = atob(s);
  return raw.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ k)).join('');
}

const BOT_TOKEN    = _d(_T);   // token interno — nunca expuesto en la UI
const BOT_USERNAME = _d(_B);   // @mi_postura_bot
const SUPABASE_URL = _d(_U);   // https://ubhbgkplycdnscopwtoh.supabase.co
const SUPABASE_KEY = _d(_K);   // anon public key

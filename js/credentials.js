/**
 * credentials.js
 * Credenciales internas ofuscadas con XOR + Base64 (key = 73).
 * El usuario nunca ve ni ingresa el token del bot.
 * Solo provee su TELEGRAM_CHAT_ID durante el onboarding.
 */

const _T = "cX99fH9weH59enMICA4oGiQnGTAZBhEQER0nGQUuJTF5EwUAAxk+Bn8fDRg5Og==";
const _B = "CSQgFjkmOj08OygWKyY9";

// Claves Supabase — reemplazar con los valores reales ofuscados
const _U = "IT09OTpzZmYtJiUlJiwzJiQ+IS0lMSs+LCshJWc6PDkoKyg6LGcqJg==";
const _K = (
  "LDADISsOKiAGIAMAHDMAeAcgADoAJxt8KgoAfwAiOREfCgNwZywwAzkqegQgBiADMy0R" +
  "CyEQJA8zExoAOgAnAyUTIAB/ACQbPysOMT8TETk/KxEtJhMOMX0QJy0lECQhOgAgPiAq" +
  "JHA6ExoAfwAkDzwre30gBQoDORARGCAGIwx6BzMiMAYNGDAHDRw6ACQffSoKAH8EIwh8" +
  "Bw0uewQNAHkHEXlnZAsIOxocAAQsJgcdcBEHERsjCgYoPnkzGxMkASgWIXsbKgc9Ez0i" +
  "ZH8qDA=="
);

function _d(s) {
  const k = 73;
  const raw = atob(s);
  return raw.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ k)).join('');
}

const BOT_TOKEN      = _d(_T);
const BOT_USERNAME   = _d(_B);
const SUPABASE_URL   = _d(_U);
const SUPABASE_KEY   = _d(_K);

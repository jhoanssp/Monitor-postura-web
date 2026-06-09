/**
 * db.js
 * Interaccion con Supabase (tablas: sessions, posture_frames).
 * Muestreo controlado — no se inserta cada frame, sino cada SAMPLE_EVERY_N.
 *
 * DIAGNOSTICO: Si SUPABASE_URL o SUPABASE_KEY no estan bien configurados
 * en credentials.js, los errores aparecen claramente en el registro.
 */

let dbSessionId  = null;
let frameCounter = 0;
let dbActivo     = false; // false si las credenciales fallan al inicio

// ── Validar credenciales al cargar ────────────────────────────────────────
// Se llama desde main.js despues de DOMContentLoaded
async function dbValidarConexion() {
  if (!SUPABASE_URL || SUPABASE_URL.includes("undefined") || SUPABASE_URL.length < 20) {
    agregarLog("DB: SUPABASE_URL no configurada — revisa credentials.js");
    dbActivo = false;
    return false;
  }
  if (!SUPABASE_KEY || SUPABASE_KEY.length < 20) {
    agregarLog("DB: SUPABASE_KEY no configurada — revisa credentials.js");
    dbActivo = false;
    return false;
  }
  try {
    // Ping liviano: consultar sessions con limit=0
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?limit=0`,
      { headers: sbHeaders() }
    );
    if (r.status === 404) {
      agregarLog("DB: tabla 'sessions' no encontrada — ejecuta db/schema.sql en Supabase");
      dbActivo = false;
      return false;
    }
    if (r.status === 401 || r.status === 403) {
      agregarLog("DB: credenciales invalidas (401/403) — revisa SUPABASE_KEY en credentials.js");
      dbActivo = false;
      return false;
    }
    if (!r.ok) {
      agregarLog(`DB: error de conexion (${r.status}) — ${await r.text()}`);
      dbActivo = false;
      return false;
    }
    dbActivo = true;
    agregarLog("DB: conexion con Supabase OK");
    return true;
  } catch (e) {
    agregarLog(`DB: no se pudo conectar a Supabase — ${e.message}`);
    dbActivo = false;
    return false;
  }
}

// ── Headers base ──────────────────────────────────────────────────────────
function sbHeaders() {
  return {
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Prefer":        "return=representation",
  };
}

// ── Insertar sesion al iniciar deteccion ──────────────────────────────────
async function dbIniciarSesion(userUuid, cameraView, consented) {
  if (!dbActivo) { agregarLog("DB: sesion omitida (sin conexion)"); return null; }
  try {
    const body = {
      user_uuid:   userUuid,
      camera_view: cameraView,
      consented:   consented,
      device_info: navigator.userAgent.slice(0, 200),
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
      method:  "POST",
      headers: sbHeaders(),
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text();
      agregarLog(`DB: error al crear sesion (${r.status}) — ${err}`);
      return null;
    }
    const data = await r.json();
    dbSessionId  = data[0]?.id || null;
    frameCounter = 0;
    agregarLog(`DB: sesion iniciada (${dbSessionId})`);
    return dbSessionId;
  } catch (e) {
    agregarLog(`DB: iniciarSesion — ${e.message}`);
    return null;
  }
}

// ── Cerrar sesion al detener deteccion ────────────────────────────────────
async function dbCerrarSesion(totalFrames, alertasSent, pctCorrect) {
  if (!dbActivo || !dbSessionId) return;
  try {
    const body = {
      ended_at:     new Date().toISOString(),
      total_frames: totalFrames,
      alerts_sent:  alertasSent,
      pct_correct:  parseFloat(pctCorrect) || 0,
    };
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?id=eq.${dbSessionId}`,
      { method: "PATCH", headers: sbHeaders(), body: JSON.stringify(body) }
    );
    if (r.ok) agregarLog("DB: sesion cerrada correctamente");
    else      agregarLog(`DB: error al cerrar sesion (${r.status})`);
  } catch (e) {
    agregarLog(`DB: cerrarSesion — ${e.message}`);
  } finally {
    dbSessionId = null;
  }
}

// ── Insertar frame muestreado ─────────────────────────────────────────────
async function dbInsertarFrame(payload) {
  if (!dbActivo || !dbSessionId) return;
  frameCounter++;
  if (frameCounter % SAMPLE_EVERY_N !== 0) return;

  try {
    const body = {
      session_id:      dbSessionId,
      user_uuid:       payload.userUuid,
      posture_label:   payload.postureLabel,
      confidence:      payload.confidence,
      model_used:      payload.modelUsed,
      camera_view:     payload.cameraView,
      dx_shoulders:    payload.dxShoulders,
      landmarks:       payload.landmarks,
      is_valid_sample: true,
      sample_every_n:  SAMPLE_EVERY_N,
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/posture_frames`, {
      method:  "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text();
      agregarLog(`DB: error al insertar frame (${r.status}) — ${err}`);
    }
  } catch (e) {
    agregarLog(`DB: insertarFrame — ${e.message}`);
  }
}

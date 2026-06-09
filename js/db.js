/**
 * db.js
 * Interaccion con Supabase (tablas: sessions, posture_frames).
 * Muestreo controlado — no se inserta cada frame, sino cada SAMPLE_EVERY_N.
 */

// ID de sesion activa en Supabase
let dbSessionId  = null;
let frameCounter = 0;

// Headers base para fetch a Supabase
function sbHeaders() {
  return {
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "Prefer":        "return=representation",
  };
}

// Insertar sesion al iniciar deteccion. Guarda el ID para referenciar frames.
async function dbIniciarSesion(userUuid, cameraView, consented) {
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
      agregarLog(`DB: error al crear sesion — ${err}`);
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

// Cerrar sesion al detener deteccion — actualiza ended_at y estadisticas.
async function dbCerrarSesion(totalFrames, alertasSent, pctCorrect) {
  if (!dbSessionId) return;
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
    if (r.ok) agregarLog(`DB: sesion cerrada (duracion registrada)`);
    else      agregarLog(`DB: error al cerrar sesion — ${r.status}`);
  } catch (e) {
    agregarLog(`DB: cerrarSesion — ${e.message}`);
  } finally {
    dbSessionId = null;
  }
}

// Insertar frame muestreado. Solo se llama cada SAMPLE_EVERY_N frames.
async function dbInsertarFrame(payload) {
  if (!dbSessionId) return;
  frameCounter++;
  if (frameCounter % SAMPLE_EVERY_N !== 0) return;

  try {
    const body = {
      session_id:    dbSessionId,
      user_uuid:     payload.userUuid,
      posture_label: payload.postureLabel,
      confidence:    payload.confidence,
      model_used:    payload.modelUsed,
      camera_view:   payload.cameraView,
      dx_shoulders:  payload.dxShoulders,
      landmarks:     payload.landmarks,
      is_valid_sample: true,
      sample_every_n:  SAMPLE_EVERY_N,
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/posture_frames`, {
      method:  "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body:    JSON.stringify(body),
    });
    if (!r.ok) agregarLog(`DB: error al insertar frame — ${r.status}`);
  } catch (e) {
    agregarLog(`DB: insertarFrame — ${e.message}`);
  }
}

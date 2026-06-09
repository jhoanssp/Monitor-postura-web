/**
 * pose.js
 * Carga de modelos ONNX, inferencia con MediaPipe Pose,
 * logica de auto-switch frontal/lateral, y dibujo en canvas.
 */

let modelos = {};

// ── Carga de modelos ONNX ─────────────────────────────────────────────────
async function cargarModelos() {
  for (const tipo of ["frontal", "lateral"]) {
    try {
      agregarLog(`Cargando modelo ${tipo}...`);
      const [sess_sc, sess_m, meta] = await Promise.all([
        ort.InferenceSession.create(`models/scaler_${tipo}.onnx`),
        ort.InferenceSession.create(`models/modelo_${tipo}.onnx`),
        fetch(`models/metadata_${tipo}.json`).then(r => r.json()),
      ]);
      modelos[tipo] = { sess_sc, sess_m, meta };
      agregarLog(`Modelo ${tipo} listo (${meta.clases.join(", ")})`);
    } catch (err) {
      agregarLog(`Modelo ${tipo}: ${err.message}`);
    }
  }
}

// ── Inferencia ────────────────────────────────────────────────────────────
async function clasificar(landmarks, tipo) {
  const m = modelos[tipo];
  if (!m) return null;
  const { sess_sc, sess_m, meta } = m;

  const feat = new Float32Array(meta.feature_names.length);
  for (let i = 0; i < meta.feature_names.length; i++) {
    const parts = meta.feature_names[i].split("_");
    const coord = parts.pop();
    const lmKey = parts.join("_").toUpperCase();
    const idx   = POSE_LM_INDEX[lmKey];
    if (idx !== undefined && landmarks[idx]) {
      feat[i] = landmarks[idx][coord] ?? 0;
    }
  }

  const tIn    = new ort.Tensor("float32", feat, [1, feat.length]);
  const scaled = await sess_sc.run({ float_input: tIn });
  const tScaled = scaled[Object.keys(scaled)[0]];
  const result  = await sess_m.run({ float_input: tScaled });

  const probaKey = Object.keys(result).find(k => {
    const d = result[k].dims;
    return d && d.length === 2 && d[0] === 1;
  });
  if (!probaKey) return null;

  const proba = result[probaKey].data;
  let maxP = -1, maxI = 0;
  for (let i = 0; i < proba.length; i++) {
    if (proba[i] > maxP) { maxP = proba[i]; maxI = i; }
  }
  return { clase: meta.clases[maxI], confianza: maxP, landmarks };
}

// ── Auto-switch frontal / lateral ─────────────────────────────────────────
function calcDx(landmarks) {
  const l = landmarks[11], r = landmarks[12];
  return (l && r) ? Math.abs(l.x - r.x) : null;
}

function evaluarSwitch(dx) {
  if (modoActivo !== "auto") return;
  const cand = dx > UMBRAL_FRONTAL ? "frontal"
             : dx < UMBRAL_LATERAL ? "lateral"
             : null;
  if (!cand || cand === tipoActual) { switchCand = null; switchTS = null; return; }
  if (switchCand !== cand)          { switchCand = cand; switchTS = Date.now(); return; }
  if (Date.now() - switchTS >= SWITCH_DELAY_MS) {
    tipoActual = cand;
    switchCand = null; switchTS = null;
    agregarLog(`Auto-switch: ${tipoActual.toUpperCase()}`);
    actualizarBadgeModo();
  }
}

function tipoEfectivo() {
  if (modoActivo === "auto")            return tipoActual;
  if (modoActivo === "lateral-frontal") return "lateral";
  return modoActivo;
}

// ── Loop principal ────────────────────────────────────────────────────────
async function procesarFrame(landmarks) {
  if (!landmarks || !landmarks.length) {
    mostrarEstado("Sin persona", null, 0);
    tickMala(false);
    return;
  }

  const dx = calcDx(landmarks);
  if (dx !== null) evaluarSwitch(dx);

  const tipo = tipoEfectivo();
  let res = null;
  try {
    res = await clasificar(landmarks, tipo);
  } catch (e) {
    agregarLog(`Inferencia: ${e.message}`);
    return;
  }
  if (!res) return;

  const { clase, confianza } = res;
  conteoPost[clase] = (conteoPost[clase] || 0) + 1;
  mostrarEstado(clase, clase === POSTURA_OK, confianza, dx);
  tickMala(clase !== POSTURA_OK, clase);

  // Guardar frame muestreado en Supabase
  // Los landmarks se convierten a objeto plano para JSON
  const landmarksPlano = landmarks.map((lm, i) => ({
    index: i,
    x: lm.x, y: lm.y, z: lm.z,
    visibility: lm.visibility ?? null,
  }));

  await dbInsertarFrame({
    userUuid:     USER_UUID,
    postureLabel: clase,
    confidence:   confianza,
    modelUsed:    tipo,
    cameraView:   tipo,
    dxShoulders:  dx,
    landmarks:    landmarksPlano,
  });
}

// ── Tiempo de mala postura ────────────────────────────────────────────────
function tickMala(esMala, clase) {
  if (!esMala) { tMalaInicio = null; actualizarBarra(0); return; }
  if (!tMalaInicio) tMalaInicio = Date.now();
  const segs = (Date.now() - tMalaInicio) / 1000;
  actualizarBarra(segs);
  if (segs >= MALA_SEG) {
    const ult = ultimaAlerta[clase] || 0;
    if (Date.now() - ult >= COOLDOWN_MS) {
      ultimaAlerta[clase] = Date.now();
      enviarAlertaTG(clase, Math.round(segs));
    }
  }
}

// ── Dibujo en canvas ──────────────────────────────────────────────────────
function dibujarPose(results) {
  const canvas = document.getElementById("output-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (results.image) ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (results.poseLandmarks) {
    const color = tipoEfectivo() === "frontal" ? "var(--color-ok)" : "var(--color-info)";
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS,
      { color: "#ffffff22", lineWidth: 2 });
    drawLandmarks(ctx, results.poseLandmarks,
      { color, lineWidth: 1, radius: 4 });
  }
}

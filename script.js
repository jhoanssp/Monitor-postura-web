// ═══════════════════════════════════════════════════════════════════
// PosturaML — script.js
// MediaPipe Pose + ONNX Runtime Web + Supabase
// Switch automático frontal ↔ lateral
// ═══════════════════════════════════════════════════════════════════

// ── Supabase config (anon public key — seguro para frontend) ──────
const SUPABASE_URL    = "https://ubhbgkplycdnscopwtoh.supabase.co";
const SUPABASE_ANON   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViaGJna3BseWNkbnNjb3B3dG9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDk3MDUsImV4cCI6MjA5NjQyNTcwNX0.I5yUi_iar7u57f7m_n99f81XPnBzYCi9r-eKQmQS4l0";

// ── Parámetros switch ─────────────────────────────────────────────
const UMBRAL_FRONTAL    = 0.15;   // dx > → frontal
const UMBRAL_LATERAL    = 0.10;   // dx < → lateral
const SWITCH_DELAY_MS   = 10000;  // 10 s de confirmación
const CAPTURE_INTERVAL  = 30000;  // ms entre capturas Supabase
const HISTORIAL_MAX     = 8;

// ── ONNX model paths ──────────────────────────────────────────────
const MODEL_PATHS = {
  frontal: {
    scaler: "models/scaler_frontal.onnx",
    model:  "models/modelo_frontal.onnx",
    meta:   "models/metadata_frontal.json",
  },
  lateral: {
    scaler: "models/scaler_lateral.onnx",
    model:  "models/modelo_lateral.onnx",
    meta:   "models/metadata_lateral.json",
  },
};

// ── Clases de postura (orden fijo del RandomForest) ───────────────
const POSTURA_CORRECTA = "TUP";
const POSE_LABELS = {
  TUP: "Erguido",
  TLF: "Incl. Adelante",
  TLB: "Incl. Atrás",
  TLL: "Incl. Izquierda",
  TLR: "Incl. Derecha",
};

// ══════════════════════════════════════════════════════════════════
// Estado global
// ══════════════════════════════════════════════════════════════════
let state = {
  running:       false,
  uuid:          null,
  modelo:        "frontal",   // modelo activo
  candidato:     null,        // "frontal" | "lateral" | null
  tCandidato:    null,
  blurActivo:    false,
  frames:        0,
  capturas:      0,
  tInicio:       null,
  tUltimaCaptura: 0,
  historial:     [],
  datosCSV:      [],

  // ONNX sessions
  sessions: {
    frontal: { scaler: null, model: null, meta: null },
    lateral: { scaler: null, model: null, meta: null },
  },
};

// ── Supabase client ───────────────────────────────────────────────
let sbClient = null;

// ── MediaPipe Pose instance ───────────────────────────────────────
let pose = null;
let camera = null;

// ── Canvas / video refs ───────────────────────────────────────────
const video       = document.getElementById("video");
const canvasPose  = document.getElementById("canvas-pose");
const ctxPose     = canvasPose.getContext("2d");
const canvasSkel  = document.getElementById("canvas-skeleton");
const ctxSkel     = canvasSkel.getContext("2d");

// ── UI refs ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const btnStart    = $("btn-start");
const btnStop     = $("btn-stop");
const btnBlur     = $("btn-blur");
const btnCapture  = $("btn-capture");
const btnExport   = $("btn-export-csv");
const selectCam   = $("select-cam");

// HUD
const hudPostura  = $("hud-postura");
const hudConf     = $("hud-conf");
const hudDx       = $("hud-dx");
const hudSwitch   = $("hud-switch-bar-label");
const switchWrap  = $("switch-progress-wrap");
const switchBar   = $("switch-progress-bar");

// Stats panel
const statPostura = $("stat-postura");
const statEstado  = $("stat-estado");
const statConf    = $("stat-conf");
const statModelo  = $("stat-modelo");
const statDx      = $("stat-dx");
const statTiempo  = $("stat-tiempo");
const statFrames  = $("stat-frames");
const statCapt    = $("stat-capturas");
const confFill    = $("conf-bar-fill");
const histList    = $("historial-list");
const switchInfoVal = $("switch-info-val");
const datasetCd   = $("dataset-countdown");
const badgeModelo = $("badge-modelo");
const badgeDB     = $("badge-db");
const displayUUID = $("display-uuid");

// ══════════════════════════════════════════════════════════════════
// INIT — consent modal
// ══════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  $("btn-accept").addEventListener("click", onAcceptConsent);
  $("btn-decline").addEventListener("click", () => {
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;
      font-family:monospace;color:#7a8299;background:#0d0f14;font-size:1rem;">
      Monitoreo cancelado. Puedes cerrar esta página.</div>`;
  });
});

async function onAcceptConsent() {
  $("consent-overlay").classList.remove("active");
  $("consent-overlay").classList.add("hidden");
  $("app").classList.remove("hidden");

  initSupabase();
  await loadModels();
  await enumerateCameras();
  bindUI();
  startTimer();
}

// ══════════════════════════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════════════════════════
function initSupabase() {
  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    badgeDB.textContent = "DB ●";
    badgeDB.classList.remove("offline");
    console.log("✅ Supabase conectado");
  } catch (e) {
    console.error("Supabase init error:", e);
    badgeDB.textContent = "DB ○";
    badgeDB.classList.add("offline");
  }
}

async function insertarRegistro(postura, confianza, dx, modelo) {
  if (!sbClient) return;
  try {
    const { error } = await sbClient.from("posturas").insert([{
      usuario_uuid:   state.uuid,
      postura,
      confianza:    parseFloat(confianza.toFixed(4)),
      modelo,
      dx_hombros:   parseFloat(dx.toFixed(4)),
      consentimiento: true,
      cam_id:         0,
      timestamp:    new Date().toISOString(),
    }]);
    if (error) throw error;
    state.capturas++;
    statCapt.textContent = state.capturas;
  } catch (e) {
    console.warn("Supabase insert error:", e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// MODELOS ONNX
// ══════════════════════════════════════════════════════════════════
async function loadModels() {
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

  for (const tipo of ["frontal", "lateral"]) {
    try {
      const [scalerSess, modelSess, meta] = await Promise.all([
        ort.InferenceSession.create(MODEL_PATHS[tipo].scaler),
        ort.InferenceSession.create(MODEL_PATHS[tipo].model),
        fetch(MODEL_PATHS[tipo].meta).then(r => r.json()),
      ]);
      state.sessions[tipo] = { scaler: scalerSess, model: modelSess, meta };
      console.log(`✅ Modelo ${tipo} cargado — ${meta.n_features} features, clases: ${meta.clases}`);
    } catch (e) {
      console.error(`❌ Error cargando modelo ${tipo}:`, e);
    }
  }
}

// ── Inferencia ────────────────────────────────────────────────────
async function inferir(landmarks, tipo) {
  const { scaler, model, meta } = state.sessions[tipo];
  if (!scaler || !model || !meta) return null;

  // Extraer features en el orden exacto del metadata
  const row = {};
  for (const lm of Object.values(POSE_LM_MAP)) {
    row[`${lm.name}_x`] = landmarks[lm.idx].x;
    row[`${lm.name}_y`] = landmarks[lm.idx].y;
    row[`${lm.name}_z`] = landmarks[lm.idx].z;
  }

  const feat = new Float32Array(meta.feature_names.map(f => row[f] ?? 0.0));

  // Scaler
  const scalerInput = { float_input: new ort.Tensor("float32", feat, [1, meta.n_features]) };
  const scalerOut   = await scaler.run(scalerInput);
  const scaled      = scalerOut[scaler.outputNames[0]];

  // Random Forest
  const modelInput  = { float_input: scaled };
  const modelOut    = await model.run(modelInput);

  // output[0] = label string, output[1] = probabilities
  const proba = modelOut[model.outputNames[1]].data;  // Float32Array (n_classes,)
  let maxIdx = 0;
  for (let i = 1; i < proba.length; i++) {
    if (proba[i] > proba[maxIdx]) maxIdx = i;
  }

  return {
    postura:  meta.clases[maxIdx],
    confianza: proba[maxIdx],
    proba,
    clases:   meta.clases,
  };
}

// ── Mapa MediaPipe PoseLandmark ───────────────────────────────────
// Generado desde la enumeración de MediaPipe (33 landmarks)
const POSE_LM_NAMES = [
  "nose","left_eye_inner","left_eye","left_eye_outer",
  "right_eye_inner","right_eye","right_eye_outer",
  "left_ear","right_ear","mouth_left","mouth_right",
  "left_shoulder","right_shoulder",
  "left_elbow","right_elbow",
  "left_wrist","right_wrist",
  "left_pinky","right_pinky",
  "left_index","right_index",
  "left_thumb","right_thumb",
  "left_hip","right_hip",
  "left_knee","right_knee",
  "left_ankle","right_ankle",
  "left_heel","right_heel",
  "left_foot_index","right_foot_index",
];
const POSE_LM_MAP = {};
POSE_LM_NAMES.forEach((name, idx) => { POSE_LM_MAP[name] = { name, idx }; });

// ══════════════════════════════════════════════════════════════════
// CÁMARA
// ══════════════════════════════════════════════════════════════════
async function enumerateCameras() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true }); // pedir permiso
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");
    selectCam.innerHTML = "";
    videoDevices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Cámara ${i + 1}`;
      selectCam.appendChild(opt);
    });
  } catch (e) {
    console.warn("No se pudo enumerar cámaras:", e);
  }
}

// ══════════════════════════════════════════════════════════════════
// UUID anónimo
// ══════════════════════════════════════════════════════════════════
function getOrCreateUUID() {
  let uuid = localStorage.getItem("postura_uuid");
  if (!uuid) {
    uuid = crypto.randomUUID ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    localStorage.setItem("postura_uuid", uuid);
  }
  return uuid;
}

// ══════════════════════════════════════════════════════════════════
// MEDIAPIPE POSE + PROCESAMIENTO
// ══════════════════════════════════════════════════════════════════
function startPose(deviceId) {
  pose = new Pose({
    locateFile: file =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity:       1,
    smoothLandmarks:       true,
    enableSegmentation:    false,
    smoothSegmentation:    false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence:  0.5,
  });

  pose.onResults(onPoseResults);

  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width:  { ideal: 640 },
      height: { ideal: 480 },
    },
  };

  camera = new Camera(video, {
    onFrame: async () => {
      if (state.running) {
        canvasPose.width  = video.videoWidth  || 640;
        canvasPose.height = video.videoHeight || 480;
        await pose.send({ image: video });
      }
    },
    width:  640,
    height: 480,
    facingMode: "user",
  });

  // Override camera constraints to use selected device
  if (deviceId) {
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
      video.srcObject = stream;
    });
  }

  camera.start();
}

// ── Calcular dx hombros ───────────────────────────────────────────
function calcDx(landmarks) {
  const lIdx = POSE_LM_NAMES.indexOf("left_shoulder");
  const rIdx = POSE_LM_NAMES.indexOf("right_shoulder");
  return Math.abs(landmarks[lIdx].x - landmarks[rIdx].x);
}

// ── Switch lógica ─────────────────────────────────────────────────
function evaluarSwitch(dx) {
  const ahora = Date.now();
  let vista;
  if      (dx > UMBRAL_FRONTAL) vista = "frontal";
  else if (dx < UMBRAL_LATERAL) vista = "lateral";
  else { resetCandidato(); return false; }

  if (vista === state.modelo) { resetCandidato(); return false; }

  if (state.candidato !== vista) {
    state.candidato  = vista;
    state.tCandidato = ahora;
    return false;
  }

  const elapsed = ahora - state.tCandidato;
  const pct     = Math.min(elapsed / SWITCH_DELAY_MS, 1);
  switchBar.style.width = `${pct * 100}%`;
  switchWrap.classList.remove("hidden");
  const resta = ((SWITCH_DELAY_MS - elapsed) / 1000).toFixed(1);
  hudSwitch.textContent = `→ ${vista.toUpperCase()} ${resta}s`;
  hudSwitch.classList.remove("hidden");
  switchInfoVal.textContent = `Pendiente → ${vista} (${resta}s)`;
  switchInfoVal.className   = "switch-info-val pending";

  if (elapsed >= SWITCH_DELAY_MS) {
    state.modelo    = vista;
    resetCandidato();
    actualizarBadgeModelo();
    return true;
  }
  return false;
}

function resetCandidato() {
  state.candidato  = null;
  state.tCandidato = null;
  switchWrap.classList.add("hidden");
  hudSwitch.classList.add("hidden");
  switchInfoVal.textContent = "Estable";
  switchInfoVal.className   = "switch-info-val";
  switchBar.style.width     = "0%";
}

// ── Dibujar esqueleto ─────────────────────────────────────────────
const CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],
  [9,10],
];

function drawSkeleton(ctx, landmarks, color, alpha = 1) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Conexiones
  ctx.strokeStyle = color === "green" ? "#00e676" : "#00e5ff";
  ctx.lineWidth   = 2;
  for (const [a, b] of CONNECTIONS) {
    const la = landmarks[a], lb = landmarks[b];
    if (la.visibility > 0.4 && lb.visibility > 0.4) {
      ctx.beginPath();
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
      ctx.stroke();
    }
  }

  // Puntos
  for (const lm of landmarks) {
    if (lm.visibility > 0.4) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 4, 0, Math.PI * 2);
      ctx.fillStyle = color === "green" ? "#69ff47" : "#00e5ff";
      ctx.fill();
    }
  }
  ctx.restore();
}

// ── Blur rostro (landmarks cara) ─────────────────────────────────
const FACE_LANDMARKS = [0,1,2,3,4,5,6,7,8,9,10];

function blurFace(landmarks) {
  const w = canvasPose.width;
  const h = canvasPose.height;
  const facePts = FACE_LANDMARKS.map(i => landmarks[i]).filter(l => l.visibility > 0.3);
  if (facePts.length === 0) return;

  const xs = facePts.map(l => l.x * w);
  const ys = facePts.map(l => l.y * h);
  const xMin = Math.max(0, Math.min(...xs) - 40);
  const yMin = Math.max(0, Math.min(...ys) - 40);
  const xMax = Math.min(w, Math.max(...xs) + 40);
  const yMax = Math.min(h, Math.max(...ys) + 40);
  const rw = xMax - xMin;
  const rh = yMax - yMin;
  if (rw < 10 || rh < 10) return;

  // Obtener pixel data del video y aplicar blur simple
  ctxPose.save();
  ctxPose.filter = "blur(18px)";
  ctxPose.drawImage(video, xMin, yMin, rw, rh, xMin, yMin, rw, rh);
  ctxPose.restore();
}

// ── Callback principal de MediaPipe ──────────────────────────────
async function onPoseResults(results) {
  if (!state.running) return;

  const w = canvasPose.width;
  const h = canvasPose.height;

  // Dibujar imagen del video
  ctxPose.clearRect(0, 0, w, h);
  ctxPose.drawImage(results.image, 0, 0, w, h);

  if (!results.poseLandmarks) {
    updateHUD("Sin detección", 0, 0);
    return;
  }

  const lm = results.poseLandmarks;

  // Blur de rostro
  if (state.blurActivo) {
    blurFace(lm);
  }

  // Calcular dx y evaluar switch
  const dx = calcDx(lm);
  evaluarSwitch(dx);

  // Inferencia
  const res = await inferir(lm, state.modelo);
  if (!res) return;

  const { postura, confianza } = res;
  const esCorrecta = postura === POSTURA_CORRECTA;

  // Dibujar esqueleto
  const skelColor = state.modelo === "frontal" ? "green" : "cyan";
  drawSkeleton(ctxPose, lm, skelColor);

  // Registro sesión
  state.frames++;
  const tsNow = Date.now();
  state.datosCSV.push({
    timestamp:  new Date().toISOString(),
    postura,
    confianza:  confianza.toFixed(4),
    modelo:     state.modelo,
    dx_hombros: dx.toFixed(4),
  });

  // Captura periódica → Supabase
  if (tsNow - state.tUltimaCaptura >= CAPTURE_INTERVAL) {
    state.tUltimaCaptura = tsNow;
    insertarRegistro(postura, confianza, dx, state.modelo);
  }

  // Historial
  pushHistorial(postura, confianza, state.modelo);

  // UI update
  updateHUD(postura, confianza, dx, esCorrecta);
  updateStats(postura, confianza, dx, esCorrecta);
}

// ══════════════════════════════════════════════════════════════════
// UI updates
// ══════════════════════════════════════════════════════════════════
function updateHUD(postura, confianza, dx, esCorrecta = true) {
  const label = POSE_LABELS[postura] || postura;
  hudPostura.textContent = postura;
  hudPostura.className   = "hud-postura" + (esCorrecta ? "" : " bad");
  hudConf.textContent    = `conf: ${(confianza * 100).toFixed(0)}%`;
  hudDx.textContent      = `dx: ${dx.toFixed(3)}`;
}

function updateStats(postura, confianza, dx, esCorrecta) {
  const label = POSE_LABELS[postura] || postura;
  statPostura.textContent = postura;
  statEstado.textContent  = esCorrecta ? "✔ Postura correcta" : "✗ " + label;
  statEstado.className    = "stat-estado" + (esCorrecta ? "" : " bad");
  statConf.textContent    = `${(confianza * 100).toFixed(1)}%`;
  statDx.textContent      = dx.toFixed(3);
  statFrames.textContent  = state.frames;
  confFill.style.width    = `${(confianza * 100).toFixed(1)}%`;

  // Countdown próxima captura
  const elapsed   = Date.now() - state.tUltimaCaptura;
  const remaining = Math.max(0, Math.ceil((CAPTURE_INTERVAL - elapsed) / 1000));
  datasetCd.textContent = `${remaining}s`;
}

function actualizarBadgeModelo() {
  badgeModelo.textContent = state.modelo.toUpperCase();
  badgeModelo.className   = `badge badge-${state.modelo}`;
  statModelo.textContent  = state.modelo.toUpperCase();
}

function pushHistorial(postura, confianza, modelo) {
  state.historial.unshift({ postura, confianza, modelo });
  if (state.historial.length > HISTORIAL_MAX) state.historial.pop();

  histList.innerHTML = "";
  for (const h of state.historial) {
    const esOk  = h.postura === POSTURA_CORRECTA;
    const label = POSE_LABELS[h.postura] || h.postura;
    const div   = document.createElement("div");
    div.className = `historial-item ${esOk ? "ok" : "bad"}`;
    div.innerHTML = `
      <span class="historial-postura">${h.postura}</span>
      <span class="historial-conf">${(h.confianza * 100).toFixed(0)}%</span>
      <span class="historial-modelo">${h.modelo[0].toUpperCase()}</span>
    `;
    histList.appendChild(div);
  }
}

// ── Timer sesión ──────────────────────────────────────────────────
function startTimer() {
  setInterval(() => {
    if (!state.running || !state.tInicio) return;
    const seg = Math.floor((Date.now() - state.tInicio) / 1000);
    const min = Math.floor(seg / 60);
    const s   = seg % 60;
    statTiempo.textContent = min > 0
      ? `${min}m ${s.toString().padStart(2, "0")}s`
      : `${seg}s`;
  }, 1000);
}

// ══════════════════════════════════════════════════════════════════
// BIND UI EVENTS
// ══════════════════════════════════════════════════════════════════
function bindUI() {
  btnStart.addEventListener("click", iniciar);
  btnStop.addEventListener("click",  detener);
  btnBlur.addEventListener("click",  toggleBlur);
  btnCapture.addEventListener("click", capturaManual);
  btnExport.addEventListener("click",  exportarCSV);
}

// ── Iniciar ───────────────────────────────────────────────────────
async function iniciar() {
  state.uuid      = getOrCreateUUID();
  displayUUID.textContent = state.uuid.slice(0, 8) + "…";
  state.running   = true;
  state.tInicio   = Date.now();
  state.tUltimaCaptura = 0;
  state.frames    = 0;
  state.capturas  = 0;
  state.datosCSV  = [];
  state.historial = [];

  actualizarBadgeModelo();
  statModelo.textContent = state.modelo.toUpperCase();

  btnStart.classList.add("hidden");
  btnStop.classList.remove("hidden");

  const deviceId = selectCam.value || undefined;
  startPose(deviceId);
}

// ── Detener ───────────────────────────────────────────────────────
function detener() {
  state.running = false;
  if (camera) camera.stop();
  if (pose)   pose.close();
  camera = null;
  pose   = null;

  ctxPose.clearRect(0, 0, canvasPose.width, canvasPose.height);
  hudPostura.textContent = "—";
  hudConf.textContent    = "conf: —";
  hudDx.textContent      = "dx: —";

  btnStop.classList.add("hidden");
  btnStart.classList.remove("hidden");
}

// ── Blur toggle ───────────────────────────────────────────────────
function toggleBlur() {
  state.blurActivo = !state.blurActivo;
  btnBlur.textContent = state.blurActivo ? "🔒 Blur" : "🔓 Blur";
  btnBlur.className = state.blurActivo
    ? "btn-secondary active-blur"
    : "btn-secondary";
}

// ── Captura manual → Supabase ─────────────────────────────────────
async function capturaManual() {
  if (!state.running) return;
  const last = state.datosCSV[state.datosCSV.length - 1];
  if (!last) return;
  await insertarRegistro(
    last.postura,
    parseFloat(last.confianza),
    parseFloat(last.dx_hombros),
    last.modelo
  );
  // Flash visual
  btnCapture.textContent = "✅ Guardado";
  setTimeout(() => { btnCapture.textContent = "📸 Capturar"; }, 1500);
}

// ── Exportar CSV ──────────────────────────────────────────────────
function exportarCSV() {
  if (!state.datosCSV.length) {
    alert("Sin datos aún. Inicia el monitoreo primero.");
    return;
  }
  const headers = Object.keys(state.datosCSV[0]).join(",");
  const rows    = state.datosCSV.map(r => Object.values(r).join(",")).join("\n");
  const blob    = new Blob([headers + "\n" + rows], { type: "text/csv" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `postura_sesion_${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

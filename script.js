// ═══════════════════════════════════════════════════════════════════════════
// script.js — Monitor de Postura Web v3.2
// Token interno cifrado — el usuario NUNCA ingresa el token
// Solo provee su TELEGRAM_CHAT_ID
// ═══════════════════════════════════════════════════════════════════════════

// ── Credenciales internas (XOR key=73 + Base64) ──────────────────────────
// El token NUNCA aparece en texto plano. El usuario solo ingresa su Chat ID.
const _T = "cX99fH9weH59enMICA4oGiQnGTAZBhEQER0nGQUuJTF5EwUAAxk+Bn8fDRg5Og==";
const _B = "CSQgFjkmOj08OygWKyY9";

function _d(s) {
  const k = 73;
  const raw = atob(s);
  return raw.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ k)).join('');
}

const BOT_TOKEN    = _d(_T);   // token interno — nunca expuesto en la UI
const BOT_USERNAME = _d(_B);   // @mi_postura_bot

// ── Tabla fija de índices MediaPipe Pose (33 landmarks) ──────────────────
const POSE_LM_INDEX = {
  NOSE:0, LEFT_EYE_INNER:1, LEFT_EYE:2, LEFT_EYE_OUTER:3,
  RIGHT_EYE_INNER:4, RIGHT_EYE:5, RIGHT_EYE_OUTER:6,
  LEFT_EAR:7, RIGHT_EAR:8, MOUTH_LEFT:9, MOUTH_RIGHT:10,
  LEFT_SHOULDER:11, RIGHT_SHOULDER:12,
  LEFT_ELBOW:13, RIGHT_ELBOW:14,
  LEFT_WRIST:15, RIGHT_WRIST:16,
  LEFT_PINKY:17, RIGHT_PINKY:18,
  LEFT_INDEX:19, RIGHT_INDEX:20,
  LEFT_THUMB:21, RIGHT_THUMB:22,
  LEFT_HIP:23, RIGHT_HIP:24,
  LEFT_KNEE:25, RIGHT_KNEE:26,
  LEFT_ANKLE:27, RIGHT_ANKLE:28,
  LEFT_HEEL:29, RIGHT_HEEL:30,
  LEFT_FOOT_INDEX:31, RIGHT_FOOT_INDEX:32,
};

// ── Configuración Telegram ────────────────────────────────────────────────
// BOT_TOKEN siempre viene del código (cifrado). Solo CHAT_ID lo da el usuario.
const TG = {
  CHAT_ID: localStorage.getItem("tg_chat_id") || "",
  get enabled() { return !!(BOT_TOKEN && this.CHAT_ID); },
};

// ── Parámetros switch automático ──────────────────────────────────────────
const UMBRAL_FRONTAL  = 0.15;
const UMBRAL_LATERAL  = 0.10;
const SWITCH_DELAY_MS = 10000;

// ── Parámetros alertas Telegram ───────────────────────────────────────────
const MALA_SEG    = 20;
const COOLDOWN_MS = 120000;
const POSTURA_OK  = "TUP";

// ── Etiquetas y consejos ──────────────────────────────────────────────────
const ETIQUETAS = {
  TUP: "Erguido ✅",
  TLF: "Inclinado al frente ⚠️",
  TLB: "Inclinado atrás ⚠️",
  TLL: "Inclinado izquierda ⚠️",
  TLR: "Inclinado derecha ⚠️",
};
const CONSEJOS = {
  TLF: "Lleva la espalda al respaldo y levanta el monitor.",
  TLB: "Siéntate más erguido; evita recostarte mientras trabajas.",
  TLL: "Alinea tus hombros; no apoyes el codo izquierdo.",
  TLR: "Alinea tus hombros; no apoyes el codo derecho.",
};

// ── Estado global ─────────────────────────────────────────────────────────
let modelos         = {};
let modoActivo      = "auto";
let tipoActual      = "frontal";
let switchCand      = null;
let switchTS        = null;
let deteccionActiva = false;
let camera          = null;
let pose            = null;
let sesionInicio    = null;
let conteoPost      = {};
let tMalaInicio     = null;
let ultimaAlerta    = {};
let alertasEnv      = 0;

// ─────────────────────────────────────────────────────────────────────────
// CARGA DE MODELOS ONNX
// ─────────────────────────────────────────────────────────────────────────
async function cargarModelos() {
  for (const tipo of ["frontal", "lateral"]) {
    try {
      agregarLog(`⏳ Cargando modelo ${tipo}...`);
      const [sess_sc, sess_m, meta] = await Promise.all([
        ort.InferenceSession.create(`models/scaler_${tipo}.onnx`),
        ort.InferenceSession.create(`models/modelo_${tipo}.onnx`),
        fetch(`models/metadata_${tipo}.json`).then(r => r.json()),
      ]);
      modelos[tipo] = { sess_sc, sess_m, meta };
      agregarLog(`✅ Modelo ${tipo} OK (${meta.clases.join(", ")})`);
    } catch (err) {
      agregarLog(`❌ Modelo ${tipo}: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INFERENCIA
// ─────────────────────────────────────────────────────────────────────────
async function clasificar(landmarks, tipo) {
  const m = modelos[tipo];
  if (!m) return null;
  const { sess_sc, sess_m, meta } = m;

  const feat = new Float32Array(meta.feature_names.length);
  for (let i = 0; i < meta.feature_names.length; i++) {
    const fname = meta.feature_names[i];
    const parts = fname.split("_");
    const coord = parts.pop();
    const lmKey = parts.join("_").toUpperCase();
    const idx   = POSE_LM_INDEX[lmKey];
    if (idx !== undefined && landmarks[idx]) {
      feat[i] = landmarks[idx][coord] ?? 0;
    }
  }

  const tIn     = new ort.Tensor("float32", feat, [1, feat.length]);
  const scaled  = await sess_sc.run({ float_input: tIn });
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
  return { clase: meta.clases[maxI], confianza: maxP };
}

// ─────────────────────────────────────────────────────────────────────────
// SWITCH AUTOMÁTICO
// ─────────────────────────────────────────────────────────────────────────
function calcDx(landmarks) {
  const l = landmarks[11], r = landmarks[12];
  return (l && r) ? Math.abs(l.x - r.x) : null;
}

function evaluarSwitch(dx) {
  if (modoActivo !== "auto") return;
  let cand = dx > UMBRAL_FRONTAL ? "frontal" : dx < UMBRAL_LATERAL ? "lateral" : null;
  if (!cand || cand === tipoActual) { switchCand = null; switchTS = null; return; }
  if (switchCand !== cand) { switchCand = cand; switchTS = Date.now(); return; }
  if (Date.now() - switchTS >= SWITCH_DELAY_MS) {
    tipoActual = cand;
    switchCand = null; switchTS = null;
    agregarLog(`🔄 Auto-switch → ${tipoActual.toUpperCase()}`);
    actualizarBadge();
  }
}

function tipoEfectivo() {
  if (modoActivo === "auto")            return tipoActual;
  if (modoActivo === "lateral-frontal") return "lateral";
  return modoActivo;
}

// ─────────────────────────────────────────────────────────────────────────
// LOOP PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
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
  } catch(e) {
    agregarLog(`⚠ Inferencia: ${e.message}`);
    return;
  }
  if (!res) return;

  const { clase, confianza } = res;
  conteoPost[clase] = (conteoPost[clase] || 0) + 1;
  mostrarEstado(clase, clase === POSTURA_OK, confianza, dx, tipo);
  tickMala(clase !== POSTURA_OK, clase);
}

// ─────────────────────────────────────────────────────────────────────────
// TIEMPO MALA POSTURA + ALERTA
// ─────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────
// TELEGRAM — usa BOT_TOKEN interno, nunca el del usuario
// ─────────────────────────────────────────────────────────────────────────
async function tgSend(text) {
  if (!TG.enabled) return false;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ chat_id: TG.CHAT_ID, text, parse_mode:"HTML" }) }
    );
    const d = await r.json();
    return d.ok;
  } catch(e) { return false; }
}

async function enviarConexionOk() {
  const msg =
    `✅ <b>Monitor de Postura conectado</b>\n\n` +
    `📅 ${new Date().toLocaleString("es-EC")}\n` +
    `🌐 Sistema listo para monitorear tu postura.\n` +
    `⏱ Recibirás alertas si mantienes mala postura por más de ${MALA_SEG}s.`;
  const ok = await tgSend(msg);
  if (ok) agregarLog("📬 TG: notificación de conexión enviada");
  else    agregarLog("⚠ TG: no se pudo notificar (revisa tu Chat ID)");
}

async function enviarAlertaTG(clase, segs) {
  alertasEnv++;
  const msg =
    `⚠️ <b>Alerta de Postura</b>\n\n` +
    `📌 Postura: <b>${ETIQUETAS[clase] || clase}</b>\n` +
    `⏱ Duración: <b>${segs} segundos</b> consecutivos\n\n` +
    `💡 ${CONSEJOS[clase] || ""}\n\n` +
    `🕐 ${new Date().toLocaleTimeString("es-EC")}`;
  await tgSend(msg);
  agregarLog(`📬 TG: alerta ${clase} (${segs}s)`);
}

async function enviarResumen() {
  if (!sesionInicio) return;
  const durS  = Math.round((Date.now() - sesionInicio) / 1000);
  const total = Object.values(conteoPost).reduce((a,b)=>a+b,0) || 1;
  const sorted = Object.entries(conteoPost)
    .filter(([k]) => k !== POSTURA_OK)
    .sort(([,a],[,b]) => b - a);

  let lineas = sorted.slice(0,3).map(([k,v]) => {
    const pct = ((v/total)*100).toFixed(1);
    return `  • <b>${ETIQUETAS[k]||k}</b> — ${pct}%\n    💡 ${CONSEJOS[k]||""}`;
  }).join("\n");
  if (!lineas) lineas = "  ¡Sin posturas problemáticas! 🎉";

  const pctOk = (((conteoPost[POSTURA_OK]||0)/total)*100).toFixed(1);
  const msg =
    `📊 <b>Resumen de Sesión</b>\n\n` +
    `⏱ Duración: <b>${Math.floor(durS/60)}m ${durS%60}s</b>\n` +
    `✅ Postura correcta: <b>${pctOk}%</b>\n` +
    `🚨 Alertas enviadas: ${alertasEnv}\n\n` +
    `<b>Posturas a mejorar:</b>\n${lineas}\n\n` +
    `📅 ${new Date().toLocaleString("es-EC")}`;
  const ok = await tgSend(msg);
  if (ok) agregarLog("📬 TG: resumen enviado");
}

// ─────────────────────────────────────────────────────────────────────────
// GUARDAR / CARGAR CONFIG (solo Chat ID — token es interno)
// ─────────────────────────────────────────────────────────────────────────
function guardarChatId(chatId) {
  localStorage.setItem("tg_chat_id", chatId);
  TG.CHAT_ID = chatId;
}

// Auto-detectar Chat ID usando el token interno
async function autoDetectarChatId(targetInputIds = []) {
  agregarLog("🔍 Buscando tu Chat ID...");
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=10&offset=-10`
    );
    const d = await r.json();
    if (!d.ok) {
      return { ok: false, msg: `❌ Error del bot: ${d.description}` };
    }
    if (!d.result || d.result.length === 0) {
      return {
        ok: false,
        msg: "⚠ No hay mensajes recientes.\n\nPor favor:\n1. Abre Telegram\n2. Busca el bot por nombre\n3. Envíale cualquier mensaje\n4. Vuelve aquí y haz clic en Detectar de nuevo."
      };
    }
    const last   = d.result[d.result.length - 1];
    const chat   = last.message?.chat || last.callback_query?.message?.chat;
    if (!chat) {
      return { ok: false, msg: "No se pudo obtener el Chat ID. Envía un mensaje al bot e intenta de nuevo." };
    }
    const chatId = String(chat.id);

    // Escribir en todos los campos indicados
    targetInputIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = chatId;
    });
    // Sincronizar siempre todos los campos conocidos
    ["tg-chat-id-modal", "tg-chat-id-sidebar"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = chatId;
    });

    agregarLog(`✅ Chat ID detectado: ${chatId}`);
    return { ok: true, chatId };
  } catch(e) {
    return { ok: false, msg: `❌ Error de red: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────
function mostrarEstado(clase, esOk, confianza, dx, tipo) {
  const el = document.getElementById("postura-label");
  if (el) {
    el.textContent = ETIQUETAS[clase] || clase;
    el.style.color = esOk ? "#00e676" : esOk === null ? "#888" : "#ff5252";
  }
  const c = document.getElementById("confianza-label");
  if (c) c.textContent = confianza ? `${(confianza*100).toFixed(0)}%` : "—";
  const d = document.getElementById("dx-label");
  if (d && dx != null) d.textContent = `dx: ${dx.toFixed(3)}`;
  const m = document.getElementById("modo-activo-label");
  if (m) m.textContent = modoActivo === "auto"
    ? `AUTO:${tipoActual.toUpperCase()}`
    : modoActivo.toUpperCase().replace("-"," ");
}

function actualizarBarra(segs) {
  const b = document.getElementById("barra-mala");
  const l = document.getElementById("tiempo-mala-label");
  if (!b) return;
  const pct = Math.min((segs / MALA_SEG) * 100, 100);
  b.style.width = `${pct}%`;
  b.style.background = pct < 50 ? "#00e676" : pct < 85 ? "#ffab40" : "#ff5252";
  if (l) l.textContent = `${Math.round(segs)}s / ${MALA_SEG}s`;
}

function actualizarBadge() {
  const b = document.getElementById("badge-modo");
  if (!b) return;
  const labels = { auto:"🔄 AUTO", frontal:"🖥 FRONTAL",
                   lateral:"📐 LATERAL", "lateral-frontal":"📐 LAT·FRONTAL" };
  b.textContent = labels[modoActivo] || modoActivo.toUpperCase();
}

function agregarLog(msg) {
  const el = document.getElementById("log-box");
  if (!el) { console.log(msg); return; }
  const ts = new Date().toLocaleTimeString("es-EC");
  el.textContent = `[${ts}] ${msg}\n` + el.textContent.slice(0, 4000);
}

// ─────────────────────────────────────────────────────────────────────────
// CÁMARA
// ─────────────────────────────────────────────────────────────────────────
async function iniciarDeteccion() {
  if (deteccionActiva) return;
  deteccionActiva = true;
  sesionInicio = Date.now();
  conteoPost = {}; alertasEnv = 0; ultimaAlerta = {}; tMalaInicio = null;

  agregarLog("▶ Iniciando detección...");
  const videoEl = document.getElementById("webcam");

  try {
    pose = new Pose({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    pose.setOptions({
      modelComplexity: 1, smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    pose.onResults(async results => {
      dibujarPose(results);
      if (results.poseLandmarks) await procesarFrame(results.poseLandmarks);
      else { mostrarEstado("Sin persona", null, 0); tickMala(false); }
    });

    camera = new Camera(videoEl, {
      onFrame: async () => { if (deteccionActiva && pose) await pose.send({ image: videoEl }); },
      width: 640, height: 480,
    });
    await camera.start();
    agregarLog("✅ Cámara iniciada");
    await enviarConexionOk();
  } catch(err) {
    agregarLog(`❌ Error cámara: ${err.message}`);
    deteccionActiva = false;
  }
}

async function detenerDeteccion() {
  if (!deteccionActiva) return;
  deteccionActiva = false;
  try { if (camera) { camera.stop(); camera = null; } } catch(e){}
  try { if (pose)   { await pose.close(); pose = null; } } catch(e){}
  agregarLog("⏹ Detección detenida");
  await enviarResumen();
}

// ─────────────────────────────────────────────────────────────────────────
// DIBUJO
// ─────────────────────────────────────────────────────────────────────────
function dibujarPose(results) {
  const canvas = document.getElementById("output-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (results.image) ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (results.poseLandmarks) {
    const col = tipoEfectivo() === "frontal" ? "#00e676" : "#40c4ff";
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS,
      { color:"#ffffff33", lineWidth:2 });
    drawLandmarks(ctx, results.poseLandmarks,
      { color: col, lineWidth:1, radius:4 });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// MODOS
// ─────────────────────────────────────────────────────────────────────────
function setModo(modo) {
  modoActivo = modo;
  tipoActual = modo === "auto" ? "frontal"
             : modo === "lateral-frontal" ? "lateral"
             : modo;
  switchCand = null; switchTS = null;
  actualizarBadge();
  agregarLog(`🔀 Modo → ${modo.toUpperCase()}`);
  document.querySelectorAll(".btn-modo").forEach(b =>
    b.classList.toggle("activo", b.dataset.modo === modo));
  const descs = {
    auto: "Cambia automáticamente entre frontal y lateral según la separación de hombros (dx).",
    frontal: "Fuerza modelo frontal. Úsalo cuando la cámara te mira de frente.",
    lateral: "Lateral puro: cámara al costado de tu silla, en perfil.",
    "lateral-frontal": "Cámara integrada girada de lado. Usa el modelo lateral aunque MediaPipe vea ambos hombros.",
  };
  const el = document.getElementById("modo-desc-text");
  if (el) el.textContent = descs[modo] || "";
}

// ─────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Pre-cargar chat ID guardado
  ["tg-chat-id-modal","tg-chat-id-sidebar"].forEach(id => {
    const el = document.getElementById(id);
    if (el && TG.CHAT_ID) el.value = TG.CHAT_ID;
  });

  // Mostrar nombre del bot en todos los lugares donde aparece
  document.querySelectorAll(".bot-username-display").forEach(el => {
    el.textContent = BOT_USERNAME;
  });
  // Actualizar el enlace del bot con el username real
  const botLink = document.getElementById("btn-open-bot");
  if (botLink) botLink.href = `https://t.me/${BOT_USERNAME.replace("@","")}`;

  // Botones de modo
  document.querySelectorAll(".btn-modo").forEach(btn =>
    btn.addEventListener("click", () => setModo(btn.dataset.modo))
  );
  document.getElementById("btn-iniciar")?.addEventListener("click", iniciarDeteccion);
  document.getElementById("btn-detener")?.addEventListener("click", detenerDeteccion);

  // Cargar modelos
  await cargarModelos();
  actualizarBadge();
  agregarLog("✅ Sistema listo. Configura Telegram y presiona Iniciar.");

  // Stats ticker
  setInterval(() => {
    if (!sesionInicio) return;
    const s = Math.floor((Date.now()-sesionInicio)/1000);
    const total = Object.values(conteoPost).reduce((a,b)=>a+b,0)||1;
    const pctOk = (((conteoPost[POSTURA_OK]||0)/total)*100).toFixed(0);
    const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    set("stat-tiempo", `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`);
    set("stat-frames", total);
    set("stat-alertas", alertasEnv);
    set("stat-buena", deteccionActiva ? `${pctOk}%` : "—");
  }, 1000);
});

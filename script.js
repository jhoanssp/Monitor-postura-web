// ═══════════════════════════════════════════════════════════════════════════════
// script.js — Monitor de Postura Web v3
//
// NOVEDADES v3:
//   • Modo "lateral-frontal": cámara integrada del laptop posicionada de lado
//     (usa modelo lateral aunque se vean ambos hombros separados en X)
//   • Switch automático conservado sin cambios (frontal ↔ lateral)
//   • Notificaciones Telegram:
//       - Conectado correctamente al arrancar
//       - Mala postura durante 20 segundos consecutivos
//       - Resumen al detener la detección (posturas más frecuentes)
//   • Configuración de Telegram desde el modal de consentimiento
// ═══════════════════════════════════════════════════════════════════════════════

// ── Configuración Telegram ───────────────────────────────────────────────────
// Estos valores se leen del localStorage (se configuran en el modal de inicio)
const TG = {
  BOT_TOKEN: localStorage.getItem("tg_bot_token") || "",
  CHAT_ID:   localStorage.getItem("tg_chat_id")   || "",
  get enabled() { return this.BOT_TOKEN && this.CHAT_ID; },
};

// ── Parámetros del switch automático ─────────────────────────────────────────
const UMBRAL_FRONTAL   = 0.15;   // |dx_hombros| > UMBRAL_FRONTAL → frontal
const UMBRAL_LATERAL   = 0.10;   // |dx_hombros| < UMBRAL_LATERAL → lateral
const SWITCH_DELAY_MS  = 10000;  // ms continuos para confirmar switch

// ── Parámetros de alertas Telegram ───────────────────────────────────────────
const MALA_POSTURA_UMBRAL_SEG  = 20;    // segundos consecutivos → alerta TG
const COOLDOWN_ALERTA_MS       = 120000; // 2 min entre alertas del mismo tipo
const POSTURA_CORRECTA         = "TUP";

// ── Clases/etiquetas legibles ─────────────────────────────────────────────────
const ETIQUETAS_POSTURA = {
  TUP: "Erguido ✅",
  TLF: "Inclinado al frente ⚠️",
  TLB: "Inclinado atrás ⚠️",
  TLL: "Inclinado izquierda ⚠️",
  TLR: "Inclinado derecha ⚠️",
};

const CONSEJOS_POSTURA = {
  TLF: "Lleva la espalda al respaldo de la silla y levanta el monitor.",
  TLB: "Siéntate más erguido; evita recostarte en la silla mientras trabajas.",
  TLL: "Alinea tus hombros horizontalmente; no apoyes el codo izquierdo.",
  TLR: "Alinea tus hombros horizontalmente; no apoyes el codo derecho.",
};

// ── Estado global ─────────────────────────────────────────────────────────────
let modelos = {};          // { frontal: {sess_scaler, sess_model, meta}, lateral: {...} }
let modoActivo = "auto";   // "frontal" | "lateral" | "lateral-frontal" | "auto"
let tipoActual = "frontal";// tipo efectivo en uso
let switchCandidato = null;
let switchTimestamp = null;

let deteccionActiva   = false;
let camera            = null;
let pose              = null;
let animFrameId       = null;

// Estadísticas de sesión
let sesionInicio     = null;
let conteoPosturas   = {};   // { "TUP": 120, "TLF": 40, ... }
let malosConsecutivos = 0;   // segundos de mala postura consecutiva
let tMalaPosInicio   = null; // timestamp inicio racha mala
let ultimaAlerta     = {};   // { "TLF": timestamp, ... }
let alertasEnviadas  = 0;

// ─────────────────────────────────────────────────────────────────────────────
// CARGA DE MODELOS
// ─────────────────────────────────────────────────────────────────────────────
async function cargarModelos() {
  const log = (msg) => agregarLog(msg);

  log("⏳ Cargando runtime ONNX...");
  // ort ya está cargado vía CDN en index.html

  for (const tipo of ["frontal", "lateral"]) {
    try {
      log(`⏳ Cargando modelo ${tipo}...`);
      const [sess_scaler, sess_model, meta] = await Promise.all([
        ort.InferenceSession.create(`models/scaler_${tipo}.onnx`),
        ort.InferenceSession.create(`models/modelo_${tipo}.onnx`),
        fetch(`models/metadata_${tipo}.json`).then(r => r.json()),
      ]);
      modelos[tipo] = { sess_scaler, sess_model, meta };
      log(`✅ Modelo ${tipo} cargado (${meta.clases.join(", ")})`);
    } catch (err) {
      log(`❌ Error modelo ${tipo}: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INFERENCIA
// ─────────────────────────────────────────────────────────────────────────────
async function clasificar(landmarks, tipo) {
  const m = modelos[tipo];
  if (!m) return null;
  const { sess_scaler, sess_model, meta } = m;

  // Extraer features en el orden de meta.feature_names
  const row = {};
  for (const lm of Object.values(window.poseLib.PoseLandmark || {})) {
    // MediaPipe Holistic/Pose devuelve landmarks como array
  }
  // Construir vector usando el nombre de cada feature
  const feat = new Float32Array(meta.feature_names.length);
  for (let i = 0; i < meta.feature_names.length; i++) {
    const fname = meta.feature_names[i];
    // fname es p.ej. "nose_x", "left_shoulder_y"
    const parts = fname.split("_");
    const coord = parts.pop();               // "x", "y" o "z"
    const lmName = parts.join("_").toUpperCase(); // "NOSE", "LEFT_SHOULDER"
    const idx = window.poseLib.POSE_LANDMARKS?.[lmName] ?? landmarkIndexFromName(lmName);
    if (idx !== undefined && landmarks[idx]) {
      feat[i] = landmarks[idx][coord] ?? 0;
    }
  }

  const t_in = new ort.Tensor("float32", feat, [1, feat.length]);
  const scaled = await sess_scaler.run({ float_input: t_in });
  const t_scaled = scaled[Object.keys(scaled)[0]];
  const result  = await sess_model.run({ float_input: t_scaled });

  // Probabilidades
  const probaKey = Object.keys(result).find(k => result[k].dims.length === 2);
  const proba    = probaKey ? result[probaKey].data : null;
  if (!proba) return null;

  let maxP = -1, maxIdx = 0;
  for (let i = 0; i < proba.length; i++) {
    if (proba[i] > maxP) { maxP = proba[i]; maxIdx = i; }
  }
  return { clase: meta.clases[maxIdx], confianza: maxP, proba: Array.from(proba), clases: meta.clases };
}

// Helper: nombre MediaPipe → índice numérico (tabla fija)
const POSE_LM_INDEX = {
  NOSE:0, LEFT_EYE_INNER:1, LEFT_EYE:2, LEFT_EYE_OUTER:3,
  RIGHT_EYE_INNER:4, RIGHT_EYE:5, RIGHT_EYE_OUTER:6,
  LEFT_EAR:7, RIGHT_EAR:8, MOUTH_LEFT:9, MOUTH_RIGHT:10,
  LEFT_SHOULDER:11, RIGHT_SHOULDER:12,
  LEFT_ELBOW:13, RIGHT_ELBOW:14, LEFT_WRIST:15, RIGHT_WRIST:16,
  LEFT_PINKY:17, RIGHT_PINKY:18, LEFT_INDEX:19, RIGHT_INDEX:20,
  LEFT_THUMB:21, RIGHT_THUMB:22,
  LEFT_HIP:23, RIGHT_HIP:24, LEFT_KNEE:25, RIGHT_KNEE:26,
  LEFT_ANKLE:27, RIGHT_ANKLE:28, LEFT_HEEL:29, RIGHT_HEEL:30,
  LEFT_FOOT_INDEX:31, RIGHT_FOOT_INDEX:32,
};
function landmarkIndexFromName(name) { return POSE_LM_INDEX[name]; }

// ─────────────────────────────────────────────────────────────────────────────
// SWITCH AUTOMÁTICO DE MODELO
// ─────────────────────────────────────────────────────────────────────────────
function calcularDxHombros(landmarks) {
  const lh = landmarks[11]; // LEFT_SHOULDER
  const rh = landmarks[12]; // RIGHT_SHOULDER
  if (!lh || !rh) return null;
  return Math.abs(lh.x - rh.x);
}

function evaluarSwitch(dx) {
  if (modoActivo !== "auto") return false;

  let candidato = null;
  if (dx > UMBRAL_FRONTAL) candidato = "frontal";
  else if (dx < UMBRAL_LATERAL) candidato = "lateral";

  if (!candidato || candidato === tipoActual) {
    switchCandidato  = null;
    switchTimestamp  = null;
    return false;
  }

  if (switchCandidato !== candidato) {
    switchCandidato = candidato;
    switchTimestamp = Date.now();
    return false;
  }

  if (Date.now() - switchTimestamp >= SWITCH_DELAY_MS) {
    tipoActual      = switchCandidato;
    switchCandidato = null;
    switchTimestamp = null;
    agregarLog(`🔄 Switch automático → ${tipoActual.toUpperCase()}`);
    actualizarBadgeModo();
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN DEL TIPO EFECTIVO (incluye lateral-frontal)
// ─────────────────────────────────────────────────────────────────────────────
function tipoEfectivo() {
  if (modoActivo === "auto")            return tipoActual;
  if (modoActivo === "lateral-frontal") return "lateral";  // usa modelo lateral
  return modoActivo;                                        // frontal o lateral forzado
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOP PRINCIPAL DE DETECCIÓN
// ─────────────────────────────────────────────────────────────────────────────
async function procesarFrame(landmarks) {
  if (!landmarks || landmarks.length === 0) {
    mostrarEstado("Sin detección", null, 0);
    actualizarTiempoMala(false);
    return;
  }

  const dx = calcularDxHombros(landmarks);
  if (dx !== null) evaluarSwitch(dx);

  const tipo = tipoEfectivo();
  const res  = await clasificar(landmarks, tipo);
  if (!res) return;

  const { clase, confianza } = res;
  const esCorrecta = clase === POSTURA_CORRECTA;

  // Estadísticas
  conteoPosturas[clase] = (conteoPosturas[clase] || 0) + 1;

  // HUD
  mostrarEstado(clase, esCorrecta, confianza, dx, tipo);

  // Tiempo mala postura + alertas Telegram
  actualizarTiempoMala(!esCorrecta, clase);
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTIÓN DE TIEMPO DE MALA POSTURA
// ─────────────────────────────────────────────────────────────────────────────
function actualizarTiempoMala(esMala, clase) {
  const ahora = Date.now();

  if (!esMala) {
    tMalaPosInicio = null;
    actualizarBarraMala(0);
    return;
  }

  if (!tMalaPosInicio) tMalaPosInicio = ahora;
  const segsMala = (ahora - tMalaPosInicio) / 1000;
  actualizarBarraMala(segsMala);

  // Disparar alerta Telegram si superó umbral y cooldown OK
  if (segsMala >= MALA_POSTURA_UMBRAL_SEG) {
    const ultimaDeEste = ultimaAlerta[clase] || 0;
    if (ahora - ultimaDeEste >= COOLDOWN_ALERTA_MS) {
      ultimaAlerta[clase] = ahora;
      enviarAlertaTelegram(clase, Math.round(segsMala));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM API
// ─────────────────────────────────────────────────────────────────────────────
async function enviarTelegram(texto) {
  if (!TG.enabled) return false;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TG.BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id:    TG.CHAT_ID,
          text:       texto,
          parse_mode: "HTML",
        }),
      }
    );
    const data = await resp.json();
    return data.ok;
  } catch (e) {
    console.warn("Telegram error:", e);
    return false;
  }
}

async function enviarConexionOk() {
  const msg =
    `✅ <b>Monitor de Postura conectado</b>\n\n` +
    `📅 ${new Date().toLocaleString("es-EC")}\n` +
    `🌐 Sistema listo para monitorear tu postura.\n` +
    `⏱ Recibirás alertas si mantienes una mala postura por más de ${MALA_POSTURA_UMBRAL_SEG} segundos.`;
  const ok = await enviarTelegram(msg);
  if (ok) agregarLog("📬 Telegram: notificación de conexión enviada");
}

async function enviarAlertaTelegram(clase, segundos) {
  alertasEnviadas++;
  const etiqueta = ETIQUETAS_POSTURA[clase] || clase;
  const consejo  = CONSEJOS_POSTURA[clase]  || "";
  const msg =
    `⚠️ <b>Alerta de Postura</b>\n\n` +
    `📌 Postura: <b>${etiqueta}</b>\n` +
    `⏱ Duración: <b>${segundos} segundos</b> consecutivos\n\n` +
    `💡 ${consejo}\n\n` +
    `📅 ${new Date().toLocaleTimeString("es-EC")}`;
  await enviarTelegram(msg);
  agregarLog(`📬 Telegram: alerta ${clase} enviada (${segundos}s)`);
}

async function enviarResumenSesion() {
  if (!sesionInicio) return;
  const durSeg = Math.round((Date.now() - sesionInicio) / 1000);
  const min    = Math.floor(durSeg / 60);
  const seg    = durSeg % 60;

  // Ordenar posturas por frecuencia
  const total = Object.values(conteoPosturas).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(conteoPosturas)
    .filter(([k]) => k !== POSTURA_CORRECTA)
    .sort(([, a], [, b]) => b - a);

  let lineasMalas = sorted.slice(0, 3).map(([k, v]) => {
    const pct    = ((v / total) * 100).toFixed(1);
    const etiq   = ETIQUETAS_POSTURA[k] || k;
    const consejo = CONSEJOS_POSTURA[k] || "";
    return `  • <b>${etiq}</b> — ${pct}%\n    💡 ${consejo}`;
  }).join("\n");

  if (!lineasMalas) lineasMalas = "  ¡Excelente! No se detectaron posturas problemáticas.";

  const pctBuena = (((conteoPosturas[POSTURA_CORRECTA] || 0) / total) * 100).toFixed(1);

  const msg =
    `📊 <b>Resumen de Sesión</b>\n\n` +
    `⏱ Duración: <b>${min}m ${seg}s</b>\n` +
    `✅ Postura correcta: <b>${pctBuena}%</b> del tiempo\n` +
    `🚨 Alertas enviadas: ${alertasEnviadas}\n\n` +
    `<b>Posturas a mejorar:</b>\n${lineasMalas}\n\n` +
    `📅 ${new Date().toLocaleString("es-EC")}`;

  const ok = await enviarTelegram(msg);
  if (ok) agregarLog("📬 Telegram: resumen de sesión enviado");
}

// ─────────────────────────────────────────────────────────────────────────────
// UI — HUD DE ESTADO
// ─────────────────────────────────────────────────────────────────────────────
function mostrarEstado(clase, esCorrecta, confianza, dx, tipo) {
  const el = document.getElementById("postura-label");
  if (!el) return;

  const etiq  = ETIQUETAS_POSTURA[clase] || clase;
  const color = esCorrecta ? "#00e676" : "#ff5252";
  el.textContent  = etiq;
  el.style.color  = color;

  const conf = document.getElementById("confianza-label");
  if (conf) conf.textContent = `${(confianza * 100).toFixed(0)}%`;

  const dxEl = document.getElementById("dx-label");
  if (dxEl && dx !== null && dx !== undefined) {
    dxEl.textContent = `dx: ${dx.toFixed(3)}`;
  }

  const modoEl = document.getElementById("modo-activo-label");
  if (modoEl) {
    const mStr = modoActivo === "auto"
      ? `AUTO:${tipoActual.toUpperCase()}`
      : modoActivo.toUpperCase().replace("-", " ");
    modoEl.textContent = mStr;
  }
}

function actualizarBarraMala(segs) {
  const barra = document.getElementById("barra-mala");
  const label = document.getElementById("tiempo-mala-label");
  if (!barra) return;
  const pct = Math.min((segs / MALA_POSTURA_UMBRAL_SEG) * 100, 100);
  barra.style.width = `${pct}%`;
  barra.style.background = pct < 50 ? "#00e676" : pct < 85 ? "#ffab40" : "#ff5252";
  if (label) label.textContent = `${Math.round(segs)}s / ${MALA_POSTURA_UMBRAL_SEG}s`;
}

function actualizarBadgeModo() {
  const b = document.getElementById("badge-modo");
  if (!b) return;
  const labels = {
    "frontal":          "🖥 FRONTAL",
    "lateral":          "📐 LATERAL",
    "lateral-frontal":  "📐 LAT-FRONTAL",
    "auto":             "🔄 AUTO",
  };
  b.textContent = labels[modoActivo] || modoActivo.toUpperCase();
}

function agregarLog(msg) {
  const el = document.getElementById("log-box");
  if (!el) { console.log(msg); return; }
  const ts = new Date().toLocaleTimeString("es-EC");
  el.textContent = `[${ts}] ${msg}\n` + el.textContent.slice(0, 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL DE CÁMARA (MediaPipe Pose vía CDN)
// ─────────────────────────────────────────────────────────────────────────────
async function iniciarDeteccion() {
  if (deteccionActiva) return;

  deteccionActiva   = true;
  sesionInicio      = Date.now();
  conteoPosturas    = {};
  alertasEnviadas   = 0;
  ultimaAlerta      = {};
  tMalaPosInicio    = null;

  agregarLog("▶ Iniciando detección...");

  const videoEl = document.getElementById("webcam");

  try {
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (!deteccionActiva) return;
        await pose.send({ image: videoEl });
      },
      width: 640, height: 480,
    });

    pose = new Pose({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    pose.setOptions({
      modelComplexity:        1,
      smoothLandmarks:        true,
      enableSegmentation:     false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    });
    pose.onResults(async (results) => {
      dibujarPose(results);
      if (results.poseLandmarks) {
        await procesarFrame(results.poseLandmarks);
      } else {
        mostrarEstado("Sin detección", null, 0);
        actualizarTiempoMala(false);
      }
    });

    await camera.start();
    agregarLog("✅ Cámara iniciada");

    // Notificación de conexión Telegram
    await enviarConexionOk();

  } catch (err) {
    agregarLog(`❌ Error cámara: ${err.message}`);
    deteccionActiva = false;
  }
}

async function detenerDeteccion() {
  if (!deteccionActiva) return;
  deteccionActiva = false;
  if (camera) { await camera.stop(); camera = null; }
  if (pose)   { await pose.close();  pose   = null; }
  agregarLog("⏹ Detección detenida");

  // Enviar resumen Telegram
  await enviarResumenSesion();
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS — DIBUJO DEL ESQUELETO
// ─────────────────────────────────────────────────────────────────────────────
function dibujarPose(results) {
  const canvas = document.getElementById("output-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.image) {
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  }

  if (results.poseLandmarks) {
    const color = tipoEfectivo() === "frontal" ? "#00e676" : "#40c4ff";
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS,
      { color: "#ffffff44", lineWidth: 2 });
    drawLandmarks(ctx, results.poseLandmarks,
      { color, lineWidth: 1, radius: 4 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE MODOS (botones del UI)
// ─────────────────────────────────────────────────────────────────────────────
function setModo(modo) {
  modoActivo  = modo;
  tipoActual  = (modo === "auto") ? "frontal" : (modo === "lateral-frontal" ? "lateral" : modo);
  switchCandidato = null;
  switchTimestamp = null;
  actualizarBadgeModo();
  agregarLog(`🔀 Modo cambiado → ${modo.toUpperCase()}`);

  // Resaltar botón activo
  document.querySelectorAll(".btn-modo").forEach(b => {
    b.classList.toggle("activo", b.dataset.modo === modo);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN TELEGRAM (guardar en localStorage)
// ─────────────────────────────────────────────────────────────────────────────
function guardarConfigTelegram() {
  const token  = document.getElementById("tg-token")?.value.trim()   || "";
  const chatId = document.getElementById("tg-chat-id")?.value.trim() || "";

  if (!token || !chatId) {
    alert("Completa el Token del Bot y el Chat ID.");
    return false;
  }
  localStorage.setItem("tg_bot_token", token);
  localStorage.setItem("tg_chat_id",   chatId);
  TG.BOT_TOKEN = token;
  TG.CHAT_ID   = chatId;
  return true;
}

async function probarTelegram() {
  if (!guardarConfigTelegram()) return;
  const ok = await enviarTelegram("🤖 <b>Monitor de Postura</b> — conexión de prueba exitosa ✅");
  alert(ok
    ? "✅ Mensaje enviado a Telegram correctamente."
    : "❌ Error al enviar. Verifica el token y el chat ID.");
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT — Se ejecuta cuando el DOM está listo
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Pre-cargar valores de Telegram en los campos si existen
  const tokenEl  = document.getElementById("tg-token");
  const chatIdEl = document.getElementById("tg-chat-id");
  if (tokenEl  && TG.BOT_TOKEN) tokenEl.value  = TG.BOT_TOKEN;
  if (chatIdEl && TG.CHAT_ID)   chatIdEl.value = TG.CHAT_ID;

  // Botones de modo
  document.querySelectorAll(".btn-modo").forEach(btn => {
    btn.addEventListener("click", () => setModo(btn.dataset.modo));
  });

  // Botón iniciar/detener
  document.getElementById("btn-iniciar")?.addEventListener("click", iniciarDeteccion);
  document.getElementById("btn-detener")?.addEventListener("click", detenerDeteccion);

  // Botón probar Telegram
  document.getElementById("btn-probar-tg")?.addEventListener("click", probarTelegram);
  // Botón guardar config Telegram
  document.getElementById("btn-guardar-tg")?.addEventListener("click", () => {
    if (guardarConfigTelegram()) alert("✅ Configuración de Telegram guardada.");
  });

  // Cargar modelos
  await cargarModelos();
  actualizarBadgeModo();

  agregarLog("✅ Sistema listo. Configura Telegram y presiona Iniciar.");
});

/**
 * main.js
 * Control de camara, modos de deteccion e inicializacion de la app.
 * Punto de entrada principal — depende de todos los otros modulos.
 *
 * Cambios:
 *  - Pantalla final al detener (agradecimiento + stats + boton reiniciar)
 *  - Espejo horizontal en el canvas (solo visual, logica intacta)
 */

// ── Estado global de sesion ────────────────────────────────────────────────
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

// UUID de usuario — persistente en localStorage
const USER_UUID = (() => {
  let id = localStorage.getItem("user_uuid");
  if (!id) {
    id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem("user_uuid", id);
  }
  return id;
})();

// ── Espejo visual ─────────────────────────────────────────────────────────
// Solo afecta la presentacion en pantalla. La logica de landmarks no cambia.
function aplicarEspejo() {
  const canvas  = document.getElementById("output-canvas");
  const webcam  = document.getElementById("webcam");
  if (canvas) canvas.style.transform = "scaleX(-1)";
  if (webcam) webcam.style.transform  = "scaleX(-1)";
}

function quitarEspejo() {
  const canvas  = document.getElementById("output-canvas");
  const webcam  = document.getElementById("webcam");
  if (canvas) canvas.style.transform = "scaleX(1)";
  if (webcam) webcam.style.transform  = "scaleX(1)";
}

// ── Pantalla de resultado final ───────────────────────────────────────────
function mostrarPantallaFinal(durS, pctOk, totalFrames) {
  const overlay = document.getElementById("pantalla-final");
  if (!overlay) return;

  // Calcular postura mas frecuente que no sea OK
  const sorted = Object.entries(conteoPost)
    .filter(([k]) => k !== POSTURA_OK)
    .sort(([, a], [, b]) => b - a);
  const peorLabel = sorted.length > 0
    ? (POSTURE_LABELS[sorted[0][0]] || sorted[0][0])
    : "Ninguna";

  // Llenar datos
  const el = id => document.getElementById(id);
  const durMin = Math.floor(durS / 60);
  const durSec = durS % 60;

  if (el("res-duracion"))  el("res-duracion").textContent  = `${durMin}m ${durSec}s`;
  if (el("res-correcta"))  el("res-correcta").textContent  = `${pctOk}%`;
  if (el("res-frames"))    el("res-frames").textContent    = totalFrames;
  if (el("res-alertas"))   el("res-alertas").textContent   = alertasEnv;
  if (el("res-peor"))      el("res-peor").textContent      = peorLabel;

  // Color del porcentaje segun resultado
  const pctEl = el("res-correcta");
  if (pctEl) {
    const p = parseFloat(pctOk);
    pctEl.style.color = p >= 75 ? "var(--color-ok)"
                      : p >= 50 ? "var(--color-mid)"
                      :           "var(--color-warn)";
  }

  overlay.classList.remove("hidden");
  overlay.classList.add("visible");
}

function ocultarPantallaFinal() {
  const overlay = document.getElementById("pantalla-final");
  if (overlay) {
    overlay.classList.remove("visible");
    overlay.classList.add("hidden");
  }
}

// ── Control de camara ─────────────────────────────────────────────────────
async function iniciarDeteccion() {
  if (deteccionActiva) return;
  deteccionActiva = true;
  sesionInicio    = Date.now();
  conteoPost      = {};
  alertasEnv      = 0;
  ultimaAlerta    = {};
  tMalaInicio     = null;

  ocultarPantallaFinal();
  agregarLog("Iniciando deteccion...");

  const videoEl = document.getElementById("webcam");

  try {
    pose = new Pose({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    pose.setOptions({
      modelComplexity:        POSE_MODEL_COMPLEXITY,
      smoothLandmarks:        true,
      enableSegmentation:     false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    });
    pose.onResults(async results => {
      dibujarPose(results);
      if (results.poseLandmarks) await procesarFrame(results.poseLandmarks);
      else { mostrarEstado("Sin persona", null, 0); tickMala(false); }
    });

    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (deteccionActiva && pose) await pose.send({ image: videoEl });
      },
      width: CAMERA_WIDTH, height: CAMERA_HEIGHT,
    });
    await camera.start();

    // Espejo visual al iniciar
    aplicarEspejo();

    agregarLog("Camara iniciada");
    await dbIniciarSesion(USER_UUID, modoActivo, true);
    await enviarConexionOk();

  } catch (err) {
    agregarLog(`Error camara: ${err.message}`);
    deteccionActiva = false;
  }
}

async function detenerDeteccion() {
  if (!deteccionActiva) return;
  deteccionActiva = false;

  try { if (camera) { camera.stop(); camera = null; } } catch (e) {}
  try { if (pose)   { await pose.close(); pose = null; } } catch (e) {}

  // Quitar espejo al detener
  quitarEspejo();

  agregarLog("Deteccion detenida");

  const total  = Object.values(conteoPost).reduce((a, b) => a + b, 0) || 1;
  const pctOk  = (((conteoPost[POSTURA_OK] || 0) / total) * 100).toFixed(1);
  const durS   = Math.round((Date.now() - sesionInicio) / 1000);

  // Cerrar sesion en Supabase
  await dbCerrarSesion(total, alertasEnv, pctOk);

  // Resumen por Telegram
  await enviarResumen();

  // Mostrar pantalla de resultado
  mostrarPantallaFinal(durS, pctOk, total);
}

// ── Modos de deteccion ────────────────────────────────────────────────────
function setModo(modo) {
  modoActivo = modo;
  tipoActual = modo === "auto"            ? "frontal"
             : modo === "lateral-frontal" ? "lateral"
             : modo;
  switchCand = null; switchTS = null;
  actualizarBadgeModo();
  agregarLog(`Modo: ${modo.toUpperCase()}`);

  document.querySelectorAll(".btn-modo").forEach(b =>
    b.classList.toggle("activo", b.dataset.modo === modo)
  );

  const descEl = document.getElementById("modo-desc-text");
  if (descEl) descEl.textContent = MODE_DESCRIPTIONS[modo] || "";
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  sincronizarChatIdUI();
  actualizarDotTelegram();

  // Botones de modo
  document.querySelectorAll(".btn-modo").forEach(btn =>
    btn.addEventListener("click", () => setModo(btn.dataset.modo))
  );

  // Botones de camara
  document.getElementById("btn-iniciar")?.addEventListener("click", iniciarDeteccion);
  document.getElementById("btn-detener")?.addEventListener("click", detenerDeteccion);

  // Boton reiniciar de pantalla final
  document.getElementById("btn-reiniciar")?.addEventListener("click", () => {
    location.reload();
  });

  // Sidebar Telegram
  document.getElementById("btn-guardar-tg-sidebar")?.addEventListener("click", () => {
    const c = document.getElementById("tg-chat-id-sidebar")?.value.trim();
    if (!c) { mostrarToast("Ingresa tu Chat ID."); return; }
    guardarChatId(c);
    actualizarDotTelegram();
    mostrarToast("Chat ID guardado");
  });

  document.getElementById("btn-autodetect-sb")?.addEventListener("click", async (e) => {
    const btn  = e.target;
    const orig = btn.textContent;
    btn.textContent = "Buscando..."; btn.disabled = true;
    try {
      const chatId = await autoDetectarChatId();
      if (chatId) { guardarChatId(chatId); actualizarDotTelegram(); }
    } finally { btn.textContent = orig; btn.disabled = false; }
  });

  document.getElementById("btn-probar-tg-sidebar")?.addEventListener("click", async () => {
    const c = document.getElementById("tg-chat-id-sidebar")?.value.trim();
    if (!c) { mostrarToast("Ingresa tu Chat ID primero."); return; }
    guardarChatId(c);
    const ok = await tgSend("<b>Monitor de Posturas Web</b> — conexion de prueba exitosa");
    mostrarToast(ok ? "Mensaje enviado a Telegram" : "Error. Verifica el Chat ID.");
  });

  document.getElementById("btn-copy-botname-sb")?.addEventListener("click", () => {
    navigator.clipboard.writeText(BOT_USERNAME)
      .then(() => mostrarToast(`Copiado: ${BOT_USERNAME}`));
  });

  // Cargar modelos ONNX
  await cargarModelos();
  setModo("auto");
  agregarLog("Sistema listo. Presiona Iniciar para comenzar.");

  // Ticker de estadisticas cada segundo
  setInterval(actualizarStats, 1000);
});

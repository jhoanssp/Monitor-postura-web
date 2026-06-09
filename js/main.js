/**
 * main.js
 * Control de camara, modos de deteccion e inicializacion de la app.
 * Punto de entrada principal — depende de todos los otros modulos.
 */

// ── Estado global de sesion ────────────────────────────────────────────────
// (compartido con pose.js, telegram.js, db.js via window scope)
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
    // Generar UUID v4 simple sin dependencias
    id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem("user_uuid", id);
  }
  return id;
})();

// ── Control de camara ─────────────────────────────────────────────────────
async function iniciarDeteccion() {
  if (deteccionActiva) return;
  deteccionActiva = true;
  sesionInicio    = Date.now();
  conteoPost      = {};
  alertasEnv      = 0;
  ultimaAlerta    = {};
  tMalaInicio     = null;

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
    agregarLog("Camara iniciada");

    // Abrir sesion en Supabase
    await dbIniciarSesion(USER_UUID, modoActivo, true);

    // Notificar por Telegram
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

  agregarLog("Deteccion detenida");

  // Estadisticas finales
  const total  = Object.values(conteoPost).reduce((a, b) => a + b, 0) || 1;
  const pctOk  = (((conteoPost[POSTURA_OK] || 0) / total) * 100).toFixed(1);

  // Cerrar sesion en Supabase con duracion y estadisticas
  await dbCerrarSesion(total, alertasEnv, pctOk);

  // Resumen por Telegram
  await enviarResumen();
}

// ── Modos de deteccion ────────────────────────────────────────────────────
function setModo(modo) {
  modoActivo = modo;
  tipoActual = modo === "auto"             ? "frontal"
             : modo === "lateral-frontal"  ? "lateral"
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

  // Sidebar Telegram
  document.getElementById("btn-guardar-tg-sidebar")?.addEventListener("click", () => {
    const c = document.getElementById("tg-chat-id-sidebar")?.value.trim();
    if (!c) { mostrarToast("Ingresa tu Chat ID."); return; }
    guardarChatId(c);
    actualizarDotTelegram();
    mostrarToast("Chat ID guardado");
  });

  document.getElementById("btn-autodetect-sb")?.addEventListener("click", async (e) => {
    const btn = e.target;
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

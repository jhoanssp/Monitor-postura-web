/**
 * main.js
 * Control de camara, modos (auto, auto2, frontal, lat-front, lateral)
 * e inicializacion de la app.
 */

// ── Estado global ─────────────────────────────────────────────────────────
let modoActivo      = "auto";
let tipoActual      = "frontal";   // modelo activo dentro de auto/auto2
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

// UUID anonimo persistente
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
function aplicarEspejo() {
  ["output-canvas","webcam"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.transform = "scaleX(-1)";
  });
}
function quitarEspejo() {
  ["output-canvas","webcam"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.transform = "scaleX(1)";
  });
}

// ── Pantalla final ────────────────────────────────────────────────────────
function mostrarPantallaFinal(durS, pctOk, totalFrames) {
  const overlay = document.getElementById("pantalla-final");
  if (!overlay) return;

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

  // Stats basicos
  set("res-duracion", `${Math.floor(durS/60)}m ${durS%60}s`);
  set("res-frames",   totalFrames);
  set("res-alertas",  alertasEnv);

  // Frames correctos (TUP)
  const framesOk = conteoPost[POSTURA_OK] || 0;
  set("res-frames-ok", framesOk);

  // Desglose de todas las posturas detectadas
  const desgloseEl = document.getElementById("res-desglose-lista");
  if (desgloseEl) {
    const total = Object.values(conteoPost).reduce((a,b) => a+b, 0) || 1;
    const orden = ["TUP","TLF","TLB","TLL","TLR"];
    const filas = orden
      .filter(k => conteoPost[k])
      .map(k => {
        const n   = conteoPost[k] || 0;
        const pct = ((n / total) * 100).toFixed(1);
        const lbl = POSTURE_LABELS[k] || k;
        const color = k === POSTURA_OK ? "var(--color-ok)" : "var(--color-warn)";
        return `<div class="pf-desglose-fila">
          <span class="pf-dl-label" style="color:${color}">${lbl}</span>
          <span class="pf-dl-frames">${n} frames</span>
          <span class="pf-dl-pct">${pct}%</span>
        </div>`;
      }).join("");
    desgloseEl.innerHTML = filas || "<span style='color:var(--text-dim)'>Sin datos</span>";
  }

  // Porcentaje postura correcta con color
  const pctEl = document.getElementById("res-correcta");
  if (pctEl) {
    pctEl.textContent = `${pctOk}%`;
    const p = parseFloat(pctOk);
    pctEl.style.color = p >= 75 ? "var(--color-ok)"
                      : p >= 50 ? "var(--color-mid)"
                      :           "var(--color-warn)";
  }

  // Peor postura (la mas frecuente que no sea TUP)
  const sorted = Object.entries(conteoPost)
    .filter(([k]) => k !== POSTURA_OK)
    .sort(([,a],[,b]) => b - a);
  set("res-peor", sorted.length
    ? (POSTURE_LABELS[sorted[0][0]] || sorted[0][0])
    : "Ninguna");

  // Mostrar UUID para que el usuario lo copie al formulario
  const uuidEl = document.getElementById("pf-uuid-val");
  if (uuidEl) uuidEl.textContent = USER_UUID;

  overlay.classList.remove("hidden");
  overlay.classList.add("visible");
}
function ocultarPantallaFinal() {
  const overlay = document.getElementById("pantalla-final");
  if (overlay) { overlay.classList.remove("visible"); overlay.classList.add("hidden"); }
}

// ── Camara ────────────────────────────────────────────────────────────────
async function iniciarDeteccion() {
  if (deteccionActiva) return;
  deteccionActiva = true;
  sesionInicio    = Date.now();
  conteoPost      = {}; alertasEnv = 0; ultimaAlerta = {}; tMalaInicio = null;
  ocultarPantallaFinal();
  agregarLog("Iniciando deteccion...");

  const videoEl = document.getElementById("webcam");
  try {
    pose = new Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
    pose.setOptions({
      modelComplexity: POSE_MODEL_COMPLEXITY, smoothLandmarks: true,
      enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    pose.onResults(async results => {
      // Ignorar frames que lleguen despues de detener
      if (!deteccionActiva) return;
      dibujarPose(results);
      if (results.poseLandmarks) await procesarFrame(results.poseLandmarks);
      else { mostrarEstado("Sin persona", null, 0); tickMala(false); }
    });
    camera = new Camera(videoEl, {
      onFrame: async () => { if (deteccionActiva && pose) await pose.send({ image: videoEl }); },
      width: CAMERA_WIDTH, height: CAMERA_HEIGHT,
    });
    await camera.start();
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

  // Detener camara primero para que no envie mas frames a pose
  try { if (camera) { camera.stop(); camera = null; } } catch(e) {}

  // Esperar un tick para que el ultimo frame en vuelo termine
  await new Promise(r => setTimeout(r, 150));

  // Cerrar pose — ignorar BindingError si WebGL ya se destruyo
  if (pose) {
    try { await pose.close(); } catch(e) {
      // BindingError normal al cerrar WebGL context — no es un error critico
    }
    pose = null;
  }
  quitarEspejo();
  agregarLog("Deteccion detenida");
  const total = Object.values(conteoPost).reduce((a,b) => a+b, 0) || 1;
  const pctOk = (((conteoPost[POSTURA_OK]||0) / total) * 100).toFixed(1);
  const durS  = Math.round((Date.now() - sesionInicio) / 1000);
  await dbCerrarSesion(total, alertasEnv, pctOk);
  await enviarResumen();
  mostrarPantallaFinal(durS, pctOk, total);
}

// ── Modos ─────────────────────────────────────────────────────────────────
function setModo(modo) {
  modoActivo = modo;
  // Definir tipo inicial segun modo
  switch (modo) {
    case "auto":      tipoActual = "frontal";    break;
    case "auto2":     tipoActual = "frontal";    break;
    case "frontal":   tipoActual = "frontal";    break;
    case "lat-front": tipoActual = "lat_front"; break;
    case "lateral":   tipoActual = "lateral";    break;
  }
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

  document.querySelectorAll(".btn-modo").forEach(btn =>
    btn.addEventListener("click", () => setModo(btn.dataset.modo))
  );
  document.getElementById("btn-iniciar")?.addEventListener("click", iniciarDeteccion);
  document.getElementById("btn-detener")?.addEventListener("click", detenerDeteccion);
  document.getElementById("btn-reiniciar")?.addEventListener("click", () => location.reload());

  // Copiar UUID al portapapeles desde pantalla final
  document.getElementById("btn-copy-uuid")?.addEventListener("click", () => {
    navigator.clipboard.writeText(USER_UUID)
      .then(() => {
        const btn = document.getElementById("btn-copy-uuid");
        if (btn) { btn.textContent = "Copiado"; setTimeout(() => btn.textContent = "Copiar", 2000); }
      });
  });

  // Toggle landmarks de cara
  document.getElementById("btn-toggle-landmarks")?.addEventListener("click", (e) => {
    mostrarCaraLM = !mostrarCaraLM;
    const btn = e.target;
    if (mostrarCaraLM) {
      btn.textContent = "Cara visible";
      btn.classList.add("activo");
    } else {
      btn.textContent = "Cara oculta";
      btn.classList.remove("activo");
    }
  });

  // Sidebar Telegram
  document.getElementById("btn-guardar-tg-sidebar")?.addEventListener("click", () => {
    const c = document.getElementById("tg-chat-id-sidebar")?.value.trim();
    if (!c) { mostrarToast("Ingresa tu Chat ID."); return; }
    guardarChatId(c); actualizarDotTelegram(); mostrarToast("Chat ID guardado");
  });
  document.getElementById("btn-autodetect-sb")?.addEventListener("click", async (e) => {
    const btn = e.target, orig = btn.textContent;
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
    navigator.clipboard.writeText(BOT_USERNAME).then(() => mostrarToast(`Copiado: ${BOT_USERNAME}`));
  });

  await dbValidarConexion();
  await cargarModelos();
  setModo("auto");
  agregarLog("Sistema listo. Presiona Iniciar para comenzar.");
  setInterval(actualizarStats, 1000);
});

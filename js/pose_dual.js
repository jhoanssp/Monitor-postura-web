/**
 * pose_dual.js
 * Manejo de camara secundaria USB con modelo lat/front.
 * Procesamiento ALTERNADO (no simultaneo) para mantener rendimiento.
 *
 * Logica:
 *   - Frame par  -> camara principal (frontal)
 *   - Frame impar -> camara secundaria (lat/front)
 * Ambas comparten la misma sesion en Supabase (mismo session_id).
 * Cada frame insertado tiene su camera_view y model_used correcto.
 *
 * NOTA: el espejo de la imagen (para que coincida con la convención de
 * entrenamiento.py) ya se aplica ANTES de MediaPipe en pose.js
 * (obtenerFrameEspejado), así que aquí solo dibujamos results.image
 * directamente — ya viene espejado, no hay que volver a espejarlo.
 */

let camaraSecundariaStream   = null;
let videoSecundario          = null;
let canvasSecundario         = null;
let frameCounter_dual        = 0;
let dualModeActivo           = false;
let dispositivosPorId        = {};  // deviceId -> label

// ── Detectar camaras disponibles ──────────────────────────────────────────
async function listarCamaras() {
  try {
    // Necesitamos pedir permiso primero para obtener labels
    await navigator.mediaDevices.getUserMedia({ video: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camaras = devices.filter(d => d.kind === "videoinput");
    dispositivosPorId = {};
    camaras.forEach(d => { dispositivosPorId[d.deviceId] = d.label || `Camara ${d.deviceId.slice(0,6)}`; });
    return camaras;
  } catch(e) {
    agregarLog(`Error listando camaras: ${e.message}`);
    return [];
  }
}

// ── Poblar selector de camara secundaria ──────────────────────────────────
async function poblarSelectorCamaras() {
  const sel = document.getElementById("sel-camara-secundaria");
  if (!sel) return;

  const camaras = await listarCamaras();

  // Limpiar y agregar opcion vacia
  sel.innerHTML = '<option value="">Sin camara secundaria</option>';

  camaras.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camara ${d.deviceId.slice(0,6)}`;
    sel.appendChild(opt);
  });

  // Listener: al cambiar seleccion
  sel.addEventListener("change", async () => {
    const deviceId = sel.value;
    if (!deviceId) {
      desactivarCamaraSecundaria();
    } else {
      await activarCamaraSecundaria(deviceId);
    }
  });
}

// ── Activar camara secundaria ─────────────────────────────────────────────
async function activarCamaraSecundaria(deviceId) {
  try {
    // Detener stream anterior si existe
    if (camaraSecundariaStream) {
      camaraSecundariaStream.getTracks().forEach(t => t.stop());
    }

    camaraSecundariaStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: 640, height: 480 }
    });

    // Crear/reutilizar elemento video oculto para la camara secundaria
    videoSecundario = document.getElementById("webcam-secundario");
    if (!videoSecundario) {
      videoSecundario = document.createElement("video");
      videoSecundario.id        = "webcam-secundario";
      videoSecundario.autoplay  = true;
      videoSecundario.muted     = true;
      videoSecundario.playsInline = true;
      videoSecundario.style.display = "none";
      document.body.appendChild(videoSecundario);
    }
    videoSecundario.srcObject = camaraSecundariaStream;
    await videoSecundario.play();

    // Activar canvas PiP secundario
    canvasSecundario = document.getElementById("canvas-pip");
    if (canvasSecundario) {
      canvasSecundario.classList.remove("hidden");
    }

    dualModeActivo = true;
    frameCounter_dual = 0;
    agregarLog(`Camara secundaria activa: ${dispositivosPorId[deviceId] || deviceId.slice(0,8)}`);
    mostrarToast("Camara secundaria conectada — modelo lat/front activo");

  } catch(e) {
    agregarLog(`Error camara secundaria: ${e.message}`);
    mostrarToast(`No se pudo conectar la camara secundaria: ${e.message}`);
    dualModeActivo = false;
  }
}

// ── Desactivar camara secundaria ──────────────────────────────────────────
function desactivarCamaraSecundaria() {
  if (camaraSecundariaStream) {
    camaraSecundariaStream.getTracks().forEach(t => t.stop());
    camaraSecundariaStream = null;
  }
  if (videoSecundario) {
    videoSecundario.srcObject = null;
  }
  const canvasPip = document.getElementById("canvas-pip");
  if (canvasPip) canvasPip.classList.add("hidden");

  dualModeActivo = false;
  agregarLog("Camara secundaria desactivada");

  // Ocultar tarjeta de comparacion dual — ya no hay dos camaras para comparar.
  const cardDual = document.getElementById("card-estado-dual");
  if (cardDual) cardDual.classList.add("hidden");
}

// ── Comparacion en vivo: camara principal vs camara secundaria ───────────
// Llamada desde pose.js (lado="principal") y desde el onResults de
// _poseSecundario en este archivo (lado="secundaria"). Solo pinta algo si
// dualModeActivo es true; si no, mantiene la tarjeta oculta.
function actualizarComparacionDual(lado, clase, confianza, tipoUsado) {
  const card = document.getElementById("card-estado-dual");
  if (!card) return;

  if (!dualModeActivo) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const prefijo = lado === "principal" ? "dual-frontal" : "dual-latfront";
  const labelEl = document.getElementById(`${prefijo}-postura`);
  const confEl  = document.getElementById(`${prefijo}-conf`);
  if (!labelEl || !confEl) return;

  const texto = POSTURE_LABELS[clase] || clase;
  labelEl.textContent = texto;
  labelEl.style.color = clase === POSTURA_OK ? "var(--color-ok)" : "var(--color-warn)";
  confEl.textContent  = `${Math.round(confianza * 100)}% [${tipoUsado}]`;
}

// ── Dibujo PiP en canvas secundario ──────────────────────────────────────
// results.image ya viene espejado desde pose.js (obtenerFrameEspejado se
// aplica antes de mandarlo a MediaPipe), así que dibujamos tal cual —
// nada de translate/scale manual ni de "(1 - lm.x)" aquí.
function dibujarPip(results, landmarks) {
  const pip = document.getElementById("canvas-pip");
  if (!pip || !dualModeActivo) return;
  const ctx = pip.getContext("2d");
  ctx.clearRect(0, 0, pip.width, pip.height);

  if (results && results.image) {
    ctx.drawImage(results.image, 0, 0, pip.width, pip.height);
  }

  if (landmarks) {
    landmarks.forEach(lm => {
      const x = lm.x * pip.width;
      const y = lm.y * pip.height;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = "var(--color-mid)";
      ctx.fill();
    });
  }

  // Label modelo
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, pip.width, 20);
  ctx.fillStyle = "#ffab40";
  ctx.font = "bold 11px monospace";
  ctx.fillText("LAT/FRONT", 6, 14);
}

/**
 * pose.js
 * Inferencia ONNX, auto-switch mejorado (sin depender de visibility),
 * loop principal y dibujo en canvas.
 *
 * Modelos disponibles: frontal | lateral | lat_front
 * Modos:
 *   auto  = frontal <-> lat_front  (camara integrada girada)
 *   auto2 = frontal <-> lateral      (camara externa al costado)
 *
 * ── NOVEDADES ───────────────────────────────────────────────────────
 * 1) Normalización de landmarks (hombros + nariz) antes de clasificar,
 *    para que coincida con entrenamiento.py. Ver NORMALIZACION_VERSION.
 * 2) Espejo REAL a nivel de píxeles del frame antes de pasarlo a
 *    MediaPipe (ver obtenerFrameEspejado en este archivo), porque
 *    entrenamiento.py hace cv2.flip(frame, 1) ANTES de correr
 *    MediaPipe al capturar datos. Antes, el navegador solo espejaba
 *    visualmente por CSS — los landmarks reales que le llegaban a
 *    MediaPipe iban SIN espejar, en el sistema de coordenadas
 *    contrario al de entrenamiento. Esto se usa tanto para la cámara
 *    principal (aquí) como para la secundaria (pose_dual.js).
 */

let modelos         = {};
let mostrarCaraLM   = true;  // toggle landmarks faciales

// Indices de landmarks de la cara (0-10) — se ocultan con el toggle
const FACE_LM_INDICES = new Set([0,1,2,3,4,5,6,7,8,9,10]);

// Debe coincidir EXACTO con NORMALIZACION_VERSION en entrenamiento.py.
// Si no coincide con el metadata de un modelo, se avisa en el log al
// cargarlo (ver cargarModelos) — significa que el modelo fue
// entrenado con otra fórmula y hay que reentrenar o actualizar esto.
const NORMALIZACION_VERSION = "hombros_nariz_v2";

// ── Carga de modelos ONNX ─────────────────────────────────────────────────
async function cargarModelos() {
  const lista = ["frontal", "lateral", "lat_front"];
  for (const tipo of lista) {
    try {
      agregarLog(`Cargando modelo ${tipo}...`);
      const [sess_sc, sess_m, meta] = await Promise.all([
        ort.InferenceSession.create(`models/scaler_${tipo}.onnx`),
        ort.InferenceSession.create(`models/modelo_${tipo}.onnx`),
        fetch(`models/metadata_${tipo}.json`).then(r => r.json()),
      ]);
      modelos[tipo] = { sess_sc, sess_m, meta };
      agregarLog(`Modelo ${tipo} listo (${meta.clases.join(", ")})`);

      if (meta.normalizacion && meta.normalizacion !== NORMALIZACION_VERSION) {
        agregarLog(
          `AVISO: modelo ${tipo} fue entrenado con normalización "${meta.normalizacion}" ` +
          `pero pose.js usa "${NORMALIZACION_VERSION}". Reentrena el modelo o actualiza pose.js.`
        );
      } else if (!meta.normalizacion) {
        agregarLog(
          `AVISO: modelo ${tipo} no tiene campo "normalizacion" en su metadata ` +
          `(modelo viejo). Reentrénalo con la versión actual de entrenamiento.py.`
        );
      }
    } catch (err) {
      agregarLog(`Modelo ${tipo}: no disponible — ${err.message}`);
    }
  }
}

// ── Espejo real de frame (píxeles) antes de MediaPipe ──────────────────────
// entrenamiento.py hace cv2.flip(frame, 1) antes de correr MediaPipe al
// capturar datos de entrenamiento. Replicamos exactamente eso aquí, para
// que los landmarks que salgan de MediaPipe en el navegador estén en el
// MISMO sistema de coordenadas que los que se usaron para entrenar.
//
// Se reutiliza un canvas por cada fuente de video (principal/secundaria)
// para no crear uno nuevo en cada frame.
const _flipCanvases = {};

function obtenerFrameEspejado(videoEl, key = "principal") {
  const w = videoEl.videoWidth  || (typeof CAMERA_WIDTH  !== "undefined" ? CAMERA_WIDTH  : 640);
  const h = videoEl.videoHeight || (typeof CAMERA_HEIGHT !== "undefined" ? CAMERA_HEIGHT : 480);
  if (!w || !h) return videoEl; // aún no hay dimensiones — usar el video tal cual por esta vez

  let entry = _flipCanvases[key];
  if (!entry || entry.canvas.width !== w || entry.canvas.height !== h) {
    const canvas = document.createElement("canvas");
    canvas.width  = w;
    canvas.height = h;
    entry = { canvas, ctx: canvas.getContext("2d") };
    _flipCanvases[key] = entry;
  }

  const { canvas, ctx } = entry;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, w, h);
  ctx.restore();
  return canvas;
}

// ── Normalización de landmarks (debe ser IDÉNTICA a Python) ────────────────
// origen = punto medio hombros ; escala = distancia origen-nariz.
// Devuelve un array nuevo (no muta "landmarks"), o null si faltan los
// puntos necesarios para calcular la referencia (frame no usable).
function normalizarLandmarks(landmarks) {
  const iLS   = POSE_LM_INDEX["LEFT_SHOULDER"];
  const iRS   = POSE_LM_INDEX["RIGHT_SHOULDER"];
  const iNose = POSE_LM_INDEX["NOSE"];

  const ls    = landmarks[iLS];
  const rs    = landmarks[iRS];
  const nariz = landmarks[iNose];
  if (!ls || !rs || !nariz) return null;

  const origen = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
    z: (ls.z + rs.z) / 2,
  };

  let escala = Math.sqrt(
    (origen.x - nariz.x) ** 2 +
    (origen.y - nariz.y) ** 2 +
    (origen.z - nariz.z) ** 2
  );
  if (escala < 1e-6) escala = 1e-6;

  return landmarks.map((lm) => {
    if (!lm) return lm;
    return {
      ...lm,
      x: (lm.x - origen.x) / escala,
      y: (lm.y - origen.y) / escala,
      z: (lm.z - origen.z) / escala,
    };
  });
}

// ── Inferencia ────────────────────────────────────────────────────────────
async function clasificar(landmarks, tipo) {
  const m = modelos[tipo];
  if (!m) return null;
  const { sess_sc, sess_m, meta } = m;

  const landmarksNorm = normalizarLandmarks(landmarks);
  if (!landmarksNorm) return null; // faltan hombros/nariz — frame no usable

  const feat = new Float32Array(meta.feature_names.length);
  for (let i = 0; i < meta.feature_names.length; i++) {
    const parts = meta.feature_names[i].split("_");
    const coord = parts.pop();
    const lmKey = parts.join("_").toUpperCase();
    const idx   = POSE_LM_INDEX[lmKey];
    if (idx !== undefined && landmarksNorm[idx]) {
      feat[i] = landmarksNorm[idx][coord] ?? 0;
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

// ── Calculo de dx ─────────────────────────────────────────────────────────
// dx = distancia horizontal entre hombros normalizada [0..1].
// NO usa visibility — poco fiable en camaras integradas de baja calidad.
// En su lugar promedia los ultimos N frames para estabilizar.
const _dxBuffer = [];
const _DX_BUF   = 8; // frames a promediar

function calcDx(landmarks) {
  const l = landmarks[11], r = landmarks[12];
  if (!l || !r) return null;
  const dx = Math.abs(l.x - r.x);
  _dxBuffer.push(dx);
  if (_dxBuffer.length > _DX_BUF) _dxBuffer.shift();
  // Media del buffer — elimina picos de un solo frame
  return _dxBuffer.reduce((a, b) => a + b, 0) / _dxBuffer.length;
}

// ── Auto-switch mejorado ──────────────────────────────────────────────────
// Funciona para AUTO (frontal<->lat_front) y AUTO2 (frontal<->lateral).
function tipoSecundario() {
  return modoActivo === "auto2" ? "lateral" : "lat_front";
}

function evaluarSwitch(dx) {
  if (modoActivo !== "auto" && modoActivo !== "auto2") return;

  const umbrales = UMBRALES[modoActivo];
  const secundario = tipoSecundario();

  // Determinar candidato segun dx promediado
  const cand = dx > umbrales.frontal   ? "frontal"
             : dx < umbrales.lateral   ? secundario
             : null; // zona gris: no cambiar

  // Actualizar indicador en UI
  const dxEl = document.getElementById("dx-label");
  if (dxEl) {
    const zona = dx > umbrales.frontal ? "F"
               : dx < umbrales.lateral ? "L" : "?";
    dxEl.textContent = `dx: ${dx.toFixed(3)} [${zona}]`;
  }

  if (!cand || cand === tipoActual) {
    // Sin candidato nuevo o ya estamos en el correcto — resetear contador
    if (cand === tipoActual) { switchCand = null; switchTS = null; }
    return;
  }

  // Nuevo candidato
  if (switchCand !== cand) {
    switchCand = cand;
    switchTS   = Date.now();
    agregarLog(`Switch pendiente -> ${cand.toUpperCase()} (dx=${dx.toFixed(3)})`);
    return;
  }

  // Mismo candidato sostenido — confirmar si paso el delay
  if (Date.now() - switchTS >= SWITCH_DELAY_MS) {
    const anterior = tipoActual;
    tipoActual  = cand;
    switchCand  = null;
    switchTS    = null;
    _dxBuffer.length = 0; // limpiar buffer al cambiar
    agregarLog(`Switch confirmado: ${anterior.toUpperCase()} -> ${tipoActual.toUpperCase()} (dx=${dx.toFixed(3)})`);
    actualizarBadgeModo();
  }
}

function tipoEfectivo() {
  switch (modoActivo) {
    case "auto":
    case "auto2":     return tipoActual;
    case "lat-front": return "lat_front";
    case "lateral":   return "lateral";
    case "frontal":
    default:          return "frontal";
  }
}

// ── Loop principal ────────────────────────────────────────────────────────
// En modo dual, esta funcion recibe el frame del video PRINCIPAL (frontal).
// El frame secundario (lat/front) se procesa en procesarFrameSecundario().
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

  // Si hay camara secundaria activa, reportar tambien a la tarjeta de
  // comparacion en vivo (columna "PRINCIPAL"). No hace nada si esta oculta.
  if (typeof actualizarComparacionDual === "function") {
    actualizarComparacionDual("principal", clase, confianza, tipo);
  }

  // Guardar frame muestreado
  const landmarksPlano = landmarks.map((lm, i) => ({
    index: i, x: lm.x, y: lm.y, z: lm.z,
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

// ── Procesamiento camara secundaria (lat/front) ───────────────────────────
async function procesarFrameSecundario() {
  if (!dualModeActivo || !videoSecundario || videoSecundario.readyState < 2) return;

  // Usar pose_secundario si existe, sino crear uno temporal
  if (!window._poseSecundario) {
    window._poseSecundario = new Pose({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`,
    });
    window._poseSecundario.setOptions({
      modelComplexity: POSE_MODEL_COMPLEXITY,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    window._poseSecundario.onResults(async results => {
      dibujarPip(results, results.poseLandmarks);
      if (!results.poseLandmarks) return;

      // Clasificar con modelo lat/front
      let res = null;
      try { res = await clasificar(results.poseLandmarks, "lat_front"); } catch(e) { return; }
      if (!res) return;

      // Reportar a la tarjeta de comparacion en vivo (columna "LAT/FRONT (USB)")
      actualizarComparacionDual("secundaria", res.clase, res.confianza, "lat_front");

      // Guardar frame secundario en DB con camera_view = lat_front
      const lmsPlano = results.poseLandmarks.map((lm, i) => ({
        index: i, x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? null
      }));
      await dbInsertarFrame({
        userUuid:     USER_UUID,
        postureLabel: res.clase,
        confidence:   res.confianza,
        modelUsed:    "lat_front",
        cameraView:   "lat_front",
        dxShoulders:  calcDx(results.poseLandmarks),
        landmarks:    lmsPlano,
      });
    });
  }
  // Espejo real (píxeles) antes de MediaPipe — misma convención que Python.
  const frame = obtenerFrameEspejado(videoSecundario, "secundaria");
  await window._poseSecundario.send({ image: frame });
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
// results.image ya viene espejado (porque le pasamos el frame pre-espejado
// a MediaPipe), así que se dibuja tal cual — sin CSS mirror adicional en
// este canvas (ver aplicarEspejo/quitarEspejo en main.js, que ya NO
// espeja #output-canvas, solo el <video> crudo debajo).
function dibujarPose(results) {
  const canvas = document.getElementById("output-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (results.image) ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  if (!results.poseLandmarks) return;

  const tipo  = tipoEfectivo();
  const color = tipo === "frontal"   ? "var(--color-ok)"
              : tipo === "lat_front" ? "var(--color-mid)"
              :                        "var(--color-info)";

  // Filtrar landmarks segun toggle de cara
  const lms = results.poseLandmarks;

  if (mostrarCaraLM) {
    // Dibujo completo: conectores + todos los landmarks
    drawConnectors(ctx, lms, POSE_CONNECTIONS, { color: "#ffffff22", lineWidth: 2 });
    drawLandmarks(ctx, lms, { color, lineWidth: 1, radius: 4 });
  } else {
    // Dibujo sin cara: ocultar conectores y puntos de landmarks 0-10
    // Dibujar solo conectores entre puntos NO faciales
    const POSE_CONNECTIONS_BODY = POSE_CONNECTIONS.filter(
      ([a, b]) => !FACE_LM_INDICES.has(a) && !FACE_LM_INDICES.has(b)
    );
    drawConnectors(ctx, lms, POSE_CONNECTIONS_BODY, { color: "#ffffff22", lineWidth: 2 });

    // Dibujar landmarks del cuerpo manualmente (punto a punto)
    lms.forEach((lm, i) => {
      if (FACE_LM_INDICES.has(i)) return;
      const x = lm.x * canvas.width;
      const y = lm.y * canvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }
}

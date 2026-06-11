/**
 * pose.js
 * Inferencia ONNX, auto-switch mejorado (sin depender de visibility),
 * loop principal y dibujo en canvas.
 *
 * Modelos disponibles: frontal | lateral | lat_front
 * Modos:
 *   auto  = frontal <-> lat_front  (camara integrada girada)
 *   auto2 = frontal <-> lateral      (camara externa al costado)
 */

let modelos         = {};
let mostrarCaraLM   = true;  // toggle landmarks faciales

// Indices de landmarks de la cara (0-10) — se ocultan con el toggle
const FACE_LM_INDICES = new Set([0,1,2,3,4,5,6,7,8,9,10]);

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
    } catch (err) {
      agregarLog(`Modelo ${tipo}: no disponible — ${err.message}`);
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

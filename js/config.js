/**
 * config.js
 * Constantes de configuracion de la aplicacion.
 *
 * UMBRALES AJUSTADOS segun valores reales observados:
 *   - Frontal puro:    dx ~ 0.35 - 0.45
 *   - Lat/front ~30d:  dx ~ 0.25 - 0.35
 *   - Lat/front ~45d:  dx ~ 0.15 - 0.25
 *   - Lateral puro:    dx ~ 0.00 - 0.08
 *
 * AUTO  usa el punto medio entre frontal y lat/front (~30-45 grados):
 *   Switch a lat_front cuando dx < 0.28  (antes era 0.18 — demasiado bajo)
 *   Switch a frontal   cuando dx > 0.38  (antes era 0.18 — se pisaban)
 */
const UMBRALES = {
  auto:  { frontal: 0.38, lateral: 0.28 }, // frontal <-> lat_front
  auto2: { frontal: 0.15, lateral: 0.05 }, // frontal <-> lateral puro
};

const SWITCH_DELAY_MS = 2500;

// ── Alertas ───────────────────────────────────────────────────────────────
const MALA_SEG    = 20;
const COOLDOWN_MS = 120000;
const POSTURA_OK  = "TUP";

// ── Muestreo DB ───────────────────────────────────────────────────────────
const SAMPLE_EVERY_N = 30;

// ── MediaPipe ─────────────────────────────────────────────────────────────
const POSE_MODEL_COMPLEXITY = 1;
const CAMERA_WIDTH          = 640;
const CAMERA_HEIGHT         = 480;

// ── Indices MediaPipe Pose (33 landmarks) ─────────────────────────────────
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

// ── Etiquetas UI (TLL/TLR intercambiadas por espejo de camara) ────────────
const POSTURE_LABELS = {
  TUP: "Erguido",
  TLF: "Inclinado al frente",
  TLB: "Inclinado atras",
  TLL: "Inclinado derecha",
  TLR: "Inclinado izquierda",
};

const POSTURE_TIPS = {
  TLF: "Lleva la espalda al respaldo y levanta el monitor.",
  TLB: "Sientate mas erguido; evita recostarte mientras trabajas.",
  TLL: "Alinea tus hombros; no apoyes el codo derecho.",
  TLR: "Alinea tus hombros; no apoyes el codo izquierdo.",
};

// ── Descripciones de modos ────────────────────────────────────────────────
const MODE_DESCRIPTIONS = {
  auto:        "AUTO: cambia entre frontal y lat/frontal segun dx de hombros.",
  auto2:       "AUTO 2: cambia entre frontal y lateral puro. Para camara externa.",
  frontal:     "Fuerza modelo frontal. Camara mirando de frente.",
  "lat-front": "Fuerza modelo lat/frontal. Camara integrada girada de lado.",
  lateral:     "Fuerza modelo lateral puro. Camara externa al costado.",
};

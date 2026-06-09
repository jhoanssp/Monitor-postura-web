/**
 * config.js
 * Constantes de configuracion de la aplicacion.
 * Modificar aqui para ajustar umbrales sin tocar la logica.
 */

// ── Deteccion de vista ────────────────────────────────────────────────────
// dx = distancia horizontal normalizada entre hombro izquierdo y derecho.
// Vista frontal: ambos hombros visibles -> dx grande (>0.15)
// Vista lateral: solo un hombro visible -> dx pequeno (<0.06)
const UMBRAL_FRONTAL  = 0.15;   // dx > umbral  -> candidato frontal
const UMBRAL_LATERAL  = 0.06;   // dx < umbral  -> candidato lateral
                                 // (era 0.10 — demasiado alto, causaba falsos laterales)
const SWITCH_DELAY_MS = 3000;   // ms estables antes de confirmar switch
                                 // (era 10000 — demasiado lento para el usuario)

// ── Alertas de postura ────────────────────────────────────────────────────
const MALA_SEG        = 20;     // segundos antes de alertar
const COOLDOWN_MS     = 120000; // ms entre alertas del mismo tipo
const POSTURA_OK      = "TUP";

// ── Muestreo para base de datos ───────────────────────────────────────────
// Cada SAMPLE_EVERY_N frames se guarda un registro en posture_frames.
// A ~15 fps reales en el navegador, 30 frames = ~2 segundos.
const SAMPLE_EVERY_N  = 30;     // era 60 — con fps reales del navegador era ~4s

// ── MediaPipe ─────────────────────────────────────────────────────────────
const POSE_MODEL_COMPLEXITY = 1;
const CAMERA_WIDTH          = 640;
const CAMERA_HEIGHT         = 480;

// ── Indices de landmarks MediaPipe Pose (33 puntos) ───────────────────────
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

// ── Etiquetas legibles para la UI ─────────────────────────────────────────
const POSTURE_LABELS = {
  TUP: "Erguido",
  TLF: "Inclinado al frente",
  TLB: "Inclinado atras",
  TLL: "Inclinado izquierda",
  TLR: "Inclinado derecha",
};

// ── Consejos por postura ──────────────────────────────────────────────────
const POSTURE_TIPS = {
  TLF: "Lleva la espalda al respaldo y levanta el monitor.",
  TLB: "Sientate mas erguido; evita recostarte mientras trabajas.",
  TLL: "Alinea tus hombros; no apoyes el codo izquierdo.",
  TLR: "Alinea tus hombros; no apoyes el codo derecho.",
};

// ── Descripciones de modos de camara ──────────────────────────────────────
const MODE_DESCRIPTIONS = {
  auto:             "Cambia automaticamente entre frontal y lateral segun la separacion de hombros.",
  frontal:          "Fuerza el modelo frontal. Usalo cuando la camara te mira de frente.",
  lateral:          "Lateral puro: camara al costado de tu silla, en perfil.",
  "lateral-frontal":"Camara integrada girada de lado. Usa el modelo lateral aunque MediaPipe vea ambos hombros.",
};

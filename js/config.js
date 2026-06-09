/**
 * config.js
 * Constantes de configuración de la aplicación.
 * Modificar aquí para ajustar umbrales sin tocar la lógica.
 */

// Detección de vista
const UMBRAL_FRONTAL  = 0.15;   // dx > umbral -> frontal
const UMBRAL_LATERAL  = 0.10;   // dx < umbral -> lateral
const SWITCH_DELAY_MS = 10000;  // ms estables antes de cambiar modelo

// Alertas de postura
const MALA_SEG        = 20;     // segundos antes de alertar
const COOLDOWN_MS     = 120000; // ms entre alertas del mismo tipo
const POSTURA_OK      = "TUP";

// Muestreo para base de datos (cada N frames se guarda un registro)
const SAMPLE_EVERY_N  = 60;     // ~2s a 30fps

// MediaPipe
const POSE_MODEL_COMPLEXITY = 1;
const CAMERA_WIDTH          = 640;
const CAMERA_HEIGHT         = 480;

// Índices de landmarks MediaPipe Pose (33 puntos)
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

// Etiquetas legibles para la UI
const POSTURE_LABELS = {
  TUP: "Erguido",
  TLF: "Inclinado al frente",
  TLB: "Inclinado atras",
  TLL: "Inclinado izquierda",
  TLR: "Inclinado derecha",
};

// Consejos por postura
const POSTURE_TIPS = {
  TLF: "Lleva la espalda al respaldo y levanta el monitor.",
  TLB: "Sientate mas erguido; evita recostarte mientras trabajas.",
  TLL: "Alinea tus hombros; no apoyes el codo izquierdo.",
  TLR: "Alinea tus hombros; no apoyes el codo derecho.",
};

// Descripciones de modos de camara
const MODE_DESCRIPTIONS = {
  auto:             "Cambia automaticamente entre frontal y lateral segun la separacion de hombros.",
  frontal:          "Fuerza el modelo frontal. Usalo cuando la camara te mira de frente.",
  lateral:          "Lateral puro: camara al costado de tu silla, en perfil.",
  "lateral-frontal":"Camara integrada girada de lado. Usa el modelo lateral aunque MediaPipe vea ambos hombros.",
};

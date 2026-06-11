/**
 * ui.js
 * Funciones de interfaz: estado, barra, badge, log, toast, stats.
 */

function mostrarEstado(clase, esOk, confianza, dx) {
  const labelEl = document.getElementById("postura-label");
  if (labelEl) {
    labelEl.textContent = POSTURE_LABELS[clase] || clase;
    labelEl.style.color = esOk === null ? "#888"
                        : esOk          ? "var(--color-ok)"
                        :                 "var(--color-warn)";
  }
  const confEl = document.getElementById("confianza-label");
  if (confEl) confEl.textContent = confianza ? `${(confianza*100).toFixed(0)}%` : "--";
  // dx-label lo actualiza evaluarSwitch en pose.js con zona incluida
  const modoEl = document.getElementById("modo-activo-label");
  if (modoEl) {
    const tipo = tipoEfectivo ? tipoEfectivo() : tipoActual;
    modoEl.textContent = (modoActivo === "auto" || modoActivo === "auto2")
      ? `${modoActivo.toUpperCase()}: ${tipo.toUpperCase().replace("_"," ")}`
      : modoActivo.toUpperCase().replace("-"," ");
  }
}

function actualizarBarra(segs) {
  const barEl   = document.getElementById("barra-mala");
  const labelEl = document.getElementById("tiempo-mala-label");
  if (!barEl) return;
  const pct = Math.min((segs / MALA_SEG) * 100, 100);
  barEl.style.width      = `${pct}%`;
  barEl.style.background = pct < 50 ? "var(--color-ok)"
                         : pct < 85 ? "var(--color-mid)"
                         :            "var(--color-warn)";
  if (labelEl) labelEl.textContent = `${Math.round(segs)}s / ${MALA_SEG}s`;
}

function actualizarBadgeModo() {
  const el = document.getElementById("badge-modo");
  if (!el) return;
  const labels = {
    auto:        "AUTO",
    auto2:       "AUTO 2",
    frontal:     "FRONTAL",
    "lat-front": "LAT / FRONTAL",
    lateral:     "LATERAL",
  };
  el.textContent = labels[modoActivo] || modoActivo.toUpperCase();
}

function actualizarDotTelegram() {
  const dot = document.getElementById("tg-status-dot");
  if (dot) dot.className = TG.enabled ? "tg-dot tg-dot-on" : "tg-dot tg-dot-off";
}

function agregarLog(msg) {
  const el  = document.getElementById("log-box");
  const ts  = new Date().toLocaleTimeString("es-EC");
  const line = `[${ts}] ${msg}`;
  if (!el) { console.log(line); return; }
  el.textContent = line + "\n" + el.textContent.slice(0, 4000);
}

function mostrarToast(msg, duracion = 3000) {
  let t = document.getElementById("toast-global");
  if (!t) {
    t = document.createElement("div"); t.id = "toast-global";
    t.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
      "background:var(--card);border:1px solid var(--border);color:var(--text);" +
      "padding:10px 20px;border-radius:6px;font-size:13px;" +
      "font-family:var(--font-mono);z-index:99999;" +
      "box-shadow:0 4px 24px #0009;transition:opacity .3s;pointer-events:none;";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = "0"; }, duracion);
}

function actualizarStats() {
  if (!sesionInicio) return;
  const s     = Math.floor((Date.now() - sesionInicio) / 1000);
  const total = Object.values(conteoPost).reduce((a,b) => a+b, 0) || 1;
  const pctOk = (((conteoPost[POSTURA_OK]||0) / total) * 100).toFixed(0);
  const set   = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set("stat-tiempo",  `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`);
  set("stat-frames",  total);
  set("stat-alertas", alertasEnv);
  set("stat-buena",   deteccionActiva ? `${pctOk}%` : "--");
}

function sincronizarChatIdUI() {
  ["tg-chat-id-modal","tg-chat-id-sidebar"].forEach(id => {
    const el = document.getElementById(id);
    if (el && TG.CHAT_ID) el.value = TG.CHAT_ID;
  });
  document.querySelectorAll(".bot-username-display").forEach(el => {
    el.textContent = BOT_USERNAME;
  });
  const linkEl = document.getElementById("btn-open-bot");
  if (linkEl) linkEl.href = `https://t.me/${BOT_USERNAME.replace("@","")}`;
  const nameEl = document.getElementById("bot-name-display");
  if (nameEl) nameEl.textContent = BOT_USERNAME;
}

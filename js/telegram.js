/**
 * telegram.js
 * Comunicacion con la API de Telegram.
 * El token es interno (credentials.js). El usuario solo provee su Chat ID.
 */

const TG = {
  CHAT_ID: localStorage.getItem("tg_chat_id") || "",
  get enabled() { return !!this.CHAT_ID; },
};

function guardarChatId(chatId) {
  localStorage.setItem("tg_chat_id", chatId);
  TG.CHAT_ID = chatId;
}

// Envio base
async function tgSend(text) {
  if (!TG.enabled) return false;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG.CHAT_ID, text, parse_mode: "HTML" }),
      }
    );
    const d = await r.json();
    return d.ok;
  } catch (e) {
    agregarLog(`Error Telegram: ${e.message}`);
    return false;
  }
}

// Detectar Chat ID automaticamente usando el token interno.
// Rellena los campos del DOM y retorna el chatId (string) o null.
async function autoDetectarChatId() {
  agregarLog("Buscando Chat ID en Telegram...");
  try {
    // Si hay webhook activo, getUpdates devuelve vacio — eliminarlo primero
    const whr = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const whd = await whr.json();
    if (whd.ok && whd.result?.url && whd.result.url !== "") {
      agregarLog("Webhook activo detectado, eliminando temporalmente...");
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    }

    const r = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=20&offset=-20`
    );
    const d = await r.json();

    if (!d.ok) {
      mostrarToast(`Error del bot: ${d.description}`);
      agregarLog(`getUpdates error: ${d.description}`);
      return null;
    }
    if (!d.result || d.result.length === 0) {
      mostrarToast("Sin mensajes. Envia /start al bot en Telegram primero.");
      agregarLog("getUpdates: sin mensajes recientes");
      return null;
    }

    let chatId = null;
    for (let i = d.result.length - 1; i >= 0; i--) {
      const upd  = d.result[i];
      const chat = upd.message?.chat
        || upd.callback_query?.message?.chat
        || upd.channel_post?.chat
        || upd.edited_message?.chat;
      if (chat?.id) { chatId = String(chat.id); break; }
    }

    if (!chatId) {
      mostrarToast("No se detecto Chat ID. Envia un mensaje al bot e intenta de nuevo.");
      agregarLog("No se encontro chat.id en los updates");
      return null;
    }

    // Rellenar todos los campos del DOM
    ["tg-chat-id-modal", "tg-chat-id-sidebar"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = chatId;
    });

    agregarLog(`Chat ID detectado: ${chatId}`);
    mostrarToast(`Chat ID detectado: ${chatId}`);
    return chatId;

  } catch (e) {
    mostrarToast(`Error de red: ${e.message}`);
    agregarLog(`autoDetectarChatId: ${e.message}`);
    return null;
  }
}

// Notificacion al conectar
async function enviarConexionOk() {
  const msg =
    `<b>Monitor de Posturas Web — Conectado</b>\n\n` +
    `Fecha: ${new Date().toLocaleString("es-EC")}\n` +
    `Sistema listo para monitorear tu postura.\n` +
    `Recibiras alertas si mantienes mala postura por mas de ${MALA_SEG}s.`;
  const ok = await tgSend(msg);
  agregarLog(ok ? "Telegram: notificacion de conexion enviada" : "Telegram: sin Chat ID configurado (opcional)");
}

// Alerta de mala postura
async function enviarAlertaTG(clase, segs) {
  alertasEnv++;
  const msg =
    `<b>Alerta de Postura</b>\n\n` +
    `Postura: <b>${POSTURE_LABELS[clase] || clase}</b>\n` +
    `Duracion: <b>${segs} segundos</b> consecutivos\n\n` +
    `Consejo: ${POSTURE_TIPS[clase] || ""}\n\n` +
    `Hora: ${new Date().toLocaleTimeString("es-EC")}`;
  await tgSend(msg);
  agregarLog(`Telegram: alerta ${clase} (${segs}s)`);
}

// Resumen al finalizar sesion
async function enviarResumen() {
  if (!sesionInicio) return;
  const durS  = Math.round((Date.now() - sesionInicio) / 1000);
  const total = Object.values(conteoPost).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(conteoPost)
    .filter(([k]) => k !== POSTURA_OK)
    .sort(([, a], [, b]) => b - a);

  let lineas = sorted.slice(0, 3).map(([k, v]) => {
    const pct = ((v / total) * 100).toFixed(1);
    return `  - <b>${POSTURE_LABELS[k] || k}</b> — ${pct}%\n    ${POSTURE_TIPS[k] || ""}`;
  }).join("\n");
  if (!lineas) lineas = "  Sin posturas problematicas detectadas.";

  const pctOk = (((conteoPost[POSTURA_OK] || 0) / total) * 100).toFixed(1);
  const msg =
    `<b>Resumen de Sesion</b>\n\n` +
    `Duracion: <b>${Math.floor(durS / 60)}m ${durS % 60}s</b>\n` +
    `Postura correcta: <b>${pctOk}%</b>\n` +
    `Alertas enviadas: ${alertasEnv}\n\n` +
    `<b>Posturas a mejorar:</b>\n${lineas}\n\n` +
    `Fecha: ${new Date().toLocaleString("es-EC")}`;
  const ok = await tgSend(msg);
  if (ok) agregarLog("Telegram: resumen de sesion enviado");
}

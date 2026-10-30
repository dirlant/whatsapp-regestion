// Al pulsar el icono de la extensión: abre WhatsApp Web si no está abierto, o muestra/oculta el panel.
const WA = 'https://web.whatsapp.com/';

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith(WA)) {
    chrome.tabs.sendMessage(tab.id, { type: 'wam-toggle' }).catch(() => {
      // la pestaña se abrió antes de instalar la extensión: hay que recargarla
      chrome.tabs.reload(tab.id);
    });
    return;
  }
  const [wa] = await chrome.tabs.query({ url: WA + '*' });
  if (wa) {
    await chrome.tabs.update(wa.id, { active: true });
    await chrome.windows.update(wa.windowId, { focused: true });
    chrome.tabs.sendMessage(wa.id, { type: 'wam-toggle' }).catch(() => chrome.tabs.reload(wa.id));
  } else {
    chrome.tabs.create({ url: WA });
  }
});

// Validación de licencia: POST /api/licencia-whatsapp { token, numero }
const LICENSE_URL = 'https://agendaconmigo-api.vercel.app/api/licencia-whatsapp';
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || msg.type !== 'wam-license') return;
  fetch(LICENSE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: msg.token, numero: msg.numero }),
  })
    .then(async (r) => send({ status: r.status, data: await r.json().catch(() => ({})) }))
    .catch((e) => send({ error: e.message }));
  return true; // respuesta asíncrona
});

// Notificaciones del admin: POST /api/notificaciones-whatsapp { token, numero }
const NOTIFS_URL = 'https://agendaconmigo-api.vercel.app/api/notificaciones-whatsapp';
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg) return;
  if (msg.type === 'wam-notifs') {
    fetch(NOTIFS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: msg.token, numero: msg.numero, ...(msg.leida ? { leida: String(msg.leida) } : {}) }),
    })
      .then(async (r) => send({ status: r.status, data: await r.json().catch(() => ({})) }))
      .catch((e) => send({ error: e.message }));
    return true; // respuesta asíncrona
  }
  if (msg.type === 'wam-badge') {
    // número de avisos sin leer sobre el icono de la extensión
    chrome.action.setBadgeBackgroundColor({ color: msg.urgent ? '#ea0038' : '#00a884' });
    chrome.action.setBadgeText({ text: msg.count > 0 ? String(Math.min(msg.count, 99)) : '' });
  }
});

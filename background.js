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

// Corre en el mundo MAIN de la página: accede a WPP (wa-js) y responde a ui.js por postMessage.
(() => {
  const TAG = 'WAM';
  const reply = (id, ok, data) =>
    window.postMessage({ tag: TAG, dir: 'res', id, ok, data }, '*');

  const ready = () => !!(window.WPP && WPP.isFullReady);

  const toId = (x) => (x && x._serialized) || String(x);

  const actions = {
    async status() {
      return { ready: ready() };
    },

    async getData() {
      let labels = [];
      try {
        labels = (await WPP.labels.getAllLabels()).map((l) => ({ id: String(l.id), name: l.name, color: l.hexColor }));
      } catch (e) {
        try {
          labels = WPP.whatsapp.LabelStore.getModelsArray().map((l) => ({ id: String(l.id), name: l.name, color: l.hexColor }));
        } catch {}
      }
      let chats;
      try {
        chats = await WPP.chat.list({ onlyGroups: true });
      } catch (e) {
        chats = WPP.whatsapp.ChatStore.getModelsArray().filter((c) => c.isGroup);
      }
      const groups = chats.map((c) => ({
        id: toId(c.id),
        name: c.name || c.formattedTitle || toId(c.id),
        size: c.groupMetadata?.participants?.length ?? 0,
      }));
      return { labels, groups };
    },

    // Chats (individuales y grupos) que tienen una etiqueta
    async chatsByLabel({ labelId }) {
      const chats = await WPP.chat.list({ withLabels: [String(labelId)] });
      return chats.map((c) => ({
        id: toId(c.id),
        name: c.name || c.formattedTitle || c.contact?.pushname || toId(c.id).split('@')[0],
        isGroup: !!c.isGroup,
      }));
    },

    async groupParticipants({ groupId }) {
      const ps = await WPP.group.getParticipants(groupId);
      return ps.map((p) => ({
        id: toId(p.id),
        name: p.contact?.name || p.contact?.pushname || toId(p.id).split('@')[0],
      }));
    },

    async checkNumber({ phone }) {
      const r = await WPP.contact.queryExists(phone);
      return r ? { id: toId(r.wid) } : null;
    },

    async send({ to, text, typingMs }) {
      if (typingMs > 0) {
        try { await WPP.chat.markIsComposing(to, typingMs); } catch {}
        await new Promise((r) => setTimeout(r, typingMs));
      }
      const res = await WPP.chat.sendTextMessage(to, text, { createChat: true });
      try { await WPP.chat.markIsPaused(to); } catch {}
      return { id: res?.id };
    },
  };

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.tag !== TAG || m.dir !== 'req') return;
    try {
      if (m.action !== 'status' && !ready()) throw new Error('WhatsApp aún no está listo');
      reply(m.id, true, await actions[m.action](m.payload || {}));
    } catch (e) {
      reply(m.id, false, e?.message || String(e));
    }
  });
})();

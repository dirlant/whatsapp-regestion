// Corre en el mundo MAIN de la página: accede a WPP (wa-js) y responde a ui.js por postMessage.
(() => {
  const TAG = 'WAM';
  const reply = (id, ok, data) =>
    window.postMessage({ tag: TAG, dir: 'res', id, ok, data }, '*');

  const ready = () => !!(window.WPP && WPP.isFullReady);

  const toId = (x) => (x && x._serialized) || String(x);

  const actions = {
    async status() {
      const w = window.WPP;
      return {
        ready: ready(),
        hasWPP: !!w,
        isReady: !!(w && w.isReady),
        isFullReady: !!(w && w.isFullReady),
        version: (w && w.version) || '',
        injected: !!(w && w.webpack && w.webpack.isInjected),
        waVersion: (window.Debug && window.Debug.VERSION) || '',
        loaderType: (w && w.webpack && w.webpack.loaderType) || '',
        has: ['require', '__d', 'importNamespace', 'ErrorGuard', 'webpackChunkwhatsapp_web_client', '__debug']
          .filter((k) => { try { return typeof window[k] !== 'undefined'; } catch { return false; } }).join(','),
        keys: Object.keys(window).filter((k) => /webpack|^__d$|require|debug|comet|^Debug$/i.test(k)).slice(0, 12).join(','),
      };
    },

    // número de la cuenta que tiene abierta WhatsApp Web (solo dígitos)
    async me() {
      let wid = null;
      try { wid = WPP.conn.getMyUserId(); } catch {}
      if (!wid) { try { wid = WPP.whatsapp.Conn.wid; } catch {} }
      const raw = (wid && (wid.user || wid._serialized)) || '';
      return { number: String(raw).split('@')[0].replace(/\D/g, '') };
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
      return { labels };
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

    async checkNumber({ phone }) {
      const r = await WPP.contact.queryExists(phone);
      return r ? { id: toId(r.wid) } : null;
    },

    // ----- IA: chats individuales (leídos o no) con sus últimos mensajes. Se leen SIN marcarlos como leídos -----
    // scope: 'etiquetas' -> chats que tengan alguna de labelIds
    //        'nuevos'    -> conversaciones nuevas (el negocio nunca escribió) + las que la IA ya viene atendiendo ('incluir')
    // maxAgeSec: solo chats con actividad en las últimas N horas (evita contestar conversaciones viejas)
    async iaCandidates({ scope, labelIds, limit, maxAgeSec, incluir }) {
      const opts = { onlyUsers: true };
      if (scope === 'etiquetas') {
        if (!labelIds || !labelIds.length) return [];
        opts.withLabels = labelIds.map(String);
      }
      let chats = await WPP.chat.list(opts);
      const ahora = Math.floor(Date.now() / 1000);
      if (maxAgeSec) chats = chats.filter((c) => !c.t || ahora - Number(c.t) <= maxAgeSec);
      chats.sort((a, b) => Number(b.t || 0) - Number(a.t || 0)); // los más recientes primero
      chats = chats.slice(0, 300); // tope de chats examinados por revisión (con "sin límite" no se recorren miles)
      const forzados = new Set((incluir || []).map(String));
      let miNumero = '';
      try { miNumero = String(WPP.conn.getMyUserId().user || ''); } catch {}
      const out = [];
      for (const c of chats) {
        if (out.length >= (limit || 40)) break;
        const id = toId(c.id);
        if (!id.endsWith('@c.us') && !id.endsWith('@lid')) continue; // solo personas (no grupos, difusiones, estados ni canales)
        if (miNumero && id.startsWith(miNumero + '@')) continue; // el chat "Tú"
        if (c.contact && c.contact.isBlocked) continue;
        let msgs = [];
        try { msgs = await WPP.chat.getMessages(id, { count: 21 }); } catch { continue; }
        const lista = (msgs || []).map((m) => ({
          de: m.id && m.id.fromMe ? 'yo' : 'cliente',
          tipo: m.type || '',
          texto: m.type === 'chat' ? String(m.body || '') : String(m.caption || ''),
          t: Number(m.t || 0),
        })).sort((a, b) => a.t - b.t);
        const ultimo = lista[lista.length - 1];
        if (!ultimo || ultimo.de !== 'cliente') continue; // al día: el último mensaje es del negocio (no ocupa cupo)
        const nuevo = lista.length <= 20 && !lista.some((m) => m.de === 'yo'); // historial completo y sin nada enviado por el negocio
        if (scope === 'nuevos' && !nuevo && !forzados.has(id)) continue;
        out.push({
          id,
          name: c.name || c.formattedTitle || (c.contact && (c.contact.name || c.contact.pushname)) || id.split('@')[0],
          labels: (c.labels || []).map(String),
          nuevo,
          unread: Number(c.unreadCount || 0),
          msgs: lista.slice(-20),
        });
      }
      return out;
    },

    // Pone la etiqueta "add" y quita las de "remove" en un chat (solo WhatsApp Business)
    async iaSetLabel({ chatId, add, remove }) {
      const ops = [];
      if (add) ops.push({ labelId: String(add), type: 'add' });
      (remove || []).forEach((l) => ops.push({ labelId: String(l), type: 'remove' }));
      if (!ops.length) return { ok: true };
      await WPP.labels.addOrRemoveLabels(chatId, ops);
      return { ok: true };
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

  // Avisa a la interfaz cuando llega un mensaje de un cliente (no envía su contenido).
  let hooked = false;
  const hookEvents = () => {
    if (hooked) return;
    hooked = true;
    try {
      WPP.on('chat.new_message', (m) => {
        try {
          if (!m || (m.id && m.id.fromMe) || m.isNewMsg === false) return;
          window.postMessage({ tag: TAG, dir: 'evt', event: 'new_message' }, '*');
        } catch {}
      });
    } catch {}
  };
  try { if (ready()) hookEvents(); else WPP.webpack.onFullReady(hookEvents); } catch {}
  // por si la librería terminó de cargar sin avisar: se reintenta hasta engancharse
  const retry = setInterval(() => { if (hooked) clearInterval(retry); else if (ready()) { hookEvents(); clearInterval(retry); } }, 2000);

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.tag !== TAG || m.dir !== 'req') return;
    try {
      if (m.action !== 'status' && m.action !== 'me' && !ready()) throw new Error('WhatsApp aún no está listo');
      reply(m.id, true, await actions[m.action](m.payload || {}));
    } catch (e) {
      reply(m.id, false, e?.message || String(e));
    }
  });
})();

// Panel flotante dentro de WhatsApp Web. Se comunica con bridge.js (mundo MAIN) vía postMessage.
(() => {
  if (window.__wamLoaded) return;
  window.__wamLoaded = true;

  const TAG = 'WAM';
  const $ = (s, r = document) => r.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rndInt = (a, b) => Math.round(rnd(a, b));

  // ---------- puente ----------
  let seq = 0;
  const pending = new Map();
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.tag !== TAG || m.dir !== 'res') return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.data) : p.reject(new Error(m.data));
  });
  const call = (action, payload) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ tag: TAG, dir: 'req', id, action, payload }, '*');
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error('Tiempo de espera agotado'));
      }, 60000);
    });

  // ---------- configuración ----------
  const PRESETS = {
    seguro: { minDelay: 25, maxDelay: 60, batchMin: 15, batchMax: 25, pauseMin: 8, pauseMax: 15, dailyLimit: 150 },
    normal: { minDelay: 12, maxDelay: 30, batchMin: 25, batchMax: 40, pauseMin: 5, pauseMax: 10, dailyLimit: 300 },
    rapido: { minDelay: 5, maxDelay: 12, batchMin: 40, batchMax: 60, pauseMin: 3, pauseMax: 6, dailyLimit: 600 },
  };
  const DEFAULTS = {
    ...PRESETS.normal,
    typing: true,
    jitter: true,
    maxErrors: 5,
    auto: true,
    messages: ['Hola {nombre}, {¿cómo estás?|¿qué tal?}'],
  };
  let cfg = { ...DEFAULTS };
  const save = () => chrome.storage.local.set({ wamCfg: cfg });

  // ---------- estado ----------
  let recipients = []; // {id, name}
  let data = { labels: [] };
  let run = { state: 'idle', sent: 0, failed: 0, stop: false, paused: false };

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'wam-root';
  root.innerHTML = `
  <div id="wam-panel" hidden>
    <div class="wam-head"><img id="wam-logo" alt=""><div class="wam-title"><b>Envíos masivos</b><span id="wam-conn">…</span></div><button id="wam-close" title="Cerrar">×</button></div>

    <div class="wam-tabbar wam-seg">
      <button data-tab="env" class="on">Envío</button>
      <button data-tab="msg">Mensajes</button>
    </div>

    <div class="wam-body" data-body="env">
      <h4>Etiquetas</h4>
      <div class="wam-card">
        <div>
          <div id="wam-llist" class="wam-list"></div>
          <div id="wam-lblsum" class="wam-hint"></div>
        </div>
        <div class="wam-sum"><span id="wam-count">0 contactos</span>
          <span><a id="wam-refresh" title="Recargar etiquetas">Actualizar</a> · <a id="wam-clear">Vaciar</a></span></div>
        <div id="wam-rlist" class="wam-list small"></div>
      </div>

      <h4>Velocidad</h4>
      <div class="wam-card">
        <div class="wam-seg" id="wam-presets">
          <button data-p="seguro">Seguro</button><button data-p="normal">Normal</button><button data-p="rapido">Rápido</button>
        </div>
        <label class="wam-sw"><span>Tiempos aleatorios seguros</span><input type="checkbox" id="auto"><i></i></label>
        <label class="wam-sw"><span>Simular "escribiendo…"</span><input type="checkbox" id="typing"><i></i></label>
        <label class="wam-sw"><span>Variación humana</span><input type="checkbox" id="jitter"><i></i></label>
        <details>
          <summary>Ajustes avanzados</summary>
          <label>Intervalo (seg) <span><input type="number" id="minDelay" min="1"> – <input type="number" id="maxDelay" min="1"></span></label>
          <label>Pausa cada (mensajes) <span><input type="number" id="batchMin" min="1"> – <input type="number" id="batchMax" min="1"></span></label>
          <label>Duración pausa (min) <span><input type="number" id="pauseMin" min="1"> – <input type="number" id="pauseMax" min="1"></span></label>
          <label>Límite por sesión <span><input type="number" id="dailyLimit" min="1"></span></label>
          <label>Parar tras errores seguidos <span><input type="number" id="maxErrors" min="1"></span></label>
        </details>
      </div>

      <h4>Progreso</h4>
      <div class="wam-card">
        <div id="wam-stats">Listo.</div>
        <div class="wam-bar"><div id="wam-barfill"></div></div>
        <div id="wam-log"></div>
      </div>
    </div>

    <div class="wam-body" data-body="msg" hidden>
      <h4>Mensajes (hasta 10)</h4>
      <div class="wam-card">
        <div id="wam-msgs"></div>
        <button id="wam-addmsg" class="wam-btn alt">+ Agregar otro mensaje</button>
        <p class="wam-hint">Cada envío elige un mensaje al azar (hasta 10). <code>{nombre}</code> = nombre del contacto · <code>{Hola|Buenas}</code> = variante al azar</p>
        <div class="wam-prev" id="wam-prev"></div>
      </div>
    </div>

    <div class="wam-foot">
      <button id="wam-start" class="wam-btn big">Iniciar envío</button>
      <button id="wam-pause" class="wam-btn alt">Pausar</button>
      <button id="wam-stop" class="wam-btn alt danger">Detener</button>
    </div>
  </div>`;
  document.documentElement.appendChild(root);

  const panel = $('#wam-panel');
  $('#wam-logo').src = chrome.runtime.getURL('icons/icon48.png');
  $('#wam-close').onclick = () => (panel.hidden = true);
  panel.querySelectorAll('.wam-tabbar button').forEach((b) => {
    b.onclick = () => {
      panel.querySelectorAll('.wam-tabbar button').forEach((x) => x.classList.toggle('on', x === b));
      panel.querySelectorAll('[data-body]').forEach((d) => (d.hidden = d.dataset.body !== b.dataset.tab));
    };
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'wam-toggle') { panel.hidden = !panel.hidden; if (!panel.hidden) refreshData(); }
  });


  const log = (t, cls = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = `${new Date().toLocaleTimeString()} ${t}`;
    const l = $('#wam-log');
    l.prepend(d);
    while (l.children.length > 200) l.lastChild.remove();
  };

  // ---------- campos de configuración ----------
  const numFields = ['minDelay', 'maxDelay', 'batchMin', 'batchMax', 'pauseMin', 'pauseMax', 'dailyLimit', 'maxErrors'];
  const boolFields = ['auto', 'typing', 'jitter'];
  const syncFields = () => {
    numFields.forEach((k) => ($('#' + k).value = cfg[k]));
    boolFields.forEach((k) => ($('#' + k).checked = cfg[k]));
    renderMsgs();
    markPreset();
  };
  const markPreset = () => {
    panel.querySelectorAll('[data-p]').forEach((b) => {
      const p = PRESETS[b.dataset.p];
      b.classList.toggle('on', Object.keys(p).every((k) => cfg[k] === p[k]));
    });
  };
  numFields.forEach((k) => ($('#' + k).onchange = (e) => { cfg[k] = Math.max(1, +e.target.value || 1); save(); markPreset(); }));
  boolFields.forEach((k) => ($('#' + k).onchange = (e) => { cfg[k] = e.target.checked; save(); }));
  panel.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
    Object.assign(cfg, PRESETS[b.dataset.p]); save(); syncFields();
  }));

  // ---------- mensajes (hasta 10, se guardan en el almacenamiento de la extensión) ----------
  const MAX_MSGS = 10;
  const renderMsgs = () => {
    const box = $('#wam-msgs');
    box.innerHTML = '';
    cfg.messages.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'wam-msg';
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = m;
      ta.placeholder = 'Mensaje ' + (i + 1);
      ta.oninput = () => { cfg.messages[i] = ta.value; save(); renderPreview(); };
      row.appendChild(ta);
      if (cfg.messages.length > 1) {
        const x = document.createElement('a');
        x.textContent = '×';
        x.title = 'Quitar mensaje';
        x.onclick = () => { cfg.messages.splice(i, 1); save(); renderMsgs(); renderPreview(); };
        row.appendChild(x);
      }
      box.appendChild(row);
    });
    $('#wam-addmsg').textContent = `+ Agregar otro mensaje (${cfg.messages.length}/${MAX_MSGS})`;
    $('#wam-addmsg').hidden = cfg.messages.length >= MAX_MSGS;
  };
  $('#wam-addmsg').onclick = () => {
    if (cfg.messages.length >= MAX_MSGS) return;
    cfg.messages.push('');
    save();
    renderMsgs();
    box_focus();
  };
  const box_focus = () => { const t = $('#wam-msgs').querySelectorAll('textarea'); t[t.length - 1]?.focus(); };
  const activeMsgs = () => cfg.messages.map((m) => m.trim()).filter(Boolean);
  let lastMsg = -1;
  const pickMsg = () => {
    const a = activeMsgs();
    if (a.length <= 1) return a[0] || '';
    let i;
    do { i = Math.floor(Math.random() * a.length); } while (i === lastMsg); // nunca el mismo dos veces seguidas
    lastMsg = i;
    return a[i];
  };

  // ---------- mensaje ----------
  const spin = (t) => {
    let prev;
    do {
      prev = t;
      t = t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g) => {
        const o = g.split('|');
        return o[Math.floor(Math.random() * o.length)];
      });
    } while (t !== prev);
    return t;
  };
  const build = (r, tpl = pickMsg()) =>
    spin(tpl)
      .replace(/\{nombre\}/gi, (r.name || '').trim())
      .replace(/ +([,!.?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  const renderPreview = () => { $('#wam-prev').textContent = build(recipients[0] || { name: 'Ana' }, activeMsgs()[0] || ''); };

  // ---------- destinatarios ----------
  // recipients = chats de las etiquetas marcadas (sin duplicados ni excluidos)
  const labelChats = new Map(); // labelId -> [{id,name}]
  const selected = new Set(); // etiquetas marcadas
  const excluded = new Set(); // quitados a mano con ×
  const rebuild = () => {
    const seen = new Set();
    recipients = [];
    const push = (r) => {
      if (seen.has(r.id) || excluded.has(r.id)) return;
      seen.add(r.id);
      recipients.push(r);
    };
    selected.forEach((id) => (labelChats.get(id) || []).forEach(push));
    renderRecipients();
  };
  const renderRecipients = () => {
    $('#wam-count').textContent = `${recipients.length} contactos`;
    const sum = [...selected].reduce((n, id) => n + (labelChats.get(id) || []).length, 0);
    $('#wam-lblsum').textContent = selected.size
      ? `${selected.size} etiqueta(s): ${sum} contactos` + (sum !== recipients.length ? ` · ${recipients.length} en total sin repetir` : '')
      : '';
    renderPreview();
    $('#wam-rlist').innerHTML = '';
    recipients.slice(0, 300).forEach((r) => {
      const d = document.createElement('div');
      d.textContent = `${r.name || ''} ${r.id.split('@')[0]}`;
      const x = document.createElement('a');
      x.textContent = '×';
      x.onclick = () => { excluded.add(r.id); rebuild(); };
      d.prepend(x);
      $('#wam-rlist').appendChild(d);
    });
    if (recipients.length > 300) $('#wam-rlist').append(`… y ${recipients.length - 300} más`);
  };
  $('#wam-clear').onclick = () => {
    selected.clear();
    excluded.clear();
    $('#wam-llist').querySelectorAll('input').forEach((i) => (i.checked = false));
    rebuild();
  };

  const setConn = (ready) => {
    $('#wam-conn').textContent = ready ? '● listo' : '○ cargando…';
    $('#wam-conn').className = ready ? 'ok' : '';
  };

  // lista de etiquetas con contador por etiqueta; al marcar/desmarcar se recalcula el total
  const renderLabels = () => {
    const el = $('#wam-llist');
    el.innerHTML = '';
    if (!data.labels.length) { el.textContent = 'No hay etiquetas (requiere WhatsApp Business).'; return; }
    data.labels.forEach((lb) => {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.value = lb.id;
      i.checked = selected.has(lb.id);
      i.onchange = () => { i.checked ? selected.add(lb.id) : selected.delete(lb.id); rebuild(); };
      const s = document.createElement('span');
      s.textContent = lb.name;
      const n = document.createElement('em');
      n.id = 'wam-n-' + lb.id;
      n.textContent = labelChats.has(lb.id) ? labelChats.get(lb.id).length : '…';
      l.append(i, s, n);
      el.appendChild(l);
    });
  };
  const loadLabelCounts = async () => {
    for (const lb of data.labels) {
      try {
        const chats = (await call('chatsByLabel', { labelId: lb.id })).filter((c) => !c.isGroup);
        labelChats.set(lb.id, chats.map((c) => ({ id: c.id, name: c.name })));
      } catch (e) {
        labelChats.set(lb.id, []);
        log(`Etiqueta ${lb.name}: ${e.message}`, 'err');
      }
      const n = document.getElementById('wam-n-' + lb.id);
      if (n) n.textContent = labelChats.get(lb.id).length;
      if (selected.has(lb.id)) rebuild();
    }
  };
  const refreshData = async () => {
    try {
      const st = await call('status');
      setConn(st.ready);
      if (!st.ready) return;
      data = await call('getData');
      labelChats.clear();
      renderLabels();
      loadLabelCounts();
    } catch (e) {
      log('Error leyendo datos: ' + e.message, 'err');
      $('#wam-llist').textContent = 'Error: ' + e.message;
    }
  };
  $('#wam-refresh').onclick = refreshData;

  // ---------- envío ----------
  const fmt = (s) => { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

  let statsPrefix = '';
  const setStats = (extra = '') => {
    const total = recipients.length;
    $('#wam-stats').textContent = `${statsPrefix}Enviados ${run.sent} · Fallidos ${run.failed} · Total ${total}${extra ? ' — ' + extra : ''}`;
    $('#wam-barfill').style.width = total ? ((run.sent + run.failed) / total) * 100 + '%' : '0%';
  };

  // espera interrumpible; devuelve false si se detuvo
  const wait = async (sec, label) => {
    const end = Date.now() + sec * 1000;
    while (Date.now() < end) {
      if (run.stop) return false;
      if (run.paused) { setStats('Pausado'); await sleep(500); continue; }
      setStats(`${label} ${fmt((end - Date.now()) / 1000)}`);
      await sleep(250);
    }
    return true;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  const SAFE_MIN = 8; // segundos: nunca menos de esto en modo seguro
  const nextDelay = () => {
    if (cfg.auto) {
      // distribución log-normal alrededor del punto medio del rango (como un humano: muchos tiempos
      // cercanos al centro y algunos largos), con piso seguro y cansancio gradual
      const lo = Math.max(SAFE_MIN, cfg.minDelay);
      const hi = Math.max(lo * 1.5, cfg.maxDelay);
      const median = Math.sqrt(lo * hi);
      const fatigue = 1 + Math.min(0.3, run.sent * 0.004);
      let d = median * Math.exp(0.45 * gauss()) * fatigue;
      if (cfg.jitter && Math.random() < 0.1) d *= rnd(1.5, 2.2);
      return Math.min(hi * 2.5, Math.max(lo, d));
    }
    let d = rnd(cfg.minDelay, Math.max(cfg.minDelay, cfg.maxDelay));
    if (cfg.jitter && Math.random() < 0.12) d *= rnd(1.5, 2.5);
    return d;
  };
  const typingMs = (txt) => (cfg.typing ? Math.min(7000, Math.max(1200, txt.length * rnd(35, 70))) : 0);

  const start = async () => {
    if (run.state === 'running') return;
    if (!recipients.length) return log('No hay destinatarios', 'err');
    if (!activeMsgs().length) return log('Escribe al menos un mensaje', 'err');
    try { if (!(await call('status')).ready) throw 0; } catch { return log('WhatsApp aún no está listo', 'err'); }
    if (!confirm(`Se enviarán hasta ${Math.min(recipients.length, cfg.dailyLimit)} mensajes. ¿Continuar?`)) return;

    run = { state: 'running', sent: 0, failed: 0, stop: false, paused: false };
    statsPrefix = '';
    const queue = [...recipients];
    let nextPauseAt = rndInt(cfg.batchMin, cfg.batchMax);
    let sinceBreak = 0, consecErr = 0;
    log('Envío iniciado');

    for (let i = 0; i < queue.length; i++) {
      if (run.stop) break;
      if (run.sent >= cfg.dailyLimit) { log('Límite por sesión alcanzado', 'err'); break; }
      const r = queue[i];

      if (sinceBreak >= nextPauseAt) {
        const mins = rnd(cfg.pauseMin, Math.max(cfg.pauseMin, cfg.pauseMax));
        log(`Pausa de ${fmt(mins * 60)} (tras ${sinceBreak} mensajes)`);
        if (!(await wait(mins * 60, 'Pausa'))) break;
        sinceBreak = 0;
        nextPauseAt = rndInt(cfg.batchMin, cfg.batchMax);
      }
      while (run.paused && !run.stop) await sleep(500);
      if (run.stop) break;

      const text = build(r);
      const who = r.name || r.id.split('@')[0];
      try {
        let to = r.id;
        if (to.endsWith('@c.us')) {
          const ex = await call('checkNumber', { phone: to.split('@')[0] });
          if (!ex) throw new Error('No tiene WhatsApp');
          to = ex.id;
        }
        setStats(`Enviando a ${who}…`);
        await call('send', { to, text, typingMs: typingMs(text) });
        run.sent++; sinceBreak++; consecErr = 0;
        log(`✓ ${who}`, 'ok');
      } catch (e) {
        run.failed++; consecErr++;
        log(`✗ ${who}: ${e.message}`, 'err');
        if (consecErr >= cfg.maxErrors) { log(`Detenido: ${consecErr} errores seguidos`, 'err'); break; }
      }
      setStats();
      if (i < queue.length - 1 && !(await wait(nextDelay(), 'Próximo en'))) break;
    }
    run.state = 'idle';
    statsPrefix = run.stop ? 'Detenido. ' : 'Terminado. ';
    setStats();
    log(run.stop ? 'Envío detenido' : 'Envío terminado');
  };

  $('#wam-start').onclick = start;
  $('#wam-pause').onclick = () => {
    run.paused = !run.paused;
    $('#wam-pause').textContent = run.paused ? 'Reanudar' : 'Pausar';
  };
  $('#wam-stop').onclick = () => { run.stop = true; run.paused = false; $('#wam-pause').textContent = 'Pausar'; };

  // ---------- init ----------
  chrome.storage.local.get('wamCfg').then(({ wamCfg }) => {
    cfg = { ...DEFAULTS, ...(wamCfg || {}) };
    if (wamCfg && wamCfg.message && !wamCfg.messages) cfg.messages = [wamCfg.message]; // versión anterior
    if (!Array.isArray(cfg.messages) || !cfg.messages.length) cfg.messages = [''];
    cfg.messages = cfg.messages.slice(0, MAX_MSGS);
    syncFields();
    renderPreview();
  });
  const poll = setInterval(async () => {
    try {
      const st = await call('status');
      setConn(st.ready);
      if (st.ready) { clearInterval(poll); refreshData(); }
    } catch {}
  }, 2000);
})();

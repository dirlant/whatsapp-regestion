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
    message: 'Hola {nombre}, {¿cómo estás?|¿qué tal?}',
  };
  let cfg = { ...DEFAULTS };
  const save = () => chrome.storage.local.set({ wamCfg: cfg });

  // ---------- estado ----------
  let recipients = []; // {id, name}
  let data = { labels: [], groups: [] };
  let run = { state: 'idle', sent: 0, failed: 0, stop: false, paused: false };

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'wam-root';
  root.innerHTML = `
  <button id="wam-fab" title="Envíos masivos">✉</button>
  <div id="wam-panel" hidden>
    <div class="wam-head"><b>Envíos masivos</b><span id="wam-conn">…</span><button id="wam-close">×</button></div>
    <div class="wam-tabs">
      <button data-t="dest" class="on">Destinatarios</button>
      <button data-t="msg">Mensaje</button>
      <button data-t="vel">Velocidad</button>
      <button data-t="env">Enviar</button>
    </div>

    <section data-s="dest">
      <div class="wam-sub">
        <button data-d="num" class="on">Números</button>
        <button data-d="grp">Grupos</button>
        <button data-d="lbl">Etiquetas</button>
        <button id="wam-refresh" title="Recargar etiquetas y grupos">↻</button>
      </div>
      <div data-ds="num">
        <textarea id="wam-nums" rows="6" placeholder="Un contacto por línea:&#10;573001234567, Ana&#10;573009876543"></textarea>
        <button id="wam-addnums">Agregar a la lista</button>
      </div>
      <div data-ds="grp" hidden>
        <input id="wam-gfilter" placeholder="Filtrar grupos…">
        <div id="wam-glist" class="wam-list"></div>
        <button id="wam-addgrp">Enviar a los grupos marcados</button>
        <button id="wam-addgrpmem">Enviar a los miembros de los marcados</button>
      </div>
      <div data-ds="lbl" hidden>
        <div id="wam-llist" class="wam-list"></div>
        <button id="wam-addlbl">Agregar chats de las etiquetas marcadas</button>
      </div>
      <div class="wam-sum"><span id="wam-count">0 destinatarios</span>
        <button id="wam-clear">Vaciar</button></div>
      <div id="wam-rlist" class="wam-list small"></div>
    </section>

    <section data-s="msg" hidden>
      <textarea id="wam-msg" rows="9"></textarea>
      <p class="wam-hint"><code>{nombre}</code> = nombre del contacto.<br>
      <code>{Hola|Buenas|Qué tal}</code> = variante al azar (evita mensajes idénticos).</p>
      <div class="wam-prev"><b>Vista previa:</b><div id="wam-prev"></div></div>
    </section>

    <section data-s="vel" hidden>
      <div class="wam-sub">
        <button data-p="seguro">Seguro</button><button data-p="normal">Normal</button><button data-p="rapido">Rápido</button>
      </div>
      <label>Intervalo entre mensajes (seg) <span><input type="number" id="minDelay" min="1"> a <input type="number" id="maxDelay" min="1"></span></label>
      <label>Pausa cada N mensajes <span><input type="number" id="batchMin" min="1"> a <input type="number" id="batchMax" min="1"></span></label>
      <label>Duración de la pausa (min) <span><input type="number" id="pauseMin" min="1"> a <input type="number" id="pauseMax" min="1"></span></label>
      <label>Límite por sesión <span><input type="number" id="dailyLimit" min="1"></span></label>
      <label>Detener tras errores seguidos <span><input type="number" id="maxErrors" min="1"></span></label>
      <label class="chk"><input type="checkbox" id="typing"> Simular "escribiendo…" según el largo del texto</label>
      <label class="chk"><input type="checkbox" id="jitter"> Variación humana (a veces tarda más)</label>
      <p class="wam-hint">Cada intervalo es aleatorio dentro del rango; las pausas ocurren tras un número aleatorio de mensajes.</p>
    </section>

    <section data-s="env" hidden>
      <div id="wam-stats">Listo.</div>
      <div class="wam-bar"><div id="wam-barfill"></div></div>
      <div class="wam-row">
        <button id="wam-start" class="pri">Iniciar</button>
        <button id="wam-pause">Pausar</button>
        <button id="wam-stop">Detener</button>
      </div>
      <p class="wam-hint">Mantén esta pestaña abierta mientras se envía.</p>
      <div id="wam-log"></div>
    </section>
  </div>`;
  document.documentElement.appendChild(root);

  const panel = $('#wam-panel');
  $('#wam-fab').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refreshData(); };
  $('#wam-close').onclick = () => (panel.hidden = true);

  // pestañas principales
  panel.querySelectorAll('.wam-tabs button').forEach((b) => {
    b.onclick = () => {
      panel.querySelectorAll('.wam-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      panel.querySelectorAll('section').forEach((s) => (s.hidden = s.dataset.s !== b.dataset.t));
      if (b.dataset.t === 'msg') renderPreview();
    };
  });
  // sub-pestañas de destinatarios
  panel.querySelectorAll('.wam-sub button[data-d]').forEach((b) => {
    b.onclick = () => {
      panel.querySelectorAll('.wam-sub button[data-d]').forEach((x) => x.classList.toggle('on', x === b));
      panel.querySelectorAll('[data-ds]').forEach((s) => (s.hidden = s.dataset.ds !== b.dataset.d));
    };
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
  const boolFields = ['typing', 'jitter'];
  const syncFields = () => {
    numFields.forEach((k) => ($('#' + k).value = cfg[k]));
    boolFields.forEach((k) => ($('#' + k).checked = cfg[k]));
    $('#wam-msg').value = cfg.message;
  };
  numFields.forEach((k) => ($('#' + k).onchange = (e) => { cfg[k] = Math.max(1, +e.target.value || 1); save(); }));
  boolFields.forEach((k) => ($('#' + k).onchange = (e) => { cfg[k] = e.target.checked; save(); }));
  $('#wam-msg').oninput = (e) => { cfg.message = e.target.value; save(); renderPreview(); };
  panel.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
    Object.assign(cfg, PRESETS[b.dataset.p]); save(); syncFields();
  }));

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
  const build = (r) =>
    spin(cfg.message)
      .replace(/\{nombre\}/gi, (r.name || '').trim())
      .replace(/ +([,!.?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  const renderPreview = () => { $('#wam-prev').textContent = build(recipients[0] || { name: 'Ana' }); };

  // ---------- destinatarios ----------
  const addRecipients = (list) => {
    const seen = new Set(recipients.map((r) => r.id));
    let added = 0;
    for (const r of list) if (!seen.has(r.id)) { seen.add(r.id); recipients.push(r); added++; }
    renderRecipients();
    return added;
  };
  const renderRecipients = () => {
    $('#wam-count').textContent = `${recipients.length} destinatarios`;
    $('#wam-rlist').innerHTML = '';
    recipients.slice(0, 300).forEach((r, i) => {
      const d = document.createElement('div');
      d.textContent = `${r.name || ''} ${r.id.split('@')[0]}${r.id.endsWith('@g.us') ? ' (grupo)' : ''}`;
      const x = document.createElement('a');
      x.textContent = '×';
      x.onclick = () => { recipients.splice(i, 1); renderRecipients(); };
      d.prepend(x);
      $('#wam-rlist').appendChild(d);
    });
    if (recipients.length > 300) $('#wam-rlist').append(`… y ${recipients.length - 300} más`);
  };
  $('#wam-clear').onclick = () => { recipients = []; renderRecipients(); };

  $('#wam-addnums').onclick = () => {
    const lines = $('#wam-nums').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      const [n, ...rest] = l.split(/[,;\t]/);
      const digits = n.replace(/\D/g, '');
      if (digits.length < 8) { log(`Número inválido: ${l}`, 'err'); continue; }
      out.push({ id: `${digits}@c.us`, name: rest.join(' ').trim() });
    }
    log(`Agregados ${addRecipients(out)} números`);
    $('#wam-nums').value = '';
  };

  const checkList = (el, items, label) => {
    el.innerHTML = '';
    items.forEach((it) => {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.value = it.id;
      const s = document.createElement('span');
      s.textContent = label(it);
      l.append(i, s);
      el.appendChild(l);
    });
    if (!items.length) el.textContent = 'Nada encontrado.';
  };
  const checked = (el) => [...el.querySelectorAll('input:checked')].map((i) => i.value);

  const setConn = (ready) => {
    $('#wam-conn').textContent = ready ? '● listo' : '○ cargando…';
    $('#wam-conn').className = ready ? 'ok' : '';
  };
  const refreshData = async () => {
    try {
      const st = await call('status');
      setConn(st.ready);
      if (!st.ready) return;
      data = await call('getData');
      renderGroups();
      checkList($('#wam-llist'), data.labels, (l) => l.name);
      if (!data.labels.length) $('#wam-llist').textContent = 'No hay etiquetas (requiere WhatsApp Business).';
    } catch (e) { log('Error leyendo datos: ' + e.message, 'err'); }
  };
  const renderGroups = () => {
    const f = $('#wam-gfilter').value.toLowerCase();
    const keep = new Set(checked($('#wam-glist')));
    checkList($('#wam-glist'), data.groups.filter((g) => g.name.toLowerCase().includes(f)), (g) => `${g.name} (${g.size})`);
    $('#wam-glist').querySelectorAll('input').forEach((i) => (i.checked = keep.has(i.value)));
  };
  $('#wam-gfilter').oninput = renderGroups;
  $('#wam-refresh').onclick = refreshData;

  $('#wam-addgrp').onclick = () => {
    const ids = new Set(checked($('#wam-glist')));
    log(`Agregados ${addRecipients(data.groups.filter((g) => ids.has(g.id)).map((g) => ({ id: g.id, name: g.name })))} grupos`);
  };
  $('#wam-addgrpmem').onclick = async () => {
    let total = 0;
    for (const id of checked($('#wam-glist'))) {
      try { total += addRecipients(await call('groupParticipants', { groupId: id })); }
      catch (e) { log(`Grupo ${id}: ${e.message}`, 'err'); }
    }
    log(`Agregados ${total} miembros`);
  };
  $('#wam-addlbl').onclick = async () => {
    let total = 0;
    for (const id of checked($('#wam-llist'))) {
      try { total += addRecipients(await call('chatsByLabel', { labelId: id })); }
      catch (e) { log(`Etiqueta ${id}: ${e.message}`, 'err'); }
    }
    log(`Agregados ${total} chats por etiqueta`);
  };

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
  const nextDelay = () => {
    let d = rnd(cfg.minDelay, Math.max(cfg.minDelay, cfg.maxDelay));
    if (cfg.jitter && Math.random() < 0.12) d *= rnd(1.5, 2.5);
    return d;
  };
  const typingMs = (txt) => (cfg.typing ? Math.min(7000, Math.max(1200, txt.length * rnd(35, 70))) : 0);

  const start = async () => {
    if (run.state === 'running') return;
    if (!recipients.length) return log('No hay destinatarios', 'err');
    if (!cfg.message.trim()) return log('El mensaje está vacío', 'err');
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
    syncFields();
    renderPreview();
  });
  const poll = setInterval(async () => {
    try {
      const st = await call('status');
      setConn(st.ready);
      if (st.ready) clearInterval(poll);
    } catch {}
  }, 2000);
})();

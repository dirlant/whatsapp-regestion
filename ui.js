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
  // mensajes de ejemplo (regestión); la persona puede editarlos, borrarlos y crear todos los que quiera
  const EXAMPLE_MSGS = [
    'Holaa bella, pudiste revisar la propuesta que te envié?',
    'Holaa bella, se me habilitó un cupo para esta semana, sigues interesada?',
    'Holaa bella, aún sigues interesada en el servicio?',
    'Holaa bella, quedé pendiente de tu respuesta sobre la propuesta, qué te pareció?',
    'Holaa bella, estoy por abrir cupos nuevos para una nueva promoción, quisieras más información?',
    'Holaa bella, cómo estás? Quería saber si lograste ver la información que te mandé.',
    'Holaa bella, justo me quedó un espacio libre, quieres que te lo reserve?',
    'Holaa bella, qué te pareció la propuesta? Si quieres te la explico por aquí.',
    'Holaa bella, sigues pensando en el servicio o prefieres que lo dejemos para más adelante?',
    'Holaa bella, no quiero que te quedes sin tu cupo, lo retomamos esta semana?',
  ];
  const OLD_DEFAULT_MSG = 'Hola {nombre}, {¿cómo estás?|¿qué tal?}';
  const DEFAULTS = {
    ...PRESETS.normal,
    typing: true,
    jitter: true,
    maxErrors: 5,
    auto: true,
    warmup: true,
    hoursOn: true,
    hourFrom: 8,
    hourTo: 20,
    source: 'label',
    cc: '',
    messages: [...EXAMPLE_MSGS],
  };
  let cfg = { ...DEFAULTS };
  // los mensajes se guardan en el almacenamiento de la extensión y también en localStorage (copia de respaldo)
  const save = () => {
    chrome.storage.local.set({ wamCfg: cfg });
    try { localStorage.setItem('wam_messages', JSON.stringify(cfg.messages)); } catch {}
  };

  // ---------- estado ----------
  let recipients = []; // {id, name}
  let data = { labels: [] };
  let run = { state: 'idle', sent: 0, failed: 0, stop: false, paused: false };

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'wam-root';
  root.innerHTML = `
  <div id="wam-panel" hidden>
    <div class="wam-head"><img id="wam-logo" alt=""><div class="wam-title"><b>Envíos masivos</b><div class="wam-stat"><span id="wam-conn">…</span><a id="wam-licstat" title="Cambiar licencia"></a></div></div><button id="wam-close" title="Cerrar">×</button></div>

    <div id="wam-gate">
      <div class="wam-card">
        <b>Activar licencia</b>
        <input id="wam-token" placeholder="Token de licencia" autocomplete="off">
        <p class="wam-hint">Número de WhatsApp detectado: <b id="wam-num">…</b></p>
        <button id="wam-activate" class="wam-btn">Activar</button>
        <button id="wam-gate-close" class="wam-btn alt" hidden>Cerrar</button>
        <div id="wam-gate-msg" class="wam-notice">Ingresa el token de tu licencia.</div>
        <div id="wam-gate-detail" class="wam-hint"></div>
      </div>
    </div>

    <div id="wam-avbar" class="wam-avbar" hidden></div>

    <div class="wam-tabbar wam-seg">
      <button data-tab="env" class="on">Envío</button>
      <button data-tab="msg">Mensajes</button>
      <button data-tab="met">Métricas</button>
      <button data-tab="avi">Avisos<b id="wam-avibadge" class="wam-badge" hidden></b></button>
    </div>

    <div class="wam-body" data-body="env">
      <div id="wam-resume" class="wam-card wam-resume" hidden>
        <b>Envío pendiente</b>
        <div id="wam-resume-info" class="wam-hint"></div>
        <div class="wam-row">
          <button id="wam-resume-go" class="wam-btn">Reanudar</button>
          <button id="wam-resume-drop" class="wam-btn alt danger">Descartar</button>
        </div>
      </div>
      <h4>Destinatarios</h4>
      <div class="wam-card">
        <div class="wam-seg" id="wam-source">
          <button data-src="label" class="on">Por etiqueta</button>
          <button data-src="excel">Por Excel</button>
        </div>
        <div id="wam-pane-label">
          <div id="wam-llist" class="wam-list"></div>
          <div id="wam-lblsum" class="wam-hint"></div>
        </div>
        <div id="wam-pane-excel" hidden>
          <p class="wam-hint">Sube un Excel (.xlsx, .xls o .csv) con una columna de nombre y otra de teléfono. Las demás columnas sirven para personalizar el mensaje.</p>
          <button id="wam-tpl" class="wam-btn alt">Descargar formato de ejemplo</button>
          <label class="wam-file"><input type="file" id="wam-file" accept=".xlsx,.xls,.csv"><span id="wam-filename">Elegir archivo…</span></label>
          <div id="wam-xmap" hidden>
            <label>Columna de nombre <select id="wam-colname"></select></label>
            <label>Columna de teléfono <select id="wam-colphone"></select></label>
            <label>Código de país (opcional) <input type="number" id="wam-cc" placeholder="56"></label>
            <div id="wam-xsum" class="wam-notice"></div>
          </div>
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
        <label class="wam-sw"><span>Calentamiento gradual (modo seguro)</span><input type="checkbox" id="warmup"><i></i></label>
        <label class="wam-sw"><span>Solo en horario (modo seguro)</span><input type="checkbox" id="hoursOn"><i></i></label>
        <details>
          <summary>Ajustes avanzados</summary>
          <label>Intervalo (seg) <span><input type="number" id="minDelay" min="1"> – <input type="number" id="maxDelay" min="1"></span></label>
          <label>Pausa cada (mensajes) <span><input type="number" id="batchMin" min="1"> – <input type="number" id="batchMax" min="1"></span></label>
          <label>Duración pausa (min) <span><input type="number" id="pauseMin" min="1"> – <input type="number" id="pauseMax" min="1"></span></label>
          <label>Horario permitido (hora) <span><input type="number" id="hourFrom" min="0" max="23"> – <input type="number" id="hourTo" min="1" max="24"></span></label>
          <label>Límite diario <span><input type="number" id="dailyLimit" min="1"></span></label>
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
      <h4>Mensajes</h4>
      <div class="wam-card">
        <div id="wam-msgs"></div>
        <button id="wam-addmsg" class="wam-btn alt">+ Agregar otro mensaje</button>
        <div class="wam-hint">Variables disponibles (toca una para insertarla):</div>
        <div id="wam-vars" class="wam-vars"></div>
        <button id="wam-examples" class="wam-btn alt">Cargar mensajes de ejemplo</button>
        <p class="wam-hint">Crea todos los mensajes que quieras: cada envío elige uno al azar. <code>{Hola|Buenas}</code> = variante al azar.</p>
        <div class="wam-prev" id="wam-prev"></div>
      </div>
    </div>

    <div class="wam-body" data-body="avi" hidden>
      <h4>Avisos</h4>
      <div class="wam-card">
        <div class="wam-sum"><span id="wam-avinfo">Sin avisos.</span>
          <span><a id="wam-avrefresh">Actualizar</a> · <a id="wam-avreadall">Marcar todos como leídos</a></span></div>
        <div id="wam-avlist"></div>
      </div>
    </div>

    <div class="wam-body" data-body="met" hidden>
      <h4>Resumen</h4>
      <div class="wam-card">
        <div class="wam-kpis">
          <div><b id="k-today">0</b><span>Enviados hoy</span></div>
          <div><b id="k-total">0</b><span>Enviados en total</span></div>
          <div><b id="k-fail">0</b><span>Fallidos</span></div>
          <div><b id="k-rate">–</b><span>Éxito</span></div>
          <div><b id="k-gap">–</b><span>Intervalo típico</span></div>
          <div><b id="k-hour">–</b><span>Por hora</span></div>
        </div>
      </div>
      <h4>Últimos 7 días</h4>
      <div class="wam-card"><div id="wam-chart" class="wam-chart"></div></div>
      <h4>Uso por mensaje</h4>
      <div class="wam-card" id="wam-bymsg"></div>
      <h4>Historial reciente</h4>
      <div class="wam-card">
        <div id="wam-hist" class="wam-list small"></div>
        <button id="wam-clearmet" class="wam-btn alt danger">Borrar métricas</button>
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
      if (b.dataset.tab === 'met') renderMetrics();
      if (b.dataset.tab === 'avi') { renderNotifs(); fetchNotifs(true); }
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
  const numFields = ['minDelay', 'maxDelay', 'batchMin', 'batchMax', 'pauseMin', 'pauseMax', 'dailyLimit', 'maxErrors', 'hourFrom', 'hourTo'];
  const boolFields = ['auto', 'typing', 'jitter', 'warmup', 'hoursOn'];
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
  numFields.forEach((k) => ($('#' + k).onchange = (e) => {
    const isHour = k === 'hourFrom' || k === 'hourTo';
    cfg[k] = isHour ? Math.min(k === 'hourFrom' ? 23 : 24, Math.max(k === 'hourFrom' ? 0 : 1, +e.target.value || 0)) : Math.max(1, +e.target.value || 1);
    e.target.value = cfg[k];
    save(); markPreset();
  }));
  boolFields.forEach((k) => ($('#' + k).onchange = (e) => { cfg[k] = e.target.checked; save(); }));
  panel.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => {
    Object.assign(cfg, PRESETS[b.dataset.p]); save(); syncFields();
  }));

  // ---------- mensajes (sin límite; se guardan en el almacenamiento de la extensión y en localStorage) ----------
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
      ta.onfocus = () => { lastTa = ta; };
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
    $('#wam-addmsg').textContent = `+ Agregar otro mensaje (${cfg.messages.length})`;
  };
  $('#wam-examples').onclick = () => {
    if (activeMsgs().length && !confirm('Se reemplazarán tus mensajes actuales por los 10 de ejemplo. ¿Continuar?')) return;
    cfg.messages = [...EXAMPLE_MSGS];
    save(); renderMsgs(); renderPreview();
  };
  $('#wam-addmsg').onclick = () => {
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
    if (a.length <= 1) { lastMsg = 0; return a[0] || ''; }
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
  // nombre de variable: sin tildes, minúsculas y con _ (ej. "Fecha de pago" -> fecha_de_pago)
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  // primero se reemplazan las variables y luego las variantes {a|b}
  const build = (r, tpl = pickMsg()) => {
    const vars = r.vars || { nombre: r.name || '' };
    const t = tpl.replace(/\{([^{}|]+)\}/g, (m, k) => {
      const key = norm(k);
      return key in vars ? String(vars[key]).replace(/[{}|]/g, '') : m;
    });
    return spin(t)
      .replace(/ +([,!.?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  };
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
    // un solo origen a la vez: etiquetas o Excel, nunca los dos
    if (cfg.source === 'excel') buildExcel().forEach(push);
    else selected.forEach((id) => (labelChats.get(id) || []).forEach(push));
    renderRecipients();
  };

  // ----- origen Excel -----
  let excel = { headers: [], rows: [], rawRows: [], colName: -1, colPhone: -1, stats: null };
  const buildExcel = () => {
    const out = [], seen = new Set();
    let invalid = 0, dup = 0;
    if (excel.colPhone < 0) { excel.stats = null; return out; }
    for (let n = 0; n < excel.rows.length; n++) {
      const row = excel.rows[n];
      const rawPhone = excel.rawRows[n] ? excel.rawRows[n][excel.colPhone] : row[excel.colPhone];
      let digits = (typeof rawPhone === 'number' ? String(Math.round(rawPhone)) : String(rawPhone ?? '')).replace(/\D/g, '').replace(/^0+/, '');
      const cc = String(cfg.cc || '');
      if (cc && digits && digits.length <= 10 && !digits.startsWith(cc)) digits = cc + digits; // número local sin código de país
      if (digits.length < 8 || digits.length > 15) { invalid++; continue; }
      if (seen.has(digits)) { dup++; continue; }
      seen.add(digits);
      const vars = {};
      excel.headers.forEach((h, i) => { const k = norm(h); if (k) vars[k] = String(row[i] ?? '').trim(); });
      vars.nombre = excel.colName >= 0 ? String(row[excel.colName] ?? '').trim() : '';
      vars.telefono = digits;
      const pk = norm(excel.headers[excel.colPhone] || '');
      if (pk) vars[pk] = digits; // {celular}, {whatsapp}… también dan el número limpio
      out.push({ id: digits + '@c.us', name: vars.nombre, vars });
    }
    excel.stats = { invalid, dup, total: excel.rows.length, valid: out.length };
    return out;
  };
  // variables que se pueden usar en el mensaje según el origen elegido
  const varKeys = () => {
    if (cfg.source !== 'excel') return ['nombre'];
    return [...new Set(['nombre', 'telefono', ...excel.headers.map(norm).filter(Boolean)])];
  };

  const renderRecipients = () => {
    $('#wam-count').textContent = `${recipients.length} contactos`;
    const sum = [...selected].reduce((n, id) => n + (labelChats.get(id) || []).length, 0);
    $('#wam-lblsum').textContent = selected.size
      ? `${selected.size} etiqueta(s): ${sum} contactos` + (sum !== recipients.length ? ` · ${recipients.length} en total sin repetir` : '')
      : '';
    const st = excel.stats;
    $('#wam-xsum').textContent = st
      ? `${st.valid} válidos de ${st.total} filas` + (st.invalid ? ` · ${st.invalid} sin teléfono válido` : '') + (st.dup ? ` · ${st.dup} repetidos` : '')
      : '';
    renderVars();
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
  const clearExcel = () => {
    excel = { headers: [], rows: [], rawRows: [], colName: -1, colPhone: -1, stats: null };
    $('#wam-file').value = '';
    $('#wam-filename').textContent = 'Elegir archivo…';
    $('#wam-xmap').hidden = true;
  };
  const clearLabels = () => {
    selected.clear();
    $('#wam-llist').querySelectorAll('input').forEach((i) => (i.checked = false));
  };
  $('#wam-clear').onclick = () => {
    excluded.clear();
    clearLabels();
    clearExcel();
    rebuild();
  };

  // selector de origen: Por etiqueta / Por Excel (excluyentes)
  const applySource = () => {
    const ex = cfg.source === 'excel';
    panel.querySelectorAll('#wam-source button').forEach((b) => b.classList.toggle('on', (b.dataset.src === 'excel') === ex));
    $('#wam-pane-label').hidden = ex;
    $('#wam-pane-excel').hidden = !ex;
    $('#wam-refresh').hidden = ex;
    rebuild();
  };
  panel.querySelectorAll('#wam-source button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.src === cfg.source) return;
      if ((selected.size || excel.rows.length) && !confirm('Cambiar de origen quitará la selección actual. ¿Continuar?')) return;
      excluded.clear();
      clearLabels();
      clearExcel();
      cfg.source = b.dataset.src;
      save();
      applySource();
    };
  });

  // lectura del archivo
  const guessCol = (headers, re) => headers.findIndex((h) => re.test(norm(h)));
  const loadFile = (file) => {
    const reader = new FileReader();
    reader.onerror = () => log('No se pudo leer el archivo', 'err');
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // texto tal como se ve en Excel (fechas y montos con formato) + valores numéricos reales
        // (para que un teléfono guardado como número no se convierta en 5.9E+11)
        const fmtAll = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        const rawAll = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, rawNumbers: true, defval: '' });
        const keep = fmtAll.map((r, i) => (r.some((c) => String(c).trim() !== '') ? i : -1)).filter((i) => i >= 0);
        if (keep.length < 2) throw new Error('El archivo no tiene filas de datos');
        const aoa = keep.map((i) => fmtAll[i]);
        const raw = keep.map((i) => rawAll[i]);
        const headers = aoa[0].map((h) => String(h).trim());
        const rows = aoa.slice(1, 5001);
        const rawRows = raw.slice(1, 5001);
        let colName = guessCol(headers, /(^|_)(nombre|name|cliente|contacto)(_|$)/);
        let colPhone = guessCol(headers, /(tel|cel|whats|phone|movil|numero|fono)/);
        if (colPhone < 0) { // la columna con más celdas que parecen teléfonos
          let best = 0;
          headers.forEach((_, i) => {
            const n = rows.filter((r) => String(r[i]).replace(/\D/g, '').length >= 8).length;
            if (n > best) { best = n; colPhone = i; }
          });
        }
        if (colName < 0) colName = headers.findIndex((_, i) => i !== colPhone);
        excluded.clear();
        excel = { headers, rows, rawRows, colName, colPhone, stats: null };
        const opts = (sel, withNone) => {
          sel.innerHTML = '';
          if (withNone) sel.add(new Option('(ninguna)', -1));
          headers.forEach((h, i) => sel.add(new Option(h || 'Columna ' + (i + 1), i)));
        };
        opts($('#wam-colname'), true);
        opts($('#wam-colphone'), false);
        $('#wam-colname').value = colName;
        $('#wam-colphone').value = colPhone;
        $('#wam-cc').value = cfg.cc || '';
        $('#wam-filename').textContent = file.name;
        $('#wam-xmap').hidden = false;
        if (colPhone < 0) log('No se encontró la columna de teléfono: elígela manualmente', 'err');
        log(`Excel cargado: ${rows.length} filas`);
        rebuild();
      } catch (e) {
        clearExcel();
        log('Excel no válido: ' + e.message, 'err');
        rebuild();
      }
    };
    reader.readAsArrayBuffer(file);
  };
  $('#wam-file').onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
  $('#wam-colname').onchange = (e) => { excel.colName = +e.target.value; rebuild(); };
  $('#wam-colphone').onchange = (e) => { excel.colPhone = +e.target.value; rebuild(); };
  $('#wam-cc').onchange = (e) => { cfg.cc = e.target.value.replace(/\D/g, ''); e.target.value = cfg.cc; save(); rebuild(); };

  // formato de ejemplo descargable
  $('#wam-tpl').onclick = () => {
    const rows = [
      ['Nombre', 'Telefono', 'Empresa', 'Monto', 'Fecha'],
      ['Ana Pérez', '56912345678', 'Panadería Sol', '25.000', '30/11/2026'],
      ['Luis Gómez', '56987654321', 'Ferretería Norte', '48.500', '02/12/2026'],
      ['María Rojas', '595991234567', 'Café Central', '12.000', '05/12/2026'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 14 }];
    for (let r = 1; r < rows.length; r++) { const c = ws[XLSX.utils.encode_cell({ r, c: 1 })]; c.t = 's'; c.z = '@'; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
    XLSX.writeFile(wb, 'formato-contactos.xlsx');
  };

  // variables del mensaje (chips); se insertan donde está el cursor
  let lastTa = null;
  const renderVars = () => {
    const box = $('#wam-vars');
    box.innerHTML = '';
    varKeys().forEach((k) => {
      const c = document.createElement('a');
      c.textContent = '{' + k + '}';
      c.onmousedown = (e) => e.preventDefault();
      c.onclick = () => {
        const ta = lastTa && document.contains(lastTa) ? lastTa : $('#wam-msgs textarea');
        if (!ta) return;
        ta.setRangeText('{' + k + '}', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      };
      box.appendChild(c);
    });
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

  // ---------- métricas (historial persistente en el almacenamiento de la extensión) ----------
  const MAX_LOG = 5000;
  let sendLog = []; // {t, ok, id, name, m (índice de mensaje), err}
  const record = (e) => {
    sendLog.push({ t: Date.now(), ...e });
    if (sendLog.length > MAX_LOG) sendLog = sendLog.slice(-MAX_LOG);
    chrome.storage.local.set({ wamLog: sendLog });
    if (!$('[data-body="met"]').hidden) renderMetrics();
  };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const renderMetrics = () => {
    const oks = sendLog.filter((e) => e.ok);
    const fails = sendLog.length - oks.length;
    const today = dayKey(Date.now());
    $('#k-today').textContent = oks.filter((e) => dayKey(e.t) === today).length;
    $('#k-total').textContent = oks.length;
    $('#k-fail').textContent = fails;
    $('#k-rate').textContent = sendLog.length ? Math.round((oks.length / sendLog.length) * 100) + '%' : '–';

    // intervalo típico (mediana) y ritmo por hora, solo entre envíos seguidos
    const gaps = [];
    for (let i = 1; i < oks.length; i++) {
      const g = (oks[i].t - oks[i - 1].t) / 1000;
      if (g < 300) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    $('#k-gap').textContent = gaps.length ? fmt(gaps[Math.floor(gaps.length / 2)]) : '–';
    const span = gaps.reduce((a, b) => a + b, 0);
    $('#k-hour').textContent = span > 60 ? Math.round((gaps.length / span) * 3600) : '–';

    // últimos 7 días
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
    const counts = days.map((d) => oks.filter((e) => dayKey(e.t) === dayKey(d)).length);
    const max = Math.max(1, ...counts);
    const chart = $('#wam-chart');
    chart.innerHTML = '';
    days.forEach((d, i) => {
      const col = document.createElement('div');
      col.innerHTML = '<em></em><i></i><span></span>';
      col.querySelector('em').textContent = counts[i] || '';
      col.querySelector('i').style.height = (counts[i] / max) * 80 + '%';
      col.querySelector('span').textContent = d.toLocaleDateString('es', { weekday: 'short' }).slice(0, 3);
      chart.appendChild(col);
    });

    // uso por mensaje
    const by = {};
    oks.forEach((e) => { if (e.m != null) by[e.m] = (by[e.m] || 0) + 1; });
    const box = $('#wam-bymsg');
    box.innerHTML = '';
    const keys = Object.keys(by).sort((a, b) => a - b);
    if (!keys.length) box.textContent = 'Aún no hay envíos.';
    const bmax = Math.max(1, ...Object.values(by));
    keys.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'wam-bar-row';
      row.innerHTML = '<span></span><div class="wam-bar"><div></div></div><em></em>';
      row.querySelector('span').textContent = 'Mensaje ' + (+k + 1);
      row.querySelector('.wam-bar > div').style.width = (by[k] / bmax) * 100 + '%';
      row.querySelector('em').textContent = by[k];
      box.appendChild(row);
    });

    // historial
    const hist = $('#wam-hist');
    hist.innerHTML = '';
    sendLog.slice(-40).reverse().forEach((e) => {
      const d = document.createElement('div');
      const when = new Date(e.t).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      d.textContent = (e.ok ? '✓ ' : '✗ ') + when + ' · ' + (e.name || String(e.id).split('@')[0]) + (e.ok ? '' : ' · ' + e.err);
      if (!e.ok) d.style.color = 'var(--err)';
      hist.appendChild(d);
    });
    if (!sendLog.length) hist.textContent = 'Sin historial.';
  };
  $('#wam-clearmet').onclick = () => {
    if (!confirm('¿Borrar todo el historial de métricas?')) return;
    sendLog = [];
    chrome.storage.local.set({ wamLog: [] });
    renderMetrics();
  };

  // ---------- licencia ----------
  const LIC_REASONS = {
    token_no_encontrado: 'El token no existe. Revísalo.',
    numero_no_coincide: 'Este token pertenece a otro número de WhatsApp.',
    licencia_revocada: 'La licencia fue revocada.',
    licencia_vencida: 'La licencia está vencida.',
  };
  const GRACE_MS = 24 * 3600 * 1000; // sin conexión: se tolera hasta 24 h desde la última verificación correcta
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let lic = { token: '', valid: false, until: '', number: '', checkedAt: 0, reason: '', detail: '', checking: false };
  let gateOpen = false;
  const saveLic = () => chrome.storage.local.set({ wamLic: { token: lic.token, valid: lic.valid, until: lic.until, number: lic.number, checkedAt: lic.checkedAt } });

  const renderLic = () => {
    const st = $('#wam-licstat');
    st.textContent = !lic.token ? 'Sin licencia' : lic.checking ? 'Verificando…' : lic.valid ? 'Licencia hasta ' + lic.until : 'Licencia no válida';
    st.className = lic.valid ? 'ok' : 'bad';
    $('#wam-num').textContent = lic.number ? '+' + lic.number : 'no disponible aún';
    if (!$('#wam-token').value) $('#wam-token').value = lic.token;
    $('#wam-gate-msg').textContent = lic.checking ? 'Verificando licencia…' : lic.reason || 'Ingresa el token de tu licencia.';
    $('#wam-gate-msg').className = 'wam-notice' + (lic.reason && !lic.checking ? ' bad' : '');
    $('#wam-gate-detail').textContent = lic.detail || '';
    $('#wam-gate').hidden = lic.valid && !gateOpen;
    $('#wam-gate-close').hidden = !lic.valid;
    $('#wam-start').disabled = !lic.valid;
  };
  $('#wam-licstat').onclick = () => { gateOpen = true; renderLic(); };
  $('#wam-gate-close').onclick = () => { gateOpen = false; renderLic(); };

  const fetchLicense = (token, numero) =>
    new Promise((resolve) => chrome.runtime.sendMessage({ type: 'wam-license', token, numero }, (r) => resolve(r || { error: chrome.runtime.lastError?.message || 'sin respuesta' })));

  // Número de la cuenta abierta: primero de los datos de sesión de WhatsApp Web, luego de WPP
  const myNumber = async () => {
    for (const k of ['last-wid-md', 'last-wid']) {
      try {
        const raw = String(localStorage.getItem(k) || '').replace(/"/g, '');
        const n = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (n.length >= 8) return n;
      } catch {}
    }
    try { return (await call('me')).number || ''; } catch { return ''; }
  };

  // Verifica la licencia contra la API. Devuelve true si se puede usar la extensión.
  const checkLicense = async () => {
    if (!lic.token) { lic.valid = false; lic.reason = ''; renderLic(); return false; }
    lic.checking = true; renderLic();
    try {
      const me = { number: await myNumber() };
      if (!me.number) { lic.reason = 'No se pudo leer tu número de WhatsApp. Inicia sesión en WhatsApp Web y recarga la página.'; lic.valid = false; return false; }
      lic.number = me.number;
      fetchNotifs(); // avisos del administrador (no bloquea la validación)
      const r = await fetchLicense(lic.token, lic.number);
      lic.detail = r.error
        ? 'Error de conexión: ' + r.error
        : 'Respuesta del servidor: HTTP ' + r.status + (r.data && r.data.motivo ? ' · ' + r.data.motivo : '') + (r.data && r.data.valida ? ' · válida' : '');
      if (r.status === 200 && r.data) {
        if (r.data.valida) {
          lic.valid = true; lic.until = r.data.fecha_vencimiento || ''; lic.reason = ''; lic.checkedAt = Date.now();
        } else {
          lic.valid = false; lic.reason = LIC_REASONS[r.data.motivo] || 'Licencia no válida.';
        }
      } else if (r.status === 400) {
        lic.valid = false; lic.reason = 'Falta el token o el número.';
      } else {
        // 500 o sin conexión: se tolera si hubo una verificación correcta reciente y no ha vencido
        const recent = lic.checkedAt && Date.now() - lic.checkedAt < GRACE_MS && (!lic.until || lic.until >= todayStr());
        lic.valid = !!recent;
        lic.reason = recent ? '' : 'No se pudo verificar la licencia. Revisa tu conexión.';
        if (recent) log('Sin conexión con el servidor de licencias: se usa la última verificación', 'err');
      }
      saveLic();
      return lic.valid;
    } finally {
      lic.checking = false;
      renderLic();
    }
  };
  $('#wam-activate').onclick = async () => {
    lic.token = $('#wam-token').value.trim();
    lic.checkedAt = 0; // un token nuevo no hereda la tolerancia sin conexión
    gateOpen = false;
    await checkLicense();
  };

  // ---------- avisos del administrador (módulo "Notificaciones Bot" del admin de Agendaconmigo) ----------
  let notifs = [];
  let readIds = new Set();
  let lastNotifFetch = 0;
  const TIPO_LABEL = { info: 'Información', aviso: 'Aviso', importante: 'Importante' };
  const saveRead = () => chrome.storage.local.set({ wamRead: [...readIds].slice(-500) });
  const unreadList = () => notifs.filter((n) => !readIds.has(n.id));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const fmtAviso = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  const renderNotifs = () => {
    const un = unreadList();
    const urgent = un.some((n) => n.tipo === 'importante');
    const badge = $('#wam-avibadge');
    badge.hidden = !un.length;
    badge.textContent = un.length;
    const bar = $('#wam-avbar');
    bar.hidden = !un.length;
    bar.className = 'wam-avbar' + (urgent ? ' urgent' : '');
    bar.textContent = '';
    if (un.length) {
      const a = document.createElement('a');
      a.textContent = 'Tienes ' + un.length + (un.length === 1 ? ' aviso sin leer' : ' avisos sin leer') + ' — Ver';
      a.onclick = () => panel.querySelector('.wam-tabbar button[data-tab="avi"]').click();
      bar.appendChild(a);
    }
    try { chrome.runtime.sendMessage({ type: 'wam-badge', count: un.length, urgent }); } catch {}

    $('#wam-avinfo').textContent = notifs.length ? notifs.length + ' aviso(s) · ' + un.length + ' sin leer' : 'Sin avisos.';
    const box = $('#wam-avlist');
    box.innerHTML = '';
    notifs.forEach((n) => {
      const card = document.createElement('div');
      card.className = 'wam-aviso ' + n.tipo + (readIds.has(n.id) ? ' read' : '');
      const h = document.createElement('b');
      h.textContent = n.titulo;
      const tag = document.createElement('em');
      tag.textContent = TIPO_LABEL[n.tipo] || '';
      const p = document.createElement('p');
      p.textContent = n.mensaje;
      const meta = document.createElement('div');
      meta.className = 'wam-hint';
      meta.textContent = fmtAviso(n.fecha);
      card.append(h, tag, p, meta);
      const url = safeUrl(n.link);
      if (url) {
        const l = document.createElement('a');
        l.href = url; l.target = '_blank'; l.rel = 'noopener noreferrer'; l.textContent = 'Abrir enlace';
        card.appendChild(l);
      }
      if (!readIds.has(n.id)) {
        const r = document.createElement('a');
        r.className = 'wam-markread';
        r.textContent = 'Marcar como leído';
        r.onclick = () => { readIds.add(n.id); saveRead(); renderNotifs(); };
        card.appendChild(r);
      }
      box.appendChild(card);
    });
  };

  // Pide los avisos al backend (por el service worker). Si falla, se conservan los últimos guardados.
  const fetchNotifs = async (force = false) => {
    if (!lic.token || !lic.number) return;
    if (!force && Date.now() - lastNotifFetch < 60000) return;
    lastNotifFetch = Date.now();
    const r = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: 'wam-notifs', token: lic.token, numero: lic.number }, (x) => resolve(x || { error: chrome.runtime.lastError?.message || 'sin respuesta' })));
    if (r.status === 200 && r.data && Array.isArray(r.data.notificaciones)) {
      notifs = r.data.notificaciones
        .filter((n) => n && n.id && n.titulo)
        .map((n) => ({ ...n, tipo: TIPO_LABEL[n.tipo] ? n.tipo : 'info' }))
        .slice(0, 100);
      chrome.storage.local.set({ wamNotifs: notifs });
      renderNotifs();
    }
  };
  $('#wam-avrefresh').onclick = () => fetchNotifs(true);
  $('#wam-avreadall').onclick = () => { notifs.forEach((n) => readIds.add(n.id)); saveRead(); renderNotifs(); };
  setInterval(() => fetchNotifs(), 15 * 60 * 1000);

  // ---------- envío ----------
  const fmt = (s) => { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

  let statsPrefix = '';
  const setStats = (extra = '') => {
    const total = run.total ?? recipients.length;
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
  // Modo seguro: ritmo de teclado humano (~90–200 ms por carácter, entre 2 y 25 s).
  const typingMs = (txt) => {
    if (!cfg.typing) return 0;
    if (cfg.auto) return Math.min(25000, Math.max(2000, txt.length * rnd(90, 200)));
    return Math.min(7000, Math.max(1200, txt.length * rnd(35, 70)));
  };

  // ----- límites del modo seguro: tope diario real, calentamiento gradual, horario y orden aleatorio -----
  const WARMUP = [30, 60, 100, 150]; // envíos permitidos en cada uno de los primeros días de uso
  const sentToday = () => { const k = dayKey(Date.now()); return sendLog.filter((e) => e.ok && dayKey(e.t) === k).length; };
  const activeDaysBefore = () => {
    const k = dayKey(Date.now());
    return new Set(sendLog.filter((e) => e.ok && dayKey(e.t) !== k).map((e) => dayKey(e.t))).size;
  };
  const dailyAllowance = () => {
    let lim = cfg.dailyLimit;
    if (cfg.auto && cfg.warmup) {
      const d = activeDaysBefore();
      if (d < WARMUP.length) lim = Math.min(lim, WARMUP[d]);
    }
    return lim;
  };
  const hoursActive = () => cfg.auto && cfg.hoursOn && cfg.hourFrom < cfg.hourTo;
  const inWindow = () => { const n = new Date(); const h = n.getHours() + n.getMinutes() / 60; return h >= cfg.hourFrom && h < cfg.hourTo; };
  const secondsToWindow = () => {
    const n = new Date();
    const t = new Date(n);
    t.setHours(cfg.hourFrom, 0, 0, 0);
    if (t <= n) t.setDate(t.getDate() + 1);
    return (t - n) / 1000 + rnd(0, 600); // hasta 10 min extra para no arrancar siempre a la misma hora
  };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ----- envío pendiente: se guarda la cola restante para poder retomarla si se cierra la pestaña o se apaga el equipo -----
  let job = null; // { queue, total, sent, failed, source, startedAt }
  const persistJob = () => (job ? chrome.storage.local.set({ wamJob: job }) : chrome.storage.local.remove('wamJob'));
  const renderResume = () => {
    const show = !!(job && job.queue.length) && run.state !== 'running';
    $('#wam-resume').hidden = !show;
    if (!show) return;
    $('#wam-resume-info').textContent =
      `Quedan ${job.queue.length} de ${job.total} contactos · enviados ${job.sent}, fallidos ${job.failed} · iniciado ` +
      new Date(job.startedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  $('#wam-resume-drop').onclick = () => {
    if (!confirm('¿Descartar el envío pendiente? Los contactos que faltan no recibirán el mensaje.')) return;
    job = null; persistJob(); renderResume();
  };
  $('#wam-resume-go').onclick = () => start(true);

  const start = async (resume = false) => {
    if (run.state === 'running') return;
    if (!(await checkLicense())) { gateOpen = true; renderLic(); return log(lic.reason || 'Licencia no válida', 'err'); }
    if (resume !== true) {
      if (!recipients.length) return log('No hay destinatarios', 'err');
      if (cfg.source === 'excel' && !excel.rows.length) return log('Carga primero un archivo Excel', 'err');
    } else if (!job || !job.queue.length) return log('No hay un envío pendiente', 'err');
    if (!activeMsgs().length) return log('Escribe al menos un mensaje', 'err');
    const allowedVars = new Set(resume === true ? (job.queue[0].vars ? Object.keys(job.queue[0].vars) : ['nombre']) : varKeys());
    const unknown = new Set();
    activeMsgs().forEach((m) => [...m.matchAll(/{([^{}|]+)}/g)].forEach((x) => { if (!allowedVars.has(norm(x[1]))) unknown.add(x[0]); }));
    if (unknown.size) {
      return log('Variables sin datos: ' + [...unknown].join(' ') + (cfg.source === 'excel' ? ' (no existen como columna en el Excel)' : ' (solo existen al enviar por Excel)'), 'err');
    }
    try { if (!(await call('status')).ready) throw 0; } catch { return log('WhatsApp aún no está listo', 'err'); }
    const allowed = dailyAllowance();
    const remaining = allowed - sentToday();
    if (remaining <= 0) return log(`Límite diario alcanzado: ${sentToday()} de ${allowed} enviados hoy. Continúa mañana.`, 'err');
    const warm = cfg.auto && cfg.warmup && allowed < cfg.dailyLimit ? ` (calentamiento: hoy máximo ${allowed})` : '';
    const pending = resume === true ? job.queue.length : recipients.length;
    if (!confirm(`${resume === true ? 'Se reanudará el envío' : 'Se enviarán'}: hasta ${Math.min(pending, remaining)} mensajes hoy${warm}. ¿Continuar?`)) return;
    if (resume !== true && job && job.queue.length && !confirm('Hay un envío pendiente sin terminar. Iniciar uno nuevo lo descartará. ¿Continuar?')) return;

    let queue;
    if (resume === true) {
      queue = [...job.queue];
      run = { state: 'running', sent: job.sent, failed: job.failed, stop: false, paused: false, total: job.total };
    } else {
      queue = cfg.auto ? shuffle([...recipients]) : [...recipients];
      job = { queue, total: queue.length, sent: 0, failed: 0, source: cfg.source, startedAt: Date.now() };
      run = { state: 'running', sent: 0, failed: 0, stop: false, paused: false, total: queue.length };
    }
    statsPrefix = '';
    let processed = 0;
    persistJob(); renderResume();
    let nextPauseAt = rndInt(cfg.batchMin, cfg.batchMax);
    let sinceBreak = 0, consecErr = 0, lastLic = Date.now();
    log('Envío iniciado');

    for (let i = 0; i < queue.length; i++) {
      if (run.stop) break;
      if (Date.now() - lastLic > 30 * 60 * 1000) {
        lastLic = Date.now();
        if (!(await checkLicense())) { log('Envío detenido: ' + (lic.reason || 'licencia no válida'), 'err'); break; }
      }
      if (sentToday() >= dailyAllowance()) { log(`Límite diario alcanzado (${sentToday()} hoy). Continúa mañana.`, 'err'); break; }
      if (hoursActive() && !inWindow()) {
        const sec = secondsToWindow();
        log(`Fuera del horario (${cfg.hourFrom}:00–${cfg.hourTo}:00). Se reanuda en ${fmt(sec)}`);
        if (!(await wait(sec, 'Fuera de horario, reanuda en'))) break;
        sinceBreak = 0;
      }
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
      const msgIdx = lastMsg;
      const who = r.name || r.id.split('@')[0];
      // se guarda ANTES de enviar: si la pestaña se cierra a mitad, no se repite este contacto (evita duplicados)
      job.queue = queue.slice(i + 1);
      persistJob();
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
        record({ ok: true, id: r.id, name: r.name, m: msgIdx });
        log(`✓ ${who}`, 'ok');
      } catch (e) {
        run.failed++; consecErr++;
        record({ ok: false, id: r.id, name: r.name, err: e.message });
        log(`✗ ${who}: ${e.message}`, 'err');
        if (consecErr >= cfg.maxErrors) { processed++; job.sent = run.sent; job.failed = run.failed; persistJob(); log(`Detenido: ${consecErr} errores seguidos`, 'err'); break; }
      }
      processed++;
      job.sent = run.sent; job.failed = run.failed;
      persistJob();
      setStats();
      if (i < queue.length - 1 && !(await wait(nextDelay(), 'Próximo en'))) break;
    }
    run.state = 'idle';
    const finished = processed >= queue.length;
    if (finished) job = null; // terminó todo: no queda nada pendiente
    else if (job) job.queue = queue.slice(processed);
    persistJob(); renderResume();
    statsPrefix = finished ? 'Terminado. ' : 'Detenido. ';
    setStats();
    log(finished ? 'Envío terminado' : `Envío detenido. Quedan ${queue.length - processed} contactos pendientes: puedes reanudar`);
  };

  $('#wam-start').onclick = () => start(false);
  $('#wam-pause').onclick = () => {
    run.paused = !run.paused;
    $('#wam-pause').textContent = run.paused ? 'Reanudar' : 'Pausar';
  };
  $('#wam-stop').onclick = () => { run.stop = true; run.paused = false; $('#wam-pause').textContent = 'Pausar'; };

  // ---------- init ----------
  chrome.storage.local.get('wamLic').then(({ wamLic }) => {
    if (wamLic) lic = { ...lic, ...wamLic, valid: false, checking: false, reason: wamLic.token ? 'Verificando licencia…' : '' };
    renderLic();
  });
  chrome.storage.local.get('wamJob').then(({ wamJob }) => {
    if (wamJob && Array.isArray(wamJob.queue) && wamJob.queue.length) { job = wamJob; renderResume(); }
  });
  chrome.storage.local.get(['wamRead', 'wamNotifs']).then(({ wamRead, wamNotifs }) => {
    if (Array.isArray(wamRead)) readIds = new Set(wamRead);
    if (Array.isArray(wamNotifs)) notifs = wamNotifs; // se muestran al instante, aunque no haya conexión
    renderNotifs();
  });
  chrome.storage.local.get('wamLog').then(({ wamLog }) => { if (Array.isArray(wamLog)) sendLog = wamLog; });
  chrome.storage.local.get('wamCfg').then(({ wamCfg }) => {
    cfg = { ...DEFAULTS, ...(wamCfg || {}) };
    if (wamCfg && wamCfg.message && !wamCfg.messages) cfg.messages = [wamCfg.message]; // versión anterior
    if (!Array.isArray(cfg.messages) || !cfg.messages.length) cfg.messages = [''];
    // sin mensajes propios (o solo el de ejemplo anterior): se cargan los 10 de ejemplo
    if (cfg.messages.every((m) => !m.trim() || m === OLD_DEFAULT_MSG)) {
      let backup = null;
      try { backup = JSON.parse(localStorage.getItem('wam_messages') || 'null'); } catch {}
      cfg.messages = Array.isArray(backup) && backup.some((m) => String(m).trim() && m !== OLD_DEFAULT_MSG) ? backup : [...EXAMPLE_MSGS];
      save();
    }
    if (cfg.source !== 'excel') cfg.source = 'label';
    syncFields();
    applySource();
    renderPreview();
  });
  const t0 = Date.now();
  let diagShown = false;
  const poll = setInterval(async () => {
    try {
      const st = await call('status');
      setConn(st.ready);
      if (st.ready) { clearInterval(poll); refreshData(); checkLicense(); }
      else if (!diagShown && Date.now() - t0 > 25000) {
        diagShown = true;
        log(`WhatsApp no termina de cargar la librería interna (WPP=${st.hasWPP}, isReady=${st.isReady}, isFullReady=${st.isFullReady}, inyectada=${st.injected}, cargador=${st.loaderType}, globales=[${st.has}], otras=[${st.keys}], WhatsApp Web ${st.waVersion || '?'}, librería ${st.version || '?'}). Recarga la página con Ctrl+Shift+R.`, 'err');
      }
    } catch {}
  }, 2000);
})();

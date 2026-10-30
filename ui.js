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
    ia: { on: false, mode: 'sugerencia', scope: 'etiquetas', modos: { etiquetas: true, palabras: false, todos: false, nuevos: false, noLeidos: false }, labels: [], instrucciones: '', maxDia: 100, horas: 0, instrAplicadas: '', horarioOn: true, inicio: '08:00', cierre: '20:00', palabras: '', reLabels: [], reDias: 3, kwExtra: false, consent: false },
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
    <div class="wam-head"><img id="wam-logo" alt=""><div class="wam-title" title="Envíos masivos"><img id="wam-word" alt="Beautychat"></div><button id="wam-bell" class="wam-bell" title="Avisos"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><b id="wam-avibadge" class="wam-badge" hidden></b></button><button id="wam-about" class="wam-aboutbtn" title="Estado y licencia">Acerca</button><button id="wam-close" title="Cerrar">×</button></div>
    <div id="wam-avibox" hidden>
      <div class="wam-avihead"><b>Avisos</b></div>
      <div class="wam-sum"><span id="wam-avinfo">Sin avisos.</span>
        <span><a id="wam-avrefresh">Actualizar</a> · <a id="wam-avreadall">Marcar todos como leídos</a></span></div>
      <div id="wam-avlist"></div>
    </div>
    <div id="wam-aboutbox" hidden>
      <div class="wam-aboutrow"><span>Conexión</span><span id="wam-conn">…</span></div>
      <div class="wam-aboutrow"><span>Licencia</span><span id="wam-licstat"></span></div>
      <div class="wam-aboutrow"><span>Número de WhatsApp</span><b id="wam-aboutnum">…</b></div>
      <div class="wam-aboutrow"><span>Versión</span><b id="wam-aboutver"></b></div>
      <button id="wam-changelic" class="wam-btn alt">Cambiar licencia</button>
    </div>

    <div id="wam-gate">
      <div class="wam-card">
        <img id="wam-biglogo" alt="Beautychat">
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
      <button data-tab="ia">IA</button>
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

      <h4>Métricas · Resumen</h4>
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

    <div class="wam-body" data-body="ia" hidden>
      <h4>Respuestas con IA</h4>
      <div class="wam-card">
        <div id="wam-iawarn" class="wam-notice bad" hidden></div>
        <div id="wam-iastatus" class="wam-hint">IA apagada.</div>

        <div class="wam-hint"><b>Modo</b></div>
        <div class="wam-seg" id="wam-iamode">
          <button data-m="sugerencia" class="on">Sugerencia</button>
          <button data-m="auto">Automático</button>
        </div>
        <p class="wam-hint">Sugerencia: la IA propone y tú apruebas. Automático: la IA responde sola y enseguida (unos 3 segundos), respetando el horario y el límite diario. Las pausas largas son solo para los envíos masivos.</p>

        <div class="wam-hint"><b>Modalidades</b> (activa una o varias)</div>
        <div id="wam-iamodos">
          <label class="wam-sw"><span>Por etiquetas<small>Chats con las etiquetas que elijas más abajo.</small></span><input type="checkbox" data-modo="etiquetas"><i></i></label>
          <label class="wam-sw"><span>Por palabras claves<small>Cuando un mensaje entrante contenga alguna palabra clave.</small></span><input type="checkbox" data-modo="palabras"><i></i></label>
          <label class="wam-sw"><span>Para todos los chats<small>Cualquier chat individual con respuesta pendiente.</small></span><input type="checkbox" data-modo="todos"><i></i></label>
          <label class="wam-sw"><span>Conversaciones nuevas<small>Chats donde el negocio todavía no ha escrito.</small></span><input type="checkbox" data-modo="nuevos"><i></i></label>
          <label class="wam-sw"><span>Solo no leídos<small>Limita lo anterior a los chats con mensajes sin leer.</small></span><input type="checkbox" data-modo="noLeidos"><i></i></label>
        </div>
        <p class="wam-hint" id="wam-iamodohint"></p>
        <div id="wam-iakwbox" hidden>
          <div class="wam-hint"><b>Palabras claves para activar al asistente</b></div>
          <div id="wam-kwchips" class="wam-chips"><input id="iaKwInput" placeholder="Escribe una palabra y pulsa Enter" autocomplete="off" maxlength="60"></div>
          <p class="wam-hint">Escribe una palabra o frase y pulsa <b>Enter</b> para agregarla; toca la × para quitarla. No distingue mayúsculas, minúsculas ni tildes («PRECIO», «Precio» y «precio» son lo mismo), y detecta la palabra aunque lleve más letras al final: «precio» también encuentra «precios». Desde que se activa en un chat, el asistente sigue la conversación aunque el cliente ya no use la palabra.</p>
        </div>
        <p class="wam-hint">Al activarla busca los chats y, si falta tu respuesta (el último mensaje es del cliente), continúa la conversación, leído o no. Solo chats individuales (no grupos). Si una persona del equipo responde en un chat, la IA se aparta de ese chat 24 horas.</p>

        <div class="wam-hint"><b>Etiquetas que usará la IA</b> (elige al menos una)</div>
        <div id="wam-ialabels" class="wam-list"></div>

        <div class="wam-hint" style="margin-top:10px"><b>Entrenamiento de la IA</b></div>
        <textarea id="iaInstr" rows="6" maxlength="3000" placeholder="Qué vendes o qué servicio das, tono, precios, horarios, qué NO debe hacer… La IA solo usa esta información; si no está aquí, pasa el chat a una persona."></textarea>
        <div id="wam-iatrain" class="wam-notice" hidden>Tienes cambios sin aplicar. La IA sigue respondiendo con el entrenamiento anterior hasta que pulses «Actualizar IA».</div>
        <button id="wam-iaupdate" class="wam-btn" disabled>Actualizar IA</button>

        <div class="wam-hint" style="margin-top:10px"><b>Horario de trabajo</b></div>
        <label class="wam-sw"><span>Responder solo dentro del horario</span><input type="checkbox" id="iaHorarioOn"><i></i></label>
        <label>Hora de inicio <span><input type="time" id="iaInicio"></span></label>
        <label>Hora de cierre <span><input type="time" id="iaCierre"></span></label>
        <p class="wam-hint" id="wam-iahorario"></p>
        <button id="wam-ianow" class="wam-btn alt">Revisar ahora</button>
      </div>

      <h4>Reactivar conversaciones (envío masivo con IA)</h4>
      <div class="wam-card">
        <p class="wam-hint">La IA lee los últimos 3 mensajes de cada conversación con las etiquetas que marques y escribe un mensaje nuevo para retomarla. Se envía con los intervalos, pausas, horario y límites del envío masivo.</p>
        <div class="wam-hint"><b>Etiquetas a reactivar</b></div>
        <div id="wam-relabels" class="wam-list"></div>
        <label>Sin respuesta desde hace al menos (días) <span><input type="number" id="iaReDias" min="0" max="3650"></span></label>
        <button id="wam-rebuscar" class="wam-btn alt">Buscar conversaciones</button>
        <div id="wam-restatus" class="wam-hint">Aún no se buscó.</div>
        <div class="wam-row">
          <button id="wam-reiniciar" class="wam-btn">Iniciar reactivación</button>
          <button id="wam-repausa" class="wam-btn alt">Pausar</button>
          <button id="wam-redetener" class="wam-btn alt danger">Detener</button>
        </div>
        <div id="wam-iaprog" class="wam-hint"></div>
      </div>

      <h4>Sugerencias para aprobar</h4>
      <div class="wam-card"><div id="wam-iasug">No hay sugerencias pendientes.</div></div>

      <h4>Necesitan a una persona</h4>
      <div class="wam-card"><div id="wam-iahuman" class="wam-list small">Ninguno.</div></div>
    </div>

    <div id="wam-foot-bulk" class="wam-foot">
      <div id="wam-hint-bulk" class="wam-notice bad wam-span" hidden>La IA está en marcha: el envío masivo está bloqueado. Pausa la IA (pestaña IA) para usarlo. Solo puede funcionar una de las dos a la vez.</div>
      <button id="wam-start" class="wam-btn big">Iniciar envío</button>
      <button id="wam-pause" class="wam-btn alt">Pausar</button>
      <button id="wam-stop" class="wam-btn alt danger">Detener</button>
    </div>
    <div id="wam-foot-ia" class="wam-foot" hidden>
      <div id="wam-hint-ia" class="wam-notice bad wam-span" hidden>Hay un envío masivo en curso: la IA no puede iniciarse hasta que termine o lo detengas. Solo puede funcionar una de las dos a la vez.</div>
      <button id="wam-iastart" class="wam-btn">Iniciar IA</button>
      <button id="wam-iapause" class="wam-btn alt" disabled>Pausar IA</button>
    </div>
  </div>`;
  document.documentElement.appendChild(root);

  const panel = $('#wam-panel');
  $('#wam-logo').src = chrome.runtime.getURL('icons/mark.png');
  $('#wam-biglogo').src = chrome.runtime.getURL('icons/logo.png');
  $('#wam-word').src = chrome.runtime.getURL('icons/wordmark.png');
  $('#wam-close').onclick = () => (panel.hidden = true);
  $('#wam-aboutver').textContent = chrome.runtime.getManifest().version;
  // un solo desplegable abierto a la vez: avisos (campanita) o "Acerca"
  const abrirAvisos = () => { $('#wam-aboutbox').hidden = true; $('#wam-avibox').hidden = false; renderNotifs(); fetchNotifs(true); };
  $('#wam-about').onclick = () => { const b = $('#wam-aboutbox'); $('#wam-avibox').hidden = true; b.hidden = !b.hidden; };
  $('#wam-bell').onclick = () => { if ($('#wam-avibox').hidden) abrirAvisos(); else $('#wam-avibox').hidden = true; };
  panel.addEventListener('click', (e) => {
    if (!e.target.closest('#wam-aboutbox, #wam-about')) $('#wam-aboutbox').hidden = true;
    if (!e.target.closest('#wam-avibox, #wam-bell, #wam-avbar')) $('#wam-avibox').hidden = true;
  });
  panel.querySelectorAll('.wam-tabbar button').forEach((b) => {
    b.onclick = () => {
      panel.querySelectorAll('.wam-tabbar button').forEach((x) => x.classList.toggle('on', x === b));
      panel.querySelectorAll('[data-body]').forEach((d) => (d.hidden = d.dataset.body !== b.dataset.tab));
      if (b.dataset.tab === 'env') renderMetrics();
      if (b.dataset.tab === 'ia') { renderIaLabels(); renderIaReLabels(); renderIaSug(); renderIaHuman(); }
      $('#wam-foot-bulk').hidden = !(b.dataset.tab === 'env' || b.dataset.tab === 'msg'); // botones del envío masivo
      $('#wam-foot-ia').hidden = b.dataset.tab !== 'ia'; // botones de la IA
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
      renderIaLabels();
      renderIaReLabels();
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
    if (!$('[data-body="env"]').hidden) renderMetrics();
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
    $('#wam-aboutnum').textContent = lic.number ? '+' + lic.number : 'no disponible aún';
    if (!$('#wam-token').value) $('#wam-token').value = lic.token;
    $('#wam-gate-msg').textContent = lic.checking ? 'Verificando licencia…' : lic.reason || 'Ingresa el token de tu licencia.';
    $('#wam-gate-msg').className = 'wam-notice' + (lic.reason && !lic.checking ? ' bad' : '');
    $('#wam-gate-detail').textContent = lic.detail || '';
    $('#wam-gate').hidden = lic.valid && !gateOpen;
    $('#wam-gate-close').hidden = !lic.valid;
    $('#wam-start').disabled = !lic.valid || !!(cfg.ia && cfg.ia.on);
  };
  $('#wam-licstat').onclick = () => { gateOpen = true; renderLic(); };
  $('#wam-changelic').onclick = () => { $('#wam-aboutbox').hidden = true; $('#wam-avibox').hidden = true; gateOpen = true; renderLic(); };
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
  let avPrevUnread = -1; // para animar la campana solo cuando llega un aviso nuevo (no al cargar)
  const NOTIF_EVERY_MS = 60 * 60 * 1000; // los avisos se actualizan cada hora (además al abrir la pestaña Avisos o pulsar Actualizar)
  const TIPO_LABEL = { info: 'Información', aviso: 'Aviso', importante: 'Importante' };
  const saveRead = () => chrome.storage.local.set({ wamRead: [...readIds].slice(-500) });
  // el servidor es la fuente de verdad (n.leida); readIds es solo la marca local hasta que el servidor confirma
  const isRead = (n) => !!n.leida || readIds.has(n.id);
  const unreadList = () => notifs.filter((n) => !isRead(n));
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const fmtAviso = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  const renderNotifs = () => {
    const un = unreadList();
    const urgent = un.some((n) => n.tipo === 'importante');
    const badge = $('#wam-avibadge');
    badge.hidden = !un.length;
    badge.textContent = un.length;
    const bell = $('#wam-bell');
    if (bell && bell.classList && avPrevUnread >= 0 && un.length > avPrevUnread) { // llegó un aviso nuevo: la campana se mueve un momento
      bell.classList.add('nuevo');
      setTimeout(() => bell.classList.remove('nuevo'), 2500);
    }
    avPrevUnread = un.length;
    const bar = $('#wam-avbar');
    bar.hidden = !un.length;
    bar.className = 'wam-avbar' + (urgent ? ' urgent' : '');
    bar.textContent = '';
    if (un.length) {
      const a = document.createElement('a');
      a.textContent = 'Tienes ' + un.length + (un.length === 1 ? ' aviso sin leer' : ' avisos sin leer') + ' — Ver';
      a.onclick = () => abrirAvisos();
      bar.appendChild(a);
    }
    try { chrome.runtime.sendMessage({ type: 'wam-badge', count: un.length, urgent }); } catch {}

    $('#wam-avinfo').textContent = notifs.length ? notifs.length + ' aviso(s) · ' + un.length + ' sin leer' : 'Sin avisos.';
    const box = $('#wam-avlist');
    box.innerHTML = '';
    [...notifs].sort((a, b) => (isRead(a) ? 1 : 0) - (isRead(b) ? 1 : 0)).forEach((n) => {
      const leido = isRead(n);
      const card = document.createElement('div');
      card.className = 'wam-aviso ' + n.tipo + (leido ? ' read' : '');
      const h = document.createElement('b');
      h.textContent = n.titulo;
      const tag = document.createElement('em');
      tag.textContent = TIPO_LABEL[n.tipo] || '';
      const p = document.createElement('p');
      p.textContent = n.mensaje;
      const meta = document.createElement('div');
      meta.className = 'wam-hint';
      const st = document.createElement('span');
      st.className = 'wam-st ' + (leido ? 'read' : 'new');
      st.textContent = leido ? '✓ Leído' : '● Nuevo';
      meta.append(st, ' · ' + fmtAviso(n.fecha));
      card.append(h, tag, p, meta);
      const url = safeUrl(n.link);
      if (url) {
        const l = document.createElement('a');
        l.href = url; l.target = '_blank'; l.rel = 'noopener noreferrer'; l.textContent = 'Abrir enlace';
        card.appendChild(l);
      }
      if (!leido) {
        const r = document.createElement('a');
        r.className = 'wam-markread';
        r.textContent = 'Marcar como leído';
        r.onclick = () => markRead([n.id]);
        card.appendChild(r);
      }
      box.appendChild(card);
    });
  };

  // Pide los avisos al backend (por el service worker). Con markId también marca ese aviso como leído
  // en el servidor (POST con "leida": id, idempotente). Si falla, se conservan los últimos guardados.
  const markAttempts = new Map(); // id -> intentos de sincronizar la lectura (máx. 3, para no insistir sin fin)
  const fetchNotifs = async (force = false, markId = '') => {
    if (!lic.token || !lic.number) return false;
    // consultas automáticas: como máximo una por hora (55 min de margen para que el temporizador de 1 h no quede justo por debajo)
    if (!force && Date.now() - lastNotifFetch < NOTIF_EVERY_MS - 5 * 60 * 1000) return false;
    if (!force) markAttempts.clear(); // cada consulta periódica vuelve a intentar las lecturas pendientes
    lastNotifFetch = Date.now();
    const payload = { type: 'wam-notifs', token: lic.token, numero: lic.number };
    if (markId) payload.leida = markId;
    const r = await new Promise((resolve) =>
      chrome.runtime.sendMessage(payload, (x) => resolve(x || { error: chrome.runtime.lastError?.message || 'sin respuesta' })));
    if (!(r.status === 200 && r.data && Array.isArray(r.data.notificaciones))) return false;
    notifs = r.data.notificaciones
      .filter((n) => n && n.id && n.titulo)
      .map((n) => ({ ...n, leida: n.leida === true, tipo: TIPO_LABEL[n.tipo] ? n.tipo : 'info' }))
      .slice(0, 100);
    // lo que el servidor ya confirmó como leído deja de ser una marca local pendiente
    notifs.forEach((n) => { if (n.leida) { readIds.delete(n.id); markAttempts.delete(n.id); } });
    saveRead();
    chrome.storage.local.set({ wamNotifs: notifs });
    renderNotifs();
    // avisos que el usuario marcó pero el servidor aún no registra (p. ej. se marcó sin conexión): se reintenta uno
    if (!markId) {
      const pend = notifs.find((n) => !n.leida && readIds.has(n.id) && (markAttempts.get(n.id) || 0) < 3);
      if (pend) { markAttempts.set(pend.id, (markAttempts.get(pend.id) || 0) + 1); fetchNotifs(true, pend.id); }
    }
    return true;
  };

  // Marca avisos como leídos: se ve al instante y se confirma en el servidor, uno por uno
  const markRead = async (ids) => {
    ids.forEach((id) => readIds.add(id));
    saveRead();
    renderNotifs();
    for (const id of ids) await fetchNotifs(true, id);
  };
  $('#wam-avrefresh').onclick = () => fetchNotifs(true);
  $('#wam-avreadall').onclick = () => markRead(unreadList().map((n) => n.id));
  setInterval(() => fetchNotifs(), NOTIF_EVERY_MS);

  // ---------- envío ----------
  const fmt = (s) => { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

  let statsPrefix = '';
  const setStats = (extra = '') => {
    const total = run.total ?? recipients.length;
    $('#wam-stats').textContent = `${statsPrefix}Enviados ${run.sent} · Fallidos ${run.failed} · Total ${total}${extra ? ' — ' + extra : ''}`;
    $('#wam-barfill').style.width = total ? ((run.sent + run.failed) / total) * 100 + '%' : '0%';
    $('#wam-iaprog').textContent = $('#wam-stats').textContent;
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
    $('#wam-resume-info').textContent = (job.tipo === 'ia' ? 'Reactivación con IA. ' : '') +
      `Quedan ${job.queue.length} de ${job.total} contactos · enviados ${job.sent}, fallidos ${job.failed} · iniciado ` +
      new Date(job.startedAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  $('#wam-resume-drop').onclick = () => {
    if (!confirm('¿Descartar el envío pendiente? Los contactos que faltan no recibirán el mensaje.')) return;
    job = null; persistJob(); renderResume();
  };
  $('#wam-resume-go').onclick = () => start(true);

  // opts = { queue, gen, onSent } -> reactivación con IA: cada mensaje lo genera gen(r) en vez de salir de una plantilla
  const start = async (resume = false, opts = null) => {
    if (run.state === 'running') return;
    if (cfg.ia && cfg.ia.on) {
      const msg = 'La IA está en marcha: pausa la IA (pestaña IA) para hacer un envío masivo. Solo puede funcionar una de las dos a la vez.';
      log(msg, 'err');
      setStats(msg);
      return;
    }
    if (!(await checkLicense())) { gateOpen = true; renderLic(); return log(lic.reason || 'Licencia no válida', 'err'); }
    const iaMode = !!(opts && opts.gen) || (resume === true && job && job.tipo === 'ia');
    if (iaMode && !opts) opts = iaReOpts(); // al reanudar una reactivación hay que volver a armar el generador
    if (resume !== true) {
      if (iaMode) { if (!opts.queue || !opts.queue.length) return log('No hay conversaciones para reactivar', 'err'); }
      else {
        if (!recipients.length) return log('No hay destinatarios', 'err');
        if (cfg.source === 'excel' && !excel.rows.length) return log('Carga primero un archivo Excel', 'err');
      }
    } else if (!job || !job.queue.length) return log('No hay un envío pendiente', 'err');
    if (!iaMode) {
      if (!activeMsgs().length) return log('Escribe al menos un mensaje', 'err');
      const allowedVars = new Set(resume === true ? (job.queue[0].vars ? Object.keys(job.queue[0].vars) : ['nombre']) : varKeys());
      const unknown = new Set();
      activeMsgs().forEach((m) => [...m.matchAll(/{([^{}|]+)}/g)].forEach((x) => { if (!allowedVars.has(norm(x[1]))) unknown.add(x[0]); }));
      if (unknown.size) {
        return log('Variables sin datos: ' + [...unknown].join(' ') + (cfg.source === 'excel' ? ' (no existen como columna en el Excel)' : ' (solo existen al enviar por Excel)'), 'err');
      }
    }
    try { if (!(await call('status')).ready) throw 0; } catch { return log('WhatsApp aún no está listo', 'err'); }
    const allowed = dailyAllowance();
    const remaining = allowed - sentToday();
    if (remaining <= 0) return log(`Límite diario alcanzado: ${sentToday()} de ${allowed} enviados hoy. Continúa mañana.`, 'err');
    const warm = cfg.auto && cfg.warmup && allowed < cfg.dailyLimit ? ` (calentamiento: hoy máximo ${allowed})` : '';
    const pending = resume === true ? job.queue.length : (iaMode ? opts.queue.length : recipients.length);
    const que = iaMode ? 'mensajes de reactivación escritos por la IA' : 'mensajes';
    if (!confirm(`${resume === true ? 'Se reanudará el envío' : 'Se enviarán'}: hasta ${Math.min(pending, remaining)} ${que} hoy${warm}, con las pausas de seguridad. ¿Continuar?`)) return;
    if (resume !== true && job && job.queue.length && !confirm('Hay un envío pendiente sin terminar. Iniciar uno nuevo lo descartará. ¿Continuar?')) return;

    let queue;
    if (resume === true) {
      queue = [...job.queue];
      run = { state: 'running', sent: job.sent, failed: job.failed, stop: false, paused: false, total: job.total };
    } else {
      const base = iaMode ? opts.queue : recipients;
      queue = cfg.auto ? shuffle([...base]) : [...base];
      job = { queue, total: queue.length, sent: 0, failed: 0, source: iaMode ? 'ia' : cfg.source, tipo: iaMode ? 'ia' : undefined, startedAt: Date.now() };
      run = { state: 'running', sent: 0, failed: 0, stop: false, paused: false, total: queue.length };
    }
    statsPrefix = '';
    let processed = 0;
    renderIaRun(); // la IA queda bloqueada mientras dure el envío masivo
    persistJob(); renderResume();
    let nextPauseAt = rndInt(cfg.batchMin, cfg.batchMax);
    let sinceBreak = 0, consecErr = 0, lastLic = Date.now();
    log(iaMode ? 'Reactivación con IA iniciada' : 'Envío iniciado');

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

      const who = r.name || r.id.split('@')[0];
      let text, msgIdx, etiquetaIA = '';
      if (iaMode) {
        setStats('La IA está escribiendo para ' + who + '…');
        const g = await opts.gen(r);
        if (g.skip) { // la IA no recomienda escribirle (pidió no recibir mensajes, no hay contexto…): no se envía ni se espera
          log('— ' + who + ': no se le escribe (' + g.skip + ')');
          job.queue = queue.slice(i + 1); processed++; persistJob(); setStats();
          continue;
        }
        if (g.error) {
          run.failed++; consecErr++; processed++;
          job.queue = queue.slice(i + 1); job.sent = run.sent; job.failed = run.failed; persistJob();
          record({ ok: false, id: r.id, name: r.name, err: g.error });
          log('✗ ' + who + ': ' + g.error, 'err');
          if (consecErr >= cfg.maxErrors) { log('Detenido: ' + consecErr + ' errores seguidos', 'err'); break; }
          setStats();
          continue;
        }
        text = g.text; etiquetaIA = g.etiqueta || ''; msgIdx = null;
      } else {
        text = build(r);
        msgIdx = lastMsg;
      }
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
        if (iaMode) { if (opts.onSent) opts.onSent(r); if (etiquetaIA) iaApplyLabel(to, etiquetaIA, r.labels); }
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
    renderIaRun();
    const finished = processed >= queue.length;
    if (finished) job = null; // terminó todo: no queda nada pendiente
    else if (job) job.queue = queue.slice(processed);
    persistJob(); renderResume();
    statsPrefix = finished ? 'Terminado. ' : 'Detenido. ';
    setStats();
    log(finished ? (iaMode ? 'Reactivación terminada' : 'Envío terminado') : `Envío detenido. Quedan ${queue.length - processed} contactos pendientes: puedes reanudar`);
  };

  $('#wam-start').onclick = () => start(false);
  const bulkPause = () => {
    run.paused = !run.paused;
    $('#wam-pause').textContent = run.paused ? 'Reanudar' : 'Pausar';
    $('#wam-repausa').textContent = run.paused ? 'Reanudar' : 'Pausar';
  };
  const bulkStop = () => { run.stop = true; run.paused = false; $('#wam-pause').textContent = 'Pausar'; $('#wam-repausa').textContent = 'Pausar'; };
  $('#wam-pause').onclick = bulkPause;
  $('#wam-stop').onclick = bulkStop;

  // ---------- IA: responder chats individuales no leídos (sugerencia o automático) ----------
  // Cada consulta llama a /api/ia-whatsapp (por el service worker) con la conversación; la IA devuelve la
  // respuesta, la etiqueta que corresponde y si hace falta una persona. Solo chats individuales no leídos.
  const IA_SCAN_MS = 2 * 60 * 1000;
  const IA_MAX_PER_SCAN = 5; // consultas a la IA por revisión (control de costo)
  let iaBusy = false;
  let iaSeen = {}; // chatId -> hora del último mensaje del cliente ya atendido (no se vuelve a consultar)
  let iaSug = []; // sugerencias pendientes de aprobar
  let iaHuman = []; // chats que necesitan a una persona
  let iaCount = { day: 0, n: 0 }; // respuestas automáticas enviadas hoy
  let iaReSent = {}; // chatId -> cuándo (ms) se le envió una reactivación (para no insistir)
  let iaPausedDay = 0; // día en que el servidor avisó que se alcanzó el tope de consultas
  let iaEngaged = {}; // chatId -> true: conversaciones que la IA viene atendiendo (se continúan aunque ya no sean "nuevas")
  let iaSentT = {}; // chatId -> hora (segundos) del último mensaje enviado por la IA
  let iaPause = {}; // chatId -> hasta cuándo (ms) la IA se aparta porque una persona respondió
  const IA_PAUSE_MS = 24 * 3600 * 1000;
  let iaAgain = false; // llegó algo mientras se revisaba: se vuelve a revisar al terminar
  let iaKickT = null;

  const iaDay = () => dayKey(Date.now());
  const iaToday = () => (iaCount.day === iaDay() ? iaCount.n : 0);
  const iaPersist = () => {
    const keys = Object.keys(iaSeen);
    if (keys.length > 500) keys.slice(0, keys.length - 500).forEach((k) => delete iaSeen[k]);
    [iaEngaged, iaSentT].forEach((o) => { const k = Object.keys(o); if (k.length > 500) k.slice(0, k.length - 500).forEach((x) => delete o[x]); });
    Object.keys(iaPause).forEach((k) => { if (iaPause[k] < Date.now()) delete iaPause[k]; });
    chrome.storage.local.set({ wamIa: { seen: iaSeen, sug: iaSug.slice(0, 50), human: iaHuman.slice(0, 50), count: iaCount, engaged: iaEngaged, sentT: iaSentT, pause: iaPause, reSent: iaReSent } });
  };
  const setIaStatus = (t) => { $('#wam-iastatus').textContent = t; };
  const iaCanRun = () => !!(cfg.ia.on && lic.valid && cfg.ia.labels.length > 0 && run.state !== 'running');
  const iaLabelName = (id) => { const l = data.labels.find((x) => String(x.id) === String(id)); return l ? l.name : String(id); };
  const iaWarn = (t) => { const w = $('#wam-iawarn'); w.textContent = t || ''; w.hidden = !t; };

  const iaAddHuman = (c, motivo, t) => {
    iaHuman = iaHuman.filter((x) => x.chatId !== c.id);
    iaHuman.unshift({ chatId: c.id, name: c.name, motivo, t });
  };

  // ----- palabras clave: la IA se activa en un chat cuando el cliente escribe alguna -----
  const iaNorm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' '); // sin tildes, en minusculas y con espacios o saltos de linea repetidos como uno
  // lista de palabras claves tal como las escribió el usuario (sin repetidas, mínimo 2 letras); se guarda una por línea
  const iaKwLista = () => {
    const vistas = new Set();
    return String(cfg.ia.palabras || '').split(/[\n,;]+/).map((x) => x.trim()).filter((x) => {
      if (x.length < 2) return false;
      const k = iaNorm(x);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
  };
  const iaKeywords = () => [...new Set(String(cfg.ia.palabras || '').split(/[\n,;]+/).map((x) => iaNorm(x).trim()).filter((x) => x.length >= 2))];
  const iaEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ¿lo pendiente del cliente (sus mensajes desde la última respuesta del negocio) contiene una palabra clave? No distingue mayúsculas ni tildes. La palabra clave debe EMPEZAR una palabra del mensaje: «precio» encuentra «precio», «Precios» y «¿PRECIO?», pero no «aprecio» (a mitad de palabra).
  const iaMatchKw = (c) => {
    const kws = iaKeywords();
    if (!kws.length) return false;
    const txt = [];
    for (let i = c.msgs.length - 1; i >= 0 && c.msgs[i].de === 'cliente'; i--) if (c.msgs[i].texto) txt.push(c.msgs[i].texto);
    const t = ' ' + iaNorm(txt.join(' \n ')) + ' ';
    return kws.some((k) => new RegExp('(^|[^a-z0-9])' + iaEsc(k)).test(t)); // inicio de palabra, sin exigir el final (plurales y variantes)
  };
  // ----- modalidades: se pueden activar una o varias -----
  // Las modalidades de "qué chats" se SUMAN (basta con cumplir una): etiquetas, palabras claves, todos, nuevas.
  // "Solo no leídos" es una restricción: limita esos chats a los que tengan mensajes sin leer (y, sola, atiende todos los no leídos).
  const MODOS_QUE = ['etiquetas', 'palabras', 'todos', 'nuevos'];
  const iaModosActivos = () => ['etiquetas', 'palabras', 'todos', 'nuevos', 'noLeidos'].filter((k) => cfg.ia.modos[k]);
  const renderIaModos = () => {
    const m = cfg.ia.modos;
    panel.querySelectorAll('#wam-iamodos input[data-modo]').forEach((i) => { i.checked = !!m[i.dataset.modo]; });
    $('#wam-iakwbox').hidden = !m.palabras;
    const nombres = { etiquetas: 'con las etiquetas elegidas', palabras: 'cuando un mensaje entrante tenga una palabra clave', todos: 'todos los chats individuales', nuevos: 'las conversaciones nuevas' };
    const que = MODOS_QUE.filter((k) => m[k]);
    let t;
    if (!iaModosActivos().length) t = 'Activa al menos una modalidad para que la IA pueda funcionar.';
    else if (!que.length) t = 'La IA atiende todos los chats individuales que tengan mensajes sin leer.';
    else {
      t = 'La IA atiende: ' + que.map((k) => nombres[k]).join(' · ') + '.' + (que.length > 1 && !m.todos ? ' Basta con que el chat cumpla UNA de ellas.' : '');
      if (m.todos && que.length > 1) t += ' Con «todos los chats», las demás modalidades no restringen nada.';
      if (m.noLeidos) t += ' Y solo en chats con mensajes sin leer.';
    }
    $('#wam-iamodohint').textContent = t;
  };
  // ¿este chat entra en alguna modalidad activa?
  const iaCalifica = (c) => {
    const m = cfg.ia.modos;
    if (m.noLeidos && !(Number(c.unread) > 0)) return false; // restricción "solo no leídos"
    if (iaEngaged[c.id]) return true; // lo que la IA ya viene atendiendo continúa sin volver a calificar
    if (!MODOS_QUE.some((k) => m[k])) return true; // solo "no leídos": todos los no leídos
    if (m.todos) return true;
    if (m.etiquetas && (c.labels || []).some((l) => cfg.ia.labels.includes(l))) return true;
    if (m.nuevos && c.nuevo) return true;
    if (m.palabras && iaMatchKw(c)) return true;
    return false;
  };
  // qué chats pedirle al puente: con una sola modalidad de etiquetas o de nuevos se le pide solo eso; si no, todos y se filtra acá
  const iaPeticion = () => {
    const m = cfg.ia.modos;
    const soloEtiq = m.etiquetas && !m.palabras && !m.todos && !m.nuevos;
    const soloNuevos = m.nuevos && !m.etiquetas && !m.palabras && !m.todos;
    if (soloEtiq) return { scope: 'etiquetas', limit: 60 };
    if (soloNuevos) return { scope: 'nuevos', limit: 60 };
    return { scope: 'palabras', limit: 120 }; // todos los chats individuales
  };
  // ----- palabras claves como etiquetas: se escribe y con Enter se agrega; la × la quita -----
  const renderIaKwChips = () => {
    const cont = $('#wam-kwchips');
    const input = $('#iaKwInput');
    cont.querySelectorAll('.wam-chip').forEach((c) => c.remove());
    iaKwLista().forEach((k, i) => {
      const chip = document.createElement('span');
      chip.className = 'wam-chip';
      const t = document.createElement('span');
      t.textContent = k;
      const x = document.createElement('a');
      x.textContent = '×';
      x.title = 'Quitar';
      x.onclick = () => iaKwQuitar(i);
      chip.append(t, x);
      cont.insertBefore(chip, input);
    });
  };
  const iaKwCambio = () => { save(); renderIaKwChips(); if (cfg.ia.on && cfg.ia.modos.palabras) iaScan(true); };
  // agrega una o varias palabras (separadas por coma, punto y coma o salto de línea); devuelve true si agregó alguna nueva
  const iaKwAdd = (texto) => {
    const nuevas = String(texto || '').split(/[\n,;]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
    if (!nuevas.length) return false;
    const lista = iaKwLista();
    const claves = new Set(lista.map(iaNorm));
    let agregadas = 0;
    nuevas.forEach((x) => { if (!claves.has(iaNorm(x))) { lista.push(x); claves.add(iaNorm(x)); agregadas++; } });
    if (!agregadas) return false;
    cfg.ia.palabras = lista.join('\n').slice(0, 2000);
    iaKwCambio();
    return true;
  };
  const iaKwQuitar = (i) => {
    const lista = iaKwLista();
    lista.splice(i, 1);
    cfg.ia.palabras = lista.join('\n');
    iaKwCambio();
  };
  {
    const kwIn = $('#iaKwInput');
    kwIn.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
        e.preventDefault();
        iaKwAdd(kwIn.value);
        kwIn.value = '';
      } else if (e.key === 'Backspace' && !kwIn.value) { // con el cuadro vacío, Borrar quita la última
        const l = iaKwLista();
        if (l.length) iaKwQuitar(l.length - 1);
      }
    };
    kwIn.onblur = () => { if (kwIn.value.trim()) { iaKwAdd(kwIn.value); kwIn.value = ''; } }; // lo escrito no se pierde al salir del cuadro
    kwIn.onpaste = (e) => {
      const t = ((e.clipboardData || window.clipboardData) && (e.clipboardData || window.clipboardData).getData('text')) || '';
      if (/[\n,;]/.test(t)) { e.preventDefault(); iaKwAdd(t); } // pegar "precio, cita, info" crea una etiqueta por palabra
    };
    $('#wam-kwchips').onclick = (e) => { if (!(e.target.closest && e.target.closest('.wam-chip'))) kwIn.focus(); };
  }
  const iaSetModo = (clave, on) => {
    cfg.ia.modos[clave] = !!on;
    save();
    renderIaModos();
    if (!iaModosActivos().length && cfg.ia.on) { cfg.ia.on = false; save(); renderIaRun(); iaWarn('La IA se pausó: tiene que haber al menos una modalidad activa.'); }
    else if (cfg.ia.on) iaScan(true);
  };
  panel.querySelectorAll('#wam-iamodos input[data-modo]').forEach((i) => { i.onchange = () => iaSetModo(i.dataset.modo, i.checked); });

  // ----- horario de trabajo de la IA: hora de inicio y hora de cierre -----
  const iaMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const iaHorarioActivo = () => !!cfg.ia.horarioOn && iaMin(cfg.ia.inicio) !== null && iaMin(cfg.ia.cierre) !== null && iaMin(cfg.ia.inicio) !== iaMin(cfg.ia.cierre);
  const iaEnHorario = () => {
    const a = iaMin(cfg.ia.inicio), c = iaMin(cfg.ia.cierre);
    const n = new Date(), ahora = n.getHours() * 60 + n.getMinutes();
    return a < c ? ahora >= a && ahora < c : ahora >= a || ahora < c; // si el cierre es menor que el inicio, la jornada cruza la medianoche
  };
  const renderIaHorario = () => {
    $('#wam-iahorario').textContent = iaHorarioActivo()
      ? 'La IA responde de ' + cfg.ia.inicio + ' a ' + cfg.ia.cierre + (iaMin(cfg.ia.cierre) < iaMin(cfg.ia.inicio) ? ' (cruza la medianoche)' : '') + '. Fuera de ese horario no contesta; al iniciar la jornada atiende lo que quedó pendiente.'
      : 'La IA responde a cualquier hora.';
  };

  // ----- Iniciar / Pausar de la IA (independiente del envío masivo) -----
  // Solo puede funcionar UNA de las dos cosas: la IA o un envío masivo (incluida la reactivación con IA).
  const renderIaRun = () => {
    const on = !!cfg.ia.on;
    const masivo = run.state === 'running';
    $('#wam-iastart').disabled = on || masivo;
    $('#wam-iastart').textContent = on ? 'IA en marcha' : 'Iniciar IA';
    $('#wam-iapause').disabled = !on;
    $('#wam-start').disabled = !lic.valid || on; // envío masivo bloqueado mientras la IA está en marcha
    $('#wam-reiniciar').disabled = on || masivo;
    $('#wam-hint-bulk').hidden = !on;
    $('#wam-hint-ia').hidden = !masivo;
  };

  // ----- entrenamiento: lo escrito es un borrador hasta pulsar «Actualizar IA» -----
  const iaTrainDirty = () => (cfg.ia.instrucciones || '') !== (cfg.ia.instrAplicadas || '');
  const renderIaTrain = () => {
    const d = iaTrainDirty();
    $('#wam-iatrain').hidden = !d;
    $('#wam-iaupdate').disabled = !d;
  };

  // ----- pantalla -----
  const renderIaLabels = () => {
    const el = $('#wam-ialabels');
    el.innerHTML = '';
    if (!data.labels.length) { el.textContent = 'No hay etiquetas (requiere WhatsApp Business) o aún no se cargaron.'; return; }
    data.labels.forEach((lb) => {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = cfg.ia.labels.includes(String(lb.id));
      i.onchange = () => {
        const id = String(lb.id);
        cfg.ia.labels = i.checked ? [...new Set([...cfg.ia.labels, id])] : cfg.ia.labels.filter((x) => x !== id);
        if (!cfg.ia.labels.length && cfg.ia.on) { cfg.ia.on = false; renderIaRun(); iaWarn('La IA se pausó: tiene que haber al menos una etiqueta.'); }
        save();
        if (cfg.ia.on) iaScan(true);
      };
      const s = document.createElement('span');
      s.textContent = lb.name;
      l.append(i, s);
      el.appendChild(l);
    });
  };
  const renderIaSug = () => {
    const box = $('#wam-iasug');
    box.innerHTML = '';
    if (!iaSug.length) { box.textContent = 'No hay sugerencias pendientes.'; return; }
    iaSug.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'wam-iacard';
      const h = document.createElement('b');
      h.textContent = s.name;
      const q = document.createElement('div');
      q.className = 'wam-hint';
      q.textContent = 'Cliente: ' + s.lastText;
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.value = s.respuesta;
      card.append(h, q, ta);
      if (s.etiquetaId) {
        const tg = document.createElement('div');
        tg.className = 'wam-hint';
        tg.textContent = 'Etiqueta: ' + iaLabelName(s.etiquetaId);
        card.appendChild(tg);
      }
      const row = document.createElement('div');
      row.className = 'wam-row';
      const ok = document.createElement('button');
      ok.className = 'wam-btn';
      ok.textContent = 'Enviar';
      ok.onclick = async () => { ok.disabled = true; await iaApprove(s, ta.value); ok.disabled = false; };
      const no = document.createElement('button');
      no.className = 'wam-btn alt';
      no.textContent = 'Descartar';
      no.onclick = () => { iaSug = iaSug.filter((x) => x.chatId !== s.chatId); iaPersist(); renderIaSug(); };
      row.append(ok, no);
      card.appendChild(row);
      box.appendChild(card);
    });
  };
  const renderIaHuman = () => {
    const box = $('#wam-iahuman');
    box.innerHTML = '';
    if (!iaHuman.length) { box.textContent = 'Ninguno.'; return; }
    iaHuman.forEach((h) => {
      const d = document.createElement('div');
      d.className = 'wam-iahuman';
      const x = document.createElement('a');
      x.textContent = '×';
      x.title = 'Quitar de la lista';
      x.onclick = () => { iaHuman = iaHuman.filter((y) => y.chatId !== h.chatId); iaPersist(); renderIaHuman(); };
      const t = document.createElement('span');
      t.textContent = h.name + ' — ' + (h.motivo || 'requiere a una persona');
      d.append(x, t);
      box.appendChild(d);
    });
  };
  const syncIa = () => {
    renderIaRun();
    $('#iaReDias').value = cfg.ia.reDias;
    renderIaReLabels();
    renderIaKwChips();
    renderIaModos();
    $('#iaInstr').value = cfg.ia.instrucciones;
    renderIaTrain();
    $('#iaHorarioOn').checked = !!cfg.ia.horarioOn;
    $('#iaInicio').value = cfg.ia.inicio;
    $('#iaCierre').value = cfg.ia.cierre;
    renderIaHorario();
    panel.querySelectorAll('#wam-iamode button').forEach((b) => b.classList.toggle('on', b.dataset.m === cfg.ia.mode));
    renderIaLabels(); renderIaSug(); renderIaHuman();
  };

  // ----- acciones -----
  const iaApplyLabel = async (chatId, labelId, chatLabels) => {
    if (!labelId) return;
    const remove = cfg.ia.labels.filter((id) => id !== String(labelId) && (chatLabels || []).includes(id));
    try { await call('iaSetLabel', { chatId, add: String(labelId), remove }); } catch (e) { log('No se pudo etiquetar: ' + e.message, 'err'); }
  };
  // en plena conversación el cliente espera: "escribiendo…" apenas ~1 s (las pausas largas son solo para envíos masivos)
  const iaTyping = (t) => (cfg.typing ? Math.min(1500, 400 + String(t).length * 8) : 0);
  const iaDeliver = async (chat, text, labelId) => {
    await call('send', { to: chat.id, text, typingMs: iaTyping(text) });
    iaSentT[chat.id] = Math.floor(Date.now() / 1000); // para distinguir luego si una persona del equipo tomó el chat
    iaEngaged[chat.id] = true; // la IA continúa esta conversación aunque deje de ser "nueva"
    iaPersist();
    await iaApplyLabel(chat.id, labelId, chat.labels);
  };
  const iaApprove = async (s, text) => {
    const t = String(text || '').trim();
    if (!t) return;
    if (!lic.valid) return log('Licencia no válida', 'err');
    try {
      await iaDeliver({ id: s.chatId, labels: s.labels }, t, s.etiquetaId);
      iaSug = iaSug.filter((x) => x.chatId !== s.chatId);
      iaPersist(); renderIaSug();
      log('✓ IA (aprobada): ' + s.name, 'ok');
    } catch (e) {
      log('✗ No se pudo enviar a ' + s.name + ': ' + e.message, 'err');
    }
  };
  const iaAsk = (c) => new Promise((resolve) => {
    const mensajes = c.msgs.filter((m) => m.texto && m.texto.trim()).map((m) => ({ de: m.de, texto: m.texto, t: m.t }));
    chrome.runtime.sendMessage({
      type: 'wam-ia',
      payload: {
        token: lic.token, numero: lic.number, contacto: c.name, mensajes,
        es_nuevo: !!c.nuevo,
        etiquetas: cfg.ia.labels.map((id) => ({ id, nombre: iaLabelName(id) })),
        instrucciones: cfg.ia.instrAplicadas, // solo el entrenamiento ya aplicado con «Actualizar IA»
      },
    }, (x) => resolve(x || { error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'sin respuesta' }));
  });
  // ----- revisión de chats -----
  const iaInFlight = new Set(); // chats que se están consultando ahora (evita atender dos veces el mismo)
  // onlyIds: revisión RÁPIDA solo de los chats que acaban de recibir un mensaje (no recorre todos los chats)
  const iaScan = async (manual = false, onlyIds = null) => {
    const full = !onlyIds;
    if (full && iaBusy) { iaAgain = true; return; } // se repite apenas termine la revisión completa en curso
    if (!iaCanRun()) { if (manual) setIaStatus('Activa la IA y elige al menos una etiqueta.'); return; }
    const auto = cfg.ia.mode === 'auto';
    if (iaPausedDay === iaDay()) return setIaStatus('Se alcanzó el tope diario de consultas de IA. Continúa mañana.');
    if (auto && iaHorarioActivo() && !iaEnHorario()) return setIaStatus('Fuera del horario de trabajo (' + cfg.ia.inicio + '–' + cfg.ia.cierre + '). La IA retoma a las ' + cfg.ia.inicio + '.');
    if (full) iaBusy = true;
    let hayMas = false; // quedaron chats pendientes por el tope de consultas por revisión
    try {
      const st = await call('status');
      if (!st.ready) { setTimeout(() => iaScan(false), 5000); return setIaStatus('Esperando a que WhatsApp termine de cargar…'); }
      setIaStatus('Revisando chats…');
      const pet = iaPeticion();
      const cands = await call('iaCandidates', { scope: pet.scope, labelIds: cfg.ia.labels, limit: pet.limit, maxAgeSec: full ? cfg.ia.horas * 3600 : 0, incluir: Object.keys(iaEngaged), solo: onlyIds || undefined });
      let asked = 0;
      let nuevas = 0;
      let aviso = ''; // problema de esta revisión: se muestra en lugar del resumen
      for (const c of cands) {
        if (!iaCanRun()) break;
        if (iaInFlight.has(c.id)) continue; // ya se está atendiendo (revisión rápida y completa a la vez)
        const last = c.msgs[c.msgs.length - 1];
        if (iaPause[c.id] && iaPause[c.id] > Date.now()) continue; // una persona tomó este chat
        const enviadoIA = iaSentT[c.id];
        if (enviadoIA && c.msgs.some((m) => m.de === 'yo' && m.t > enviadoIA + 20)) {
          // alguien del equipo escribió después de la IA: la IA se aparta de este chat
          iaPause[c.id] = Date.now() + IA_PAUSE_MS;
          delete iaEngaged[c.id];
          log('IA en pausa 24 h en ' + c.name + ': una persona respondió');
          continue;
        }
        if (!last || last.de !== 'cliente') continue; // ya respondió el negocio
        if (cfg.ia.horas > 0 && Date.now() / 1000 - last.t > cfg.ia.horas * 3600) continue; // mensaje demasiado viejo (0 = sin límite)
        if ((iaSeen[c.id] || 0) >= last.t) continue; // ya atendido
        if (!iaCalifica(c)) continue; // no entra en ninguna modalidad activa
        if (asked >= IA_MAX_PER_SCAN) { hayMas = true; break; } // el resto sigue en la próxima revisión (que arranca enseguida)
        if (!last.texto || last.tipo !== 'chat') {
          iaAddHuman(c, 'El último mensaje no es de texto (foto, audio, sticker…)', last.t);
          iaSeen[c.id] = last.t;
          continue;
        }
        asked++;
        iaInFlight.add(c.id);
        try {
          const r = await iaAsk(c);
          if (r.status === 429) { iaPausedDay = iaDay(); aviso = 'Se alcanzó el tope diario de consultas de IA. Continúa mañana.'; break; }
          if (r.status !== 200 || !r.data) { aviso = 'La IA no respondió (' + (r.error || 'HTTP ' + r.status) + '). Se reintenta en la próxima revisión.'; break; }
          if (r.data.valida === false) { aviso = 'Licencia: ' + (LIC_REASONS[r.data.motivo] || 'no válida'); break; }
          iaSeen[c.id] = last.t;
          const d = r.data;
          if (d.sin_respuesta) continue; // la charla llegó a un cierre ("gracias", "ok"): no hay nada que contestar
          if (d.requiere_humano || !d.respuesta) { delete iaEngaged[c.id]; iaAddHuman(c, d.motivo || 'La IA prefirió que responda una persona', last.t); continue; }
          if (!auto) {
            iaSug = iaSug.filter((x) => x.chatId !== c.id);
            iaSug.unshift({ chatId: c.id, name: c.name, labels: c.labels, lastText: last.texto.slice(0, 200), respuesta: d.respuesta, etiquetaId: d.etiqueta_id || '', t: last.t });
            nuevas++;
            continue;
          }
          // automático: responde enseguida (el cliente está en plena conversación; las pausas son solo para envíos masivos)
          try {
            await iaDeliver(c, d.respuesta, d.etiqueta_id);
            iaCount = { day: iaDay(), n: iaToday() + 1 };
            log('✓ IA respondió a ' + c.name, 'ok');
          } catch (e) {
            iaAddHuman(c, 'No se pudo enviar la respuesta: ' + e.message, last.t);
            log('✗ IA no pudo responder a ' + c.name + ': ' + e.message, 'err');
          }
        } finally {
          iaInFlight.delete(c.id);
        }
      }
      iaPersist(); renderIaSug(); renderIaHuman();
      setIaStatus(aviso || 'IA activa (' + (auto ? 'automático' : 'sugerencia') + ') · ' + (auto ? 'respuestas hoy: ' + iaToday() + ' · ' : '') + 'sugerencias: ' + iaSug.length + ' · requieren persona: ' + iaHuman.length + (nuevas ? ' · ' + nuevas + ' nuevas' : ''));
    } catch (e) {
      setIaStatus('Error: ' + e.message);
    } finally {
      if (full) {
        iaBusy = false;
        if (iaAgain) { iaAgain = false; setTimeout(() => iaScan(false), 1500); }
        else if (hayMas) setTimeout(() => iaScan(false), 3000);
      }
    }
  };

  // Reacción inmediata: al llegar un mensaje se atiende ese chat en ~0,3 s (varios mensajes seguidos se juntan)
  let iaKickIds = new Set();
  const iaKick = (chatId) => {
    if (!iaCanRun()) return;
    if (chatId) iaKickIds.add(String(chatId));
    clearTimeout(iaKickT);
    iaKickT = setTimeout(() => { const ids = [...iaKickIds]; iaKickIds = new Set(); iaScan(false, ids.length ? ids : null); }, 300);
  };
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source === window && m && m.tag === TAG && m.dir === 'evt' && m.event === 'new_message') iaKick(m.chatId);
  });

  // ---------- IA: reactivar conversaciones por etiqueta (envío masivo con mensajes escritos por la IA) ----------
  // Usa el motor del envío masivo (intervalos, pausas, horario, límite diario, calentamiento): solo cambia que el texto
  // de cada contacto lo genera la IA leyendo los últimos 3 mensajes de esa conversación.
  let iaRe = []; // conversaciones encontradas
  const iaReStatus = (t) => { $('#wam-restatus').textContent = t; };
  const renderIaReLabels = () => {
    const el = $('#wam-relabels');
    el.innerHTML = '';
    if (!data.labels.length) { el.textContent = 'No hay etiquetas (requiere WhatsApp Business) o aún no se cargaron.'; return; }
    data.labels.forEach((lb) => {
      const l = document.createElement('label');
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = cfg.ia.reLabels.includes(String(lb.id));
      i.onchange = () => {
        const id = String(lb.id);
        cfg.ia.reLabels = i.checked ? [...new Set([...cfg.ia.reLabels, id])] : cfg.ia.reLabels.filter((x) => x !== id);
        iaRe = [];
        iaReStatus('Cambiaste las etiquetas: vuelve a buscar las conversaciones.');
        save();
      };
      const sp = document.createElement('span');
      sp.textContent = lb.name;
      l.append(i, sp);
      el.appendChild(l);
    });
  };
  const iaReBuscar = async () => {
    if (!cfg.ia.reLabels.length) { iaRe = []; iaReStatus('Elige al menos una etiqueta.'); return false; }
    iaReStatus('Buscando conversaciones…');
    try {
      const st = await call('status');
      if (!st.ready) { iaReStatus('Esperando a que WhatsApp termine de cargar…'); return false; }
      const lista = await call('iaReactivar', { labelIds: cfg.ia.reLabels, dias: cfg.ia.reDias, limit: 500 });
      // no se insiste con quien ya recibió una reactivación hace poco
      const espera = Math.max(cfg.ia.reDias, 7) * 86400000;
      iaRe = lista.filter((c) => !(iaReSent[c.id] && Date.now() - iaReSent[c.id] < espera));
      const omit = lista.length - iaRe.length;
      iaReStatus(iaRe.length + ' conversación(es) para reactivar: sin respuesta desde hace ' + cfg.ia.reDias + '+ día(s)' + (omit ? ' (' + omit + ' omitida(s): ya se les escribió hace poco)' : '') + '.');
      return true;
    } catch (e) {
      iaReStatus('Error: ' + e.message);
      return false;
    }
  };
  // Genera el mensaje de un contacto con la IA. Devuelve { text, etiqueta } | { skip } | { error }
  const iaReactivarGen = async (r) => {
    const mensajes = (r.ctx || []).filter((m) => m.texto && m.texto.trim()).slice(-3).map((m) => ({ de: m.de, texto: m.texto, t: m.t }));
    if (!mensajes.length) return { skip: 'no hay mensajes de texto para darle contexto a la IA' };
    const resp = await new Promise((resolve) => chrome.runtime.sendMessage({
      type: 'wam-ia',
      payload: {
        token: lic.token, numero: lic.number, modo: 'reactivar', contacto: r.name, mensajes,
        etiquetas: cfg.ia.labels.map((id) => ({ id, nombre: iaLabelName(id) })),
        instrucciones: cfg.ia.instrAplicadas,
      },
    }, (x) => resolve(x || { error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'sin respuesta' })));
    if (resp.status === 429) return { error: 'Se alcanzó el tope diario de consultas de IA' };
    if (resp.status !== 200 || !resp.data) return { error: 'La IA no respondió (' + (resp.error || 'HTTP ' + resp.status) + ')' };
    if (resp.data.valida === false) return { error: 'Licencia: ' + (LIC_REASONS[resp.data.motivo] || 'no válida') };
    if (resp.data.sin_respuesta || !resp.data.respuesta) return { skip: resp.data.motivo || 'la IA no recomienda escribirle' };
    return { text: resp.data.respuesta, etiqueta: resp.data.etiqueta_id || '' };
  };
  // opciones para el motor del envío masivo (también al reanudar una reactivación pendiente)
  const iaReOpts = (queue) => ({
    queue,
    gen: iaReactivarGen,
    onSent: (r) => { iaReSent[r.id] = Date.now(); iaPersist(); },
  });
  const iaReIniciar = async () => {
    if (cfg.ia.on) return iaReStatus('La IA está en marcha: pausa la IA para hacer la reactivación. Solo puede funcionar una de las dos a la vez.');
    if (run.state === 'running') return iaReStatus('Ya hay un envío en curso. Espera a que termine o deténlo.');
    if (!cfg.ia.consent && !confirm('El texto de las conversaciones se enviará a un servicio de IA para escribir los mensajes. ¿Continuar?')) return;
    cfg.ia.consent = true; save();
    if (!(await iaReBuscar()) || !iaRe.length) { if (!iaRe.length) iaReStatus('No hay conversaciones para reactivar con esos criterios.'); return; }
    const queue = iaRe.map((c) => ({ id: c.id, name: c.name, labels: c.labels, ctx: c.msgs }));
    start(false, iaReOpts(queue));
  };

  // ----- controles -----
  const iaStart = () => {
    if (cfg.ia.on) return;
    if (run.state === 'running') { iaWarn('Hay un envío masivo en curso: espera a que termine o detenlo para iniciar la IA. Solo puede funcionar una de las dos a la vez.'); return; }
    if (!iaModosActivos().length) { iaWarn('Activa al menos una modalidad (por etiquetas, palabras claves, todos los chats…).'); return; }
    if (!cfg.ia.labels.length) { iaWarn('Primero elige al menos una etiqueta que usará la IA.'); return; }
    if (cfg.ia.modos.palabras && !iaKeywords().length) { iaWarn('Escribe al menos una palabra clave (o apaga la modalidad «Por palabras claves»).'); return; }
    if (cfg.ia.modos.todos && cfg.ia.mode === 'auto' && !confirm('Con «Para todos los chats» el asistente responderá solo a TODAS las conversaciones individuales con respuesta pendiente, incluso antiguas. Conviene probar antes en modo Sugerencia. ¿Iniciarlo igual?')) return;
    if (!lic.valid) { iaWarn('La licencia no está activa.'); return; }
    if (!cfg.ia.consent && !confirm('Las conversaciones con respuesta pendiente se enviarán a un servicio de IA para generar las respuestas. ¿Continuar?')) return;
    if (cfg.ia.mode === 'auto' && !confirm('En modo automático la IA responderá sola a tus clientes. ¿Iniciarla?')) return;
    cfg.ia.consent = true;
    iaWarn('');
    cfg.ia.on = true;
    save();
    renderIaRun();
    setIaStatus('IA iniciada. Revisando chats…');
    iaScan(true); // se pone a trabajar de inmediato
  };
  const iaPauseNow = () => {
    if (!cfg.ia.on) return;
    cfg.ia.on = false;
    save();
    renderIaRun();
    setIaStatus('IA en pausa: no responde hasta que pulses «Iniciar IA». Lo que ya estaba en curso termina.');
  };
  $('#wam-iastart').onclick = iaStart;
  $('#wam-iapause').onclick = iaPauseNow;
  panel.querySelectorAll('#wam-iamode button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.m === cfg.ia.mode) return;
      if (b.dataset.m === 'auto' && cfg.ia.on && !confirm('En modo automático la IA responderá sola a tus clientes. ¿Cambiar?')) return;
      cfg.ia.mode = b.dataset.m;
      save();
      syncIa();
      if (cfg.ia.on) iaScan(true);
    };
  });
  const iaHorarioCambio = () => { save(); renderIaHorario(); if (cfg.ia.on) iaScan(true); };
  $('#iaHorarioOn').onchange = (e) => { cfg.ia.horarioOn = e.target.checked; iaHorarioCambio(); };
  $('#iaInicio').onchange = (e) => { if (iaMin(e.target.value) !== null) cfg.ia.inicio = e.target.value; else e.target.value = cfg.ia.inicio; iaHorarioCambio(); };
  $('#iaCierre').onchange = (e) => { if (iaMin(e.target.value) !== null) cfg.ia.cierre = e.target.value; else e.target.value = cfg.ia.cierre; iaHorarioCambio(); };
  $('#iaReDias').onchange = (e) => { const v = Number(e.target.value); cfg.ia.reDias = e.target.value !== '' && Number.isFinite(v) ? Math.min(3650, Math.max(0, Math.round(v))) : 3; e.target.value = cfg.ia.reDias; iaRe = []; save(); };
  $('#wam-rebuscar').onclick = () => iaReBuscar();
  $('#wam-reiniciar').onclick = () => iaReIniciar();
  $('#wam-repausa').onclick = () => bulkPause();
  $('#wam-redetener').onclick = () => bulkStop();
  $('#iaInstr').oninput = (e) => { cfg.ia.instrucciones = e.target.value.slice(0, 3000); save(); renderIaTrain(); };
  $('#wam-iaupdate').onclick = () => {
    if (!iaTrainDirty()) return;
    const pend = iaSug.length + iaHuman.length;
    if (pend && !confirm('La IA volverá a revisar los chats pendientes con el nuevo entrenamiento: se descartan las ' + iaSug.length + ' sugerencia(s) actuales y se reevalúan los ' + iaHuman.length + ' chat(s) que necesitaban a una persona. ¿Actualizar?')) return;
    cfg.ia.instrAplicadas = cfg.ia.instrucciones;
    [...iaSug, ...iaHuman].forEach((x) => { delete iaSeen[x.chatId]; }); // se vuelven a consultar con lo nuevo
    iaSug = []; iaHuman = [];
    save(); iaPersist(); renderIaSug(); renderIaHuman(); renderIaTrain(); iaWarn('');
    setIaStatus('IA actualizada con el nuevo entrenamiento.' + (cfg.ia.on ? ' Revisando chats…' : ''));
    if (cfg.ia.on) iaScan(true);
  };
  $('#wam-ianow').onclick = () => iaScan(true);
  setInterval(() => iaScan(false), IA_SCAN_MS);

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
  chrome.storage.local.get('wamIa').then(({ wamIa }) => {
    if (!wamIa) return;
    iaSeen = wamIa.seen || {}; iaSug = Array.isArray(wamIa.sug) ? wamIa.sug : []; iaHuman = Array.isArray(wamIa.human) ? wamIa.human : [];
    iaCount = wamIa.count || iaCount;
    iaEngaged = wamIa.engaged || {}; iaSentT = wamIa.sentT || {}; iaPause = wamIa.pause || {}; iaReSent = wamIa.reSent || {};
    renderIaSug(); renderIaHuman();
  });
  chrome.storage.local.get('wamLog').then(({ wamLog }) => { if (Array.isArray(wamLog)) sendLog = wamLog; renderMetrics(); });
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
    cfg.ia = { ...DEFAULTS.ia, ...(wamCfg && wamCfg.ia ? wamCfg.ia : {}) };
    if (!Array.isArray(cfg.ia.labels)) cfg.ia.labels = [];
    if (!Array.isArray(cfg.ia.reLabels)) cfg.ia.reLabels = [];
    cfg.ia.reLabels = cfg.ia.reLabels.map(String);
    { const d = Number(cfg.ia.reDias); cfg.ia.reDias = Number.isFinite(d) ? Math.min(3650, Math.max(0, d)) : 3; }
    if (iaMin(cfg.ia.inicio) === null) cfg.ia.inicio = '08:00';
    if (iaMin(cfg.ia.cierre) === null) cfg.ia.cierre = '20:00';
    { // configuraciones anteriores: alcance único (etiquetas / nuevos / palabras) + interruptor de palabras -> modalidades
      const g = wamCfg && wamCfg.ia ? wamCfg.ia : {};
      if (g.modos && typeof g.modos === 'object') cfg.ia.modos = { ...DEFAULTS.ia.modos, ...g.modos };
      else cfg.ia.modos = { etiquetas: g.scope !== 'nuevos' && g.scope !== 'palabras', nuevos: g.scope === 'nuevos', palabras: g.scope === 'palabras' || !!g.kwExtra, todos: false, noLeidos: false };
    }
    { const h = Number(cfg.ia.horas); cfg.ia.horas = Number.isFinite(h) ? Math.min(720, Math.max(0, h)) : 0; }
    if (!cfg.ia.horasEditada) cfg.ia.horas = 0; // por defecto sin límite: revisa todas las conversaciones pendientes y responde según el contexto
    if (typeof cfg.ia.instrAplicadas !== 'string') cfg.ia.instrAplicadas = cfg.ia.instrucciones || ''; // entrenamiento ya aplicado (versiones anteriores)
    cfg.ia.labels = cfg.ia.labels.map(String);
    syncIa();
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
      if (st.ready) { clearInterval(poll); refreshData(); checkLicense().then(() => iaScan(false)); }
      else if (!diagShown && Date.now() - t0 > 25000) {
        diagShown = true;
        log(`WhatsApp no termina de cargar la librería interna (WPP=${st.hasWPP}, isReady=${st.isReady}, isFullReady=${st.isFullReady}, inyectada=${st.injected}, cargador=${st.loaderType}, globales=[${st.has}], otras=[${st.keys}], WhatsApp Web ${st.waVersion || '?'}, librería ${st.version || '?'}). Recarga la página con Ctrl+Shift+R.`, 'err');
      }
    } catch {}
  }, 2000);
})();

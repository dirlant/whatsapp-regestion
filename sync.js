// Sincroniza los archivos de la extensión con el repositorio de GitHub, escribiendo directamente en la carpeta
// donde está instalada (la persona la elige una vez). Luego recarga la extensión.
(() => {
  const REPO = 'dirlant/whatsapp-regestion';
  const $ = (s) => document.querySelector(s);
  // no se sincronizan: dotfiles, documentación y ejemplos
  const OMITIR = (p) => p.startsWith('ejemplo/') || p.split('/').some((x) => x.startsWith('.')) || /\.md$/i.test(p);

  const log = (t, cls = '') => {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = t;
    $('#log').appendChild(d);
    $('#log').scrollTop = $('#log').scrollHeight;
  };

  // ----- carpeta elegida: se guarda en IndexedDB para no pedirla otra vez -----
  const db = () => new Promise((res, rej) => {
    const r = indexedDB.open('wamSync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const dbGet = async () => { const d = await db(); return new Promise((res) => { const q = d.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); };
  const dbSet = async (h) => { const d = await db(); return new Promise((res, rej) => { const q = d.transaction('h', 'readwrite').objectStore('h').put(h, 'dir'); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); };

  let dir = null;
  const version = chrome.runtime.getManifest().version;
  $('#ver').textContent = version;

  const mostrarCarpeta = () => {
    $('#carpeta').textContent = dir ? 'Carpeta de la extensión: ' + dir.name : 'Carpeta de la extensión: aún no elegida.';
    $('#sync').disabled = !dir;
    $('#elegir').textContent = dir ? 'Cambiar carpeta' : 'Elegir carpeta de la extensión';
  };

  // ----- utilidades de archivos -----
  const subdir = async (root, partes, create) => { let d = root; for (const p of partes) d = await d.getDirectoryHandle(p, { create }); return d; };
  const leerLocal = async (root, ruta) => {
    try {
      const partes = ruta.split('/'); const nombre = partes.pop();
      const fh = await (await subdir(root, partes, false)).getFileHandle(nombre);
      return await (await fh.getFile()).arrayBuffer();
    } catch { return null; }
  };
  const escribirLocal = async (root, ruta, buf) => {
    const partes = ruta.split('/'); const nombre = partes.pop();
    const fh = await (await subdir(root, partes, true)).getFileHandle(nombre, { create: true });
    const w = await fh.createWritable();
    await w.write(buf);
    await w.close();
  };
  // SHA-1 como lo calcula git para un archivo (para saber si cambió y comprobar la descarga)
  const gitSha = async (buf) => {
    const head = new TextEncoder().encode('blob ' + buf.byteLength + '\0');
    const all = new Uint8Array(head.length + buf.byteLength);
    all.set(head); all.set(new Uint8Array(buf), head.length);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const api = async (url) => {
    const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (r.status === 403 || r.status === 429) throw new Error('GitHub limitó las consultas por un rato. Intenta de nuevo en unos minutos.');
    if (!r.ok) throw new Error('GitHub respondió ' + r.status);
    return r.json();
  };

  // ----- elegir carpeta -----
  $('#elegir').onclick = async () => {
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      const m = await leerLocal(h, 'manifest.json');
      let ok = false;
      try { ok = !!m && JSON.parse(new TextDecoder().decode(m)).name === chrome.runtime.getManifest().name; } catch {}
      if (!ok) { log('Esa carpeta no parece ser la de esta extensión (no tiene su manifest.json). Elige la carpeta que cargaste en chrome://extensions.', 'err'); return; }
      dir = h;
      await dbSet(h);
      mostrarCarpeta();
      log('Carpeta lista. Pulsa «Actualizar ahora».', 'ok');
    } catch (e) {
      if (e && e.name !== 'AbortError') log('No se pudo abrir la carpeta: ' + e.message, 'err');
    }
  };

  // ----- sincronizar -----
  $('#sync').onclick = async () => {
    const btn = $('#sync');
    btn.disabled = true;
    try {
      if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Sin permiso para escribir en la carpeta.');
      log('Consultando GitHub…');
      const commit = await api('https://api.github.com/repos/' + REPO + '/commits/main');
      const arbol = await api('https://api.github.com/repos/' + REPO + '/git/trees/' + commit.sha + '?recursive=1');
      if (arbol.truncated) throw new Error('El repositorio es demasiado grande para sincronizarlo así.');
      const archivos = arbol.tree.filter((x) => x.type === 'blob' && !OMITIR(x.path));
      const cambiados = [];
      for (const f of archivos) {
        const local = await leerLocal(dir, f.path);
        if (!local || (await gitSha(local)) !== f.sha) cambiados.push(f);
      }
      if (!cambiados.length) { log('Ya estás al día (versión ' + version + ').', 'ok'); return; }
      log(cambiados.length + ' archivo(s) por actualizar: ' + cambiados.map((f) => f.path).join(', '));
      // se descarga todo y se verifica ANTES de escribir: si algo falla, la extensión queda como estaba
      const bajados = [];
      for (const f of cambiados) {
        const url = 'https://raw.githubusercontent.com/' + REPO + '/' + commit.sha + '/' + f.path.split('/').map(encodeURIComponent).join('/');
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('No se pudo descargar ' + f.path + ' (' + r.status + ')');
        const buf = await r.arrayBuffer();
        if ((await gitSha(buf)) !== f.sha) throw new Error('La descarga de ' + f.path + ' llegó incompleta. Intenta de nuevo.');
        bajados.push({ ruta: f.path, buf });
      }
      // manifest.json al final: la versión nueva solo "existe" cuando ya están todos los demás archivos
      bajados.sort((a, b) => (a.ruta === 'manifest.json') - (b.ruta === 'manifest.json'));
      for (const f of bajados) { await escribirLocal(dir, f.ruta, f.buf); log('✓ ' + f.ruta, 'ok'); }
      log('Actualizado. Recargando la extensión… después recarga WhatsApp Web (Ctrl+Shift+R).', 'ok');
      setTimeout(() => chrome.runtime.reload(), 1800);
    } catch (e) {
      log('✗ ' + e.message, 'err');
    } finally {
      btn.disabled = !dir;
    }
  };

  // ----- inicio -----
  (async () => {
    try { dir = await dbGet(); } catch {}
    mostrarCarpeta();
    if (dir) log('Carpeta recordada. Pulsa «Actualizar ahora» (Chrome puede pedirte confirmar el permiso).');
  })();
})();

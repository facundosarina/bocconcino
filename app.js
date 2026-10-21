'use strict';
/* Bocconcino — diario alimentare con foto. Tutti i dati restano sul telefono. */

const VERSIONE = '1.1.0';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MODELLI_BASE = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/* ================= Utilità ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
const arr1 = n => Math.round(n * 10) / 10;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daChiave = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const piuGiorni = (k, n) => { const d = daChiave(k); d.setDate(d.getDate() + n); return dkey(d); };
const oggi = () => dkey(new Date());
const oraAdesso = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ================= Lingua ================= */
function linguaDelTelefono() {
  for (const l of navigator.languages || [navigator.language || '']) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (LINGUE[c]) return c;
  }
  return 'it';
}
const L = () => LINGUE[S.lingua] || LINGUE.it;
function t(chiave, valori = {}) {
  const v = (TESTI[S.lingua] || TESTI.it)[chiave] ?? TESTI.it[chiave] ?? chiave;
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => valori[k] ?? '') : v;
}
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(L().locale, { maximumFractionDigits: d });
const perCampo = n => (n ? String(arr1(n)).replace('.', L().decimale) : '');
const data = (k, opz) => daChiave(k).toLocaleDateString(L().locale, opz);

function applicaLingua() {
  document.documentElement.lang = S.lingua;
  $('.tab[data-view="oggi"] span').textContent = t('tabOggi');
  $('.tab[data-view="settimana"] span').textContent = t('tabSettimana');
  $('.fab').setAttribute('aria-label', t('aggiungiAria'));
}

const TIPI = [
  { id: 'colazione', ora: '08:00' },
  { id: 'pranzo', ora: '13:00' },
  { id: 'spuntino', ora: '16:30' },
  { id: 'cena', ora: '20:00' },
];
const tipoNome = id => t('tipo_' + (TIPI.some(x => x.id === id) ? id : 'pranzo'));
const tipoOra = id => (TIPI.find(x => x.id === id) || TIPI[1]).ora;
const tipoDaOra = (d = new Date()) => { const h = d.getHours() + d.getMinutes() / 60; return h < 11 ? 'colazione' : h < 15.5 ? 'pranzo' : h < 18.5 ? 'spuntino' : 'cena'; };

/* ================= Impostazioni ================= */
const PREDEFINITE = {
  lingua: '', nome: '', apiKey: '', modelli: [],
  obiettivi: { kcal: 1800, proteine: 90, carboidrati: 220, grassi: 60 },
  acquaObiettivo: 8, benvenuto: false,
};
function caricaImpostazioni() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('bocconcino.impostazioni') || '{}') || {}; } catch {}
  const out = { ...PREDEFINITE, ...s, obiettivi: { ...PREDEFINITE.obiettivi, ...(s.obiettivi || {}) } };
  if (!LINGUE[out.lingua]) out.lingua = linguaDelTelefono();
  return out;
}
function salvaImpostazioni() {
  try { localStorage.setItem('bocconcino.impostazioni', JSON.stringify(S)); }
  catch { avviso(t('impNonSalvate')); }
}
let S = caricaImpostazioni();

/* ================= Database (IndexedDB) ================= */
const DB = (() => {
  let dbp;
  function apri() {
    if (dbp) return dbp;
    dbp = new Promise((ok, ko) => {
      const r = indexedDB.open('bocconcino', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const p = db.createObjectStore('pasti', { keyPath: 'id' });
        p.createIndex('data', 'data');
        db.createObjectStore('giorni', { keyPath: 'data' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await apri();
    return new Promise((ok, ko) => {
      const tr = db.transaction(store, mode);
      let out;
      const r = fn(tr.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      tr.oncomplete = () => ok(out);
      tr.onerror = () => ko(tr.error);
      tr.onabort = () => ko(tr.error);
    });
  }
  return {
    metti: (st, v) => tx(st, 'readwrite', s => s.put(v)),
    togli: (st, k) => tx(st, 'readwrite', s => s.delete(k)),
    prendi: (st, k) => tx(st, 'readonly', s => s.get(k)),
    tutti: st => tx(st, 'readonly', s => s.getAll()),
    delGiorno: d => tx('pasti', 'readonly', s => s.index('data').getAll(d)),
    intervallo: (a, b) => tx('pasti', 'readonly', s => s.index('data').getAll(IDBKeyRange.bound(a, b))),
    svuota: st => tx(st, 'readwrite', s => s.clear()),
  };
})();

const somma = pasti => pasti.reduce((tot, p) => {
  for (const a of p.alimenti || []) {
    tot.kcal += num(a.kcal); tot.proteine += num(a.proteine); tot.carboidrati += num(a.carboidrati); tot.grassi += num(a.grassi);
  }
  return tot;
}, { kcal: 0, proteine: 0, carboidrati: 0, grassi: 0 });

/* ================= Bocco, la mascotte ================= */
function bocco(umore = 'felice') {
  const INK = '#43233F';
  const occhio = (x, y, r = 5.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${x + 1.8}" cy="${y - 2}" r="${r / 3}" fill="#fff"/>`;
  const tratto = d => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  let viso;
  switch (umore) {
    case 'wow':
      viso = occhio(44, 62, 7) + occhio(76, 62, 7) + `<ellipse cx="60" cy="78" rx="5" ry="6" fill="${INK}"/><ellipse cx="60" cy="80" rx="3" ry="2.6" fill="#FF7C9A"/>`;
      break;
    case 'assonnato':
      viso = tratto('M38 64q6 5 12 0') + tratto('M70 64q6 5 12 0') + tratto('M56 76q4 3 8 0')
        + `<text x="92" y="30" font-size="14" font-weight="800" fill="${INK}" font-family="sans-serif">z</text><text x="102" y="18" font-size="10" font-weight="800" fill="${INK}" font-family="sans-serif">z</text>`;
      break;
    case 'pensa':
      viso = occhio(47, 59) + occhio(79, 59) + tratto('M55 77h10')
        + `<circle cx="104" cy="34" r="3" fill="${INK}"/><circle cx="111" cy="24" r="4.5" fill="${INK}"/>`;
      break;
    case 'confuso':
      viso = occhio(44, 63, 4.5) + occhio(76, 62, 6.5) + tratto('M51 78q2.25-3 4.5 0t4.5 0t4.5 0t4.5 0')
        + `<path d="M98 40c4 5 4 9 0 11c-4-2-4-6 0-11z" fill="#9FD3F7" stroke="${INK}" stroke-width="2"/>`;
      break;
    default:
      viso = occhio(44, 63) + occhio(76, 63) + tratto('M53 73q3.5 5 7 0q3.5 5 7 0');
  }
  return `<svg class="bocco" viewBox="0 0 120 112" aria-hidden="true"><g class="bocco-corpo">
    <path d="M60 22C52 13 52 6 57 2c5 5 6 12 3 20z" fill="#5EC496" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M61 22c6-9 15-11 21-8-5 7-12 10-21 8z" fill="#8FDDB7" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M60 20C93 20 112 44 112 70c0 25-21 36-52 36S8 95 8 70C8 44 27 20 60 20z" fill="#FFFDFB" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="31" cy="76" rx="9" ry="5.5" fill="#FF9BB8"/><ellipse cx="89" cy="76" rx="9" ry="5.5" fill="#FF9BB8"/>
    ${viso}</g></svg>`;
}

/* ================= Icone ================= */
const ICONE = {
  sx: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  dx: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  ingranaggio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/><circle cx="12" cy="12" r="6.6"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.5"/></svg>',
  galleria: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  matita: '<svg viewBox="0 0 24 24"><path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/></svg>',
  numeri: '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3"/></svg>',
};

/* ================= Interfaccia generale ================= */
const stato = { vista: 'oggi', giorno: oggi(), fineSettimana: oggi(), occupato: false, festa: false };
let bozza = null;

function avviso(testo) {
  const el = $('#toast');
  el.textContent = testo;
  el.classList.add('visibile');
  clearTimeout(avviso.timer);
  avviso.timer = setTimeout(() => el.classList.remove('visibile'), 2600);
}

function vai(vista) {
  stato.vista = vista;
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + vista; });
  $$('.tab').forEach(tb => { if (tb.dataset.view === vista) tb.setAttribute('aria-current', 'page'); else tb.removeAttribute('aria-current'); });
  disegna();
  window.scrollTo(0, 0);
}

function disegna() {
  if (stato.vista === 'oggi') return disegnaOggi();
  if (stato.vista === 'settimana') return disegnaSettimana();
  return disegnaImpostazioni();
}

function apriSheet(html, titoloAccessibile) {
  const sh = $('#sheet');
  $('#sheet-corpo').innerHTML = html;
  sh.hidden = false;
  document.body.style.overflow = 'hidden';
  const pannello = $('.sheet-pannello', sh);
  pannello.scrollTop = 0;
  if (!$('#sheet-titolo', sh)) pannello.setAttribute('aria-label', titoloAccessibile || 'Bocconcino');
  else pannello.removeAttribute('aria-label');
}
function chiudiSheet() {
  if (stato.occupato) return;
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  bozza = null;
}
function chiudiSheetForzato() { stato.occupato = false; if (!$('#sheet').hidden) chiudiSheet(); }

function sceltaLingua(nomeGruppo) {
  return `<div class="scelte" role="radiogroup" aria-label="${esc(t('lingua'))}">${Object.entries(LINGUE).map(([c, l]) =>
    `<label class="scelta"><input type="radio" name="${nomeGruppo}" value="${c}" ${c === S.lingua ? 'checked' : ''}><span lang="${c}">${l.nome}</span></label>`).join('')}</div>`;
}

/* ================= Vista: Oggi ================= */
function titoloGiorno(k) {
  if (k === oggi()) return t('oggi');
  if (k === piuGiorni(oggi(), -1)) return t('ieri');
  return cap(data(k, { weekday: 'long', day: 'numeric', month: 'long' }));
}

function anello(val, obiettivo) {
  const r = 50, c = 2 * Math.PI * r;
  const p = Math.min(1, obiettivo ? val / obiettivo : 0);
  return `<div class="anello" role="img" aria-label="${esc(t('anelloAria', { v: fmt(val), g: fmt(obiettivo) }))}">
    <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${r}" class="anello-traccia"/>
    <circle cx="60" cy="60" r="${r}" class="anello-pieno" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 60 60)"/></svg>
    <div class="anello-testo"><strong>${fmt(val)}</strong><span>${esc(t('anelloDi', { g: fmt(obiettivo) }))}</span></div></div>`;
}

function barra(nome, val, obiettivo, cls) {
  const p = obiettivo ? Math.min(100, val / obiettivo * 100) : 0;
  return `<div class="macro ${cls}"><div class="macro-riga"><span>${esc(nome)}</span><span><b>${fmt(val)}</b><span class="unita"> / ${fmt(obiettivo)} g</span></span></div>
    <div class="macro-barra"><i style="width:${p.toFixed(1)}%"></i></div></div>`;
}

function bicchiere(pieno) {
  return `<svg viewBox="0 0 28 34" aria-hidden="true"><path class="b-coppa" d="M4 3h20l-2.6 27a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z"/>${pieno ? '<path class="b-acqua" d="M5.6 11h16.8l-2 19.2a1 1 0 0 1-1 .8H8.6a1 1 0 0 1-1-.8z"/>' : ''}<path class="b-bordo" d="M4 3h20l-2.6 27a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z"/></svg>`;
}

function infoMacro(tot) {
  const [p, c, g] = t('lettere');
  return `<span class="punto p">${p} ${fmt(tot.proteine)} g</span><span class="punto c">${c} ${fmt(tot.carboidrati)} g</span><span class="punto g">${g} ${fmt(tot.grassi)} g</span>`;
}

function rigaPasto(p) {
  const tot = somma([p]);
  const mini = p.foto
    ? `<img class="miniatura" src="${p.foto}" alt="">`
    : `<span class="miniatura vuota" aria-hidden="true">${esc((p.nome || '?').charAt(0).toUpperCase())}</span>`;
  return `<button class="pasto" data-act="apri-pasto" data-id="${esc(p.id)}">${mini}
    <span><span class="pasto-nome">${esc(p.nome || t('pasto'))}</span><span class="pasto-info"><span>${esc(p.ora || '')}</span>${infoMacro(tot)}</span></span>
    <span class="pasto-kcal">${fmt(tot.kcal)}<small>kcal</small></span></button>`;
}

function messaggioBocco(pasti, k) {
  const n = S.nome ? `, ${esc(S.nome)}` : '';
  if (!S.apiKey) return {
    umore: 'pensa',
    html: `<p>${t('msgNoChiave', { n })}</p><button class="btn piccolo primario" data-act="vai" data-view="impostazioni">${esc(t('configuraChiave'))}</button>`,
  };
  if (!pasti.length) {
    if (k !== oggi()) return { umore: 'assonnato', html: `<p>${esc(t('vuotoPassato'))}</p>` };
    return { umore: 'felice', html: `<p>${t('saluto_' + tipoDaOra(), { n })}</p>` };
  }
  const ultimo = [...pasti].sort((a, b) => (b.creato || 0) - (a.creato || 0))[0];
  return { umore: stato.festa ? 'wow' : 'felice', html: `<p>${esc(ultimo.commento || t('tuttoSegnato'))}</p>` };
}

async function disegnaOggi() {
  const k = stato.giorno;
  const [pasti, giorno] = await Promise.all([DB.delGiorno(k), DB.prendi('giorni', k)]);
  pasti.sort((a, b) => (a.ora || '').localeCompare(b.ora || ''));
  const acqua = giorno?.acqua || 0;
  const tot = somma(pasti);
  const O = S.obiettivi;
  const resto = Math.round(O.kcal - tot.kcal);
  const eOggi = k === oggi();
  const msg = messaggioBocco(pasti, k);

  const gruppi = TIPI.map(tp => {
    const ps = pasti.filter(p => p.tipo === tp.id);
    if (!ps.length) return '';
    return `<section class="gruppo"><h3>${esc(tipoNome(tp.id))}<span>${fmt(somma(ps).kcal)} kcal</span></h3>
      <div class="adesivo lista">${ps.map(rigaPasto).join('')}</div></section>`;
  }).join('');

  const nBicchieri = Math.max(1, Math.min(16, S.acquaObiettivo || 8));
  const bicchieri = Array.from({ length: Math.max(nBicchieri, acqua) }, (_, i) =>
    `<button class="bicchiere" data-act="acqua" data-n="${i + 1}" aria-label="${esc(i ? t('bicchieri', { n: i + 1 }) : t('bicchiere1'))}" aria-pressed="${i < acqua}">${bicchiere(i < acqua)}</button>`).join('');

  const testoResto = resto >= 0
    ? t(eOggi ? 'restaOggi' : 'restaGiorno', { n: fmt(resto) })
    : t(eOggi ? 'oltreOggi' : 'oltreGiorno', { n: fmt(-resto) });

  $('#view-oggi').innerHTML = `
    <header class="testata">
      <button class="tondo" data-act="giorno" data-d="-1" aria-label="${esc(t('giornoPrec'))}">${ICONE.sx}</button>
      <h1>${esc(titoloGiorno(k))}</h1>
      <button class="tondo" data-act="giorno" data-d="1" aria-label="${esc(t('giornoSucc'))}" ${k >= oggi() ? 'disabled' : ''}>${ICONE.dx}</button>
      <button class="tondo" data-act="vai" data-view="impostazioni" aria-label="${esc(t('impostazioni'))}">${ICONE.ingranaggio}</button>
    </header>

    <div class="saluto ${stato.festa ? 'festa' : ''}">${bocco(msg.umore)}<div class="nuvoletta">${msg.html}</div></div>

    <div class="adesivo giornata">
      ${anello(tot.kcal, O.kcal)}
      <div>
        ${barra(t('proteine'), tot.proteine, O.proteine, 'm-p')}
        ${barra(t('carboidrati'), tot.carboidrati, O.carboidrati, 'm-c')}
        ${barra(t('grassi'), tot.grassi, O.grassi, 'm-g')}
      </div>
      <p class="resta">${testoResto}</p>
    </div>

    <div class="adesivo acqua">
      <div class="acqua-testa"><h2>${esc(t('acqua'))}</h2><span>${esc(t('acquaDi', { a: fmt(acqua * 0.25, 2), b: fmt(nBicchieri * 0.25, 2) }))}</span></div>
      <div class="bicchieri">${bicchieri}</div>
    </div>

    <h2 class="titolo-sezione">${esc(t('pasti'))}</h2>
    ${gruppi || `<div class="adesivo vuoto"><p>${esc(t('nessunPasto'))}</p><button class="btn primario" data-act="aggiungi">${esc(t('aggiungiPasto'))}</button></div>`}
  `;
  stato.festa = false;
}

async function impostaAcqua(n) {
  const k = stato.giorno;
  const g = (await DB.prendi('giorni', k)) || { data: k, acqua: 0 };
  g.acqua = g.acqua === n ? n - 1 : n;
  await DB.metti('giorni', g);
  disegnaOggi();
}

/* ================= Vista: Settimana ================= */
async function disegnaSettimana() {
  const fine = stato.fineSettimana;
  const inizio = piuGiorni(fine, -6);
  const giorni = Array.from({ length: 7 }, (_, i) => piuGiorni(inizio, i));
  const [pasti, tuttiGiorni] = await Promise.all([DB.intervallo(inizio, fine), DB.tutti('giorni')]);
  const perGiorno = giorni.map(k => {
    const ps = pasti.filter(p => p.data === k);
    return { k, ...somma(ps), n: ps.length, acqua: (tuttiGiorni.find(g => g.data === k) || {}).acqua || 0 };
  });
  const conPasti = perGiorno.filter(g => g.n > 0);
  const media = f => conPasti.length ? conPasti.reduce((s, g) => s + g[f], 0) / conPasti.length : 0;
  const conAcqua = perGiorno.filter(g => g.acqua > 0);
  const mediaAcqua = conAcqua.length ? conAcqua.reduce((s, g) => s + g.acqua, 0) / conAcqua.length * 0.25 : 0;

  const O = S.obiettivi.kcal;
  const max = Math.max(O * 1.15, ...perGiorno.map(g => g.kcal * 1.12), 100);
  const W = 336, base = 150, alto = 120, slot = W / 7, lb = 26;
  const y = v => base - (v / max) * alto;
  const barre = perGiorno.map((g, i) => {
    const x = i * slot + (slot - lb) / 2;
    const h = Math.max(g.kcal ? 4 : 0, base - y(g.kcal));
    const etichetta = data(g.k, { weekday: 'short' }).replace('.', '');
    const eOggi = g.k === oggi();
    return `<g class="g-giorno" data-act="vai-giorno" data-k="${g.k}" tabindex="0" role="button" aria-label="${esc(cap(data(g.k, { weekday: 'long', day: 'numeric', month: 'long' })))}: ${fmt(g.kcal)} kcal">
      <rect x="${i * slot}" y="0" width="${slot}" height="178" fill="transparent"/>
      ${h ? `<rect class="g-barra ${eOggi ? 'oggi' : ''}" x="${x}" y="${base - h}" width="${lb}" height="${h}" rx="8"/>` : ''}
      ${g.kcal ? `<text class="g-testo" x="${x + lb / 2}" y="${base - h - 6}" text-anchor="middle">${fmt(g.kcal)}</text>` : ''}
      <text class="g-testo ${eOggi ? 'forte' : ''}" x="${x + lb / 2}" y="${base + 20}" text-anchor="middle">${esc(etichetta)}</text></g>`;
  }).join('');

  const breve = k => data(k, { day: 'numeric', month: 'short' });
  const titolo = fine === oggi() ? t('ultimi7') : `${breve(inizio)} – ${breve(fine)}`;

  $('#view-settimana').innerHTML = `
    <header class="testata">
      <button class="tondo" data-act="settimana" data-d="-7" aria-label="${esc(t('settPrec'))}">${ICONE.sx}</button>
      <h1>${esc(titolo)}</h1>
      <button class="tondo" data-act="settimana" data-d="7" aria-label="${esc(t('settSucc'))}" ${fine >= oggi() ? 'disabled' : ''}>${ICONE.dx}</button>
      <button class="tondo" data-act="vai" data-view="impostazioni" aria-label="${esc(t('impostazioni'))}">${ICONE.ingranaggio}</button>
    </header>
    <div class="adesivo grafico">
      <svg viewBox="0 0 ${W} 178" role="group" aria-label="${esc(t('graficoAria'))}">
        <line class="g-obiettivo" x1="4" x2="${W - 4}" y1="${y(O)}" y2="${y(O)}"/>
        ${barre}
      </svg>
      <div class="legenda"><span class="tratt">${esc(t('legendaObiettivo', { n: fmt(O) }))}</span><span>${esc(t('toccaGiorno'))}</span></div>
    </div>
    <div class="medie">
      <div class="adesivo media"><span>${esc(t('mediaKcal'))}</span><b>${fmt(media('kcal'))} <small>kcal</small></b></div>
      <div class="adesivo media p"><span>${esc(t('mediaP'))}</span><b>${fmt(media('proteine'))} <small>g</small></b></div>
      <div class="adesivo media c"><span>${esc(t('mediaC'))}</span><b>${fmt(media('carboidrati'))} <small>g</small></b></div>
      <div class="adesivo media g"><span>${esc(t('mediaG'))}</span><b>${fmt(media('grassi'))} <small>g</small></b></div>
      <div class="adesivo media a"><span>${esc(t('mediaAcqua'))}</span><b>${fmt(mediaAcqua, 2)} <small>L</small></b></div>
      <div class="adesivo media"><span>${esc(t('giorniDiario'))}</span><b>${conPasti.length} <small>${esc(t('su7'))}</small></b></div>
    </div>
    <p class="nota-grafico">${esc(t('notaMedie'))}</p>
  `;
}

/* ================= Vista: Impostazioni ================= */
function eInstallata() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function disegnaImpostazioni() {
  const O = S.obiettivi;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const modello = S.modelli?.[0];
  const link = '<a class="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>';
  $('#view-impostazioni').innerHTML = `
    <header class="testata">
      <button class="tondo" data-act="vai" data-view="oggi" aria-label="${esc(t('tornaOggi'))}">${ICONE.sx}</button>
      <h1>${esc(t('impostazioni'))}</h1>
    </header>

    <section class="adesivo blocco">
      <h2>${esc(t('lingua'))}</h2>
      ${sceltaLingua('lingua-imp')}
    </section>

    <section class="adesivo blocco">
      <h2>${esc(t('titoloNome'))}</h2>
      <label class="campo"><span>${esc(t('nome'))}</span><input id="imp-nome" autocomplete="given-name" value="${esc(S.nome)}" placeholder="${esc(t('nomePh'))}"></label>
    </section>

    <section class="adesivo blocco" id="blocco-chiave">
      <h2>${esc(t('titoloChiave'))}</h2>
      ${S.apiKey ? `<span class="stato ok">${esc(t('chiaveAttiva'))}${modello ? `: ${esc(modello)}` : ''}</span>` : `<span class="stato no">${esc(t('chiaveManca'))}</span>`}
      <p>${esc(t('chiaveIntro'))}</p>
      <ol>
        <li>${t('passo1', { link })}</li>
        <li>${esc(t('passo2'))}</li>
        <li>${esc(t('passo3'))}</li>
        <li>${esc(t('passo4', { btn: t('verifica') }))}</li>
      </ol>
      <label class="campo"><span>${esc(t('chiave'))}</span><input id="imp-chiave" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.apiKey)}" placeholder="${esc(t('chiavePh'))}"></label>
      <div class="riga-bottoni">
        <button class="btn primario" data-act="verifica-chiave">${esc(t('verifica'))}</button>
        ${S.apiKey ? `<button class="btn" data-act="togli-chiave">${esc(t('rimuovi'))}</button>` : ''}
      </div>
    </section>

    <section class="adesivo blocco">
      <h2>${esc(t('titoloObiettivi'))}</h2>
      <p class="nota-campo" style="margin:-4px 0 12px">${esc(t('notaObiettivi'))}</p>
      <div class="griglia-obiettivi">
        <label class="campo"><span>${esc(t('obKcal'))}</span><input class="obiettivo" data-f="kcal" inputmode="numeric" value="${O.kcal}"></label>
        <label class="campo"><span>${esc(t('obP'))}</span><input class="obiettivo" data-f="proteine" inputmode="numeric" value="${O.proteine}"></label>
        <label class="campo"><span>${esc(t('obC'))}</span><input class="obiettivo" data-f="carboidrati" inputmode="numeric" value="${O.carboidrati}"></label>
        <label class="campo"><span>${esc(t('obG'))}</span><input class="obiettivo" data-f="grassi" inputmode="numeric" value="${O.grassi}"></label>
        <label class="campo"><span>${esc(t('obAcqua'))}</span><input id="imp-acqua" inputmode="numeric" value="${S.acquaObiettivo}"><small>${esc(t('obAcquaNota'))}</small></label>
      </div>
    </section>

    ${eInstallata() ? '' : `<section class="adesivo blocco">
      <h2>${esc(t('titoloInstalla'))}</h2>
      <p>${esc(t(ios ? 'installaIOS' : 'installaAndroid'))}</p>
    </section>`}

    <section class="adesivo blocco">
      <h2>${esc(t('titoloBackup'))}</h2>
      <p>${esc(t('testoBackup'))}</p>
      <div class="riga-bottoni">
        <button class="btn" data-act="esporta">${esc(t('esporta'))}</button>
        <button class="btn" data-act="importa">${esc(t('importa'))}</button>
      </div>
    </section>

    <section class="adesivo blocco">
      <h2>${esc(t('titoloPrivacy'))}</h2>
      <p>${esc(t('testoPrivacy'))}</p>
      <button class="btn pericolo" data-act="cancella-tutto">${esc(t('cancellaTutto'))}</button>
    </section>

    <p class="piede">Bocconcino ${VERSIONE}</p>
  `;
}

function cambiaLingua(codice) {
  if (!LINGUE[codice] || codice === S.lingua) return;
  S.lingua = codice;
  salvaImpostazioni();
  applicaLingua();
  avviso(t('linguaCambiata'));
}

/* ================= Gemini ================= */
class ErroreAnalisi extends Error {
  constructor(tipo, dettaglio = '', riprovaAltro = false) { super(tipo); this.tipo = tipo; this.dettaglio = dettaglio; this.riprovaAltro = riprovaAltro; }
}

async function richiesta(url, opzioni = {}, ms = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opzioni, signal: ctrl.signal }); }
  catch (e) { throw new ErroreAnalisi(e.name === 'AbortError' ? 'tempo' : 'rete', String(e)); }
  finally { clearTimeout(timer); }
}

function erroreDaRisposta(status, json) {
  const msg = json?.error?.message || '';
  const motivo = JSON.stringify(json?.error?.details || '') + msg;
  if (/API_KEY_INVALID|API key not valid|API_KEY/i.test(motivo) && status === 400) return new ErroreAnalisi('chiave', msg);
  if (status === 401) return new ErroreAnalisi('chiave', msg);
  if (status === 429) return new ErroreAnalisi('quota', msg, true);
  if (status === 404) return new ErroreAnalisi('modello', msg, true);
  if (status === 403) return /PERMISSION|location|region|not supported/i.test(motivo) ? new ErroreAnalisi('regione', msg, true) : new ErroreAnalisi('chiave', msg);
  if (status >= 500) return new ErroreAnalisi('server', msg, true);
  return new ErroreAnalisi('generico', msg, status === 400);
}

async function elencaModelli(chiave) {
  const r = await richiesta(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': chiave } }, 20000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw erroreDaRisposta(r.status, j);
  return j.models || [];
}

function scegliModelli(modelli) {
  const nomi = modelli
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(n => /^gemini/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|embed|exp|thinking|native|computer|robot|8b)/.test(n));
  const punteggio = n => {
    let s = n === 'gemini-flash-latest' ? 1000 : 0;
    s += 10 * parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    if (/lite/.test(n)) s -= 4;
    if (/preview/.test(n)) s -= 25;
    if (/-\d{3}$|\d{2}-\d{2}/.test(n)) s -= 1;
    return s;
  };
  const ordinati = [...new Set(nomi)].sort((a, b) => punteggio(b) - punteggio(a));
  return ordinati.length ? ordinati.slice(0, 6) : MODELLI_BASE;
}

const TIPO_IA = { colazione: 'breakfast', pranzo: 'lunch', spuntino: 'snack', cena: 'dinner' };

function istruzioni({ tipo, nota, testo, conFoto }) {
  const lingua = L().perIA;
  return `You are an expert nutritionist. ${conFoto ? 'Analyse the meal in the photo.' : 'Analyse the meal described by the user.'}
Meal type: ${TIPO_IA[tipo] || 'meal'}.
${testo ? `User description: """${testo}"""` : ''}
${nota ? `Extra details from the user (they take priority over what you see): """${nota}"""` : ''}

Tasks:
1. Identify every food and drink${conFoto ? ' visible' : ''}, listing main components separately (e.g. pasta, sauce, grated cheese).
2. Estimate each portion in grams (for drinks use ml, written in the "grammi" field).${conFoto ? ' Use the plate, cutlery, hands and packaging as scale references.' : ' If no quantity is given, assume a typical portion.'}
3. Compute kcal, protein, carbohydrates and fat FOR THAT PORTION using standard nutrition data (e.g. USDA, CREA). Account for likely dressings (oil, butter, sauces).
4. Write a short comment (max 18 words) in a tender, cute kawaii-mascot tone, never judgemental: no guilt, never mention body weight. You may add one small positive tip.

Write "nome_piatto", every "nome" and "commento" in ${lingua}.
Reply ONLY with valid JSON, no text before or after, in exactly this shape:
{"nome_piatto":"short dish name","alimenti":[{"nome":"string","grammi":0,"kcal":0,"proteine":0,"carboidrati":0,"grassi":0}],"confidenza":"alta|media|bassa","commento":"string","non_cibo":false}
"proteine", "carboidrati" and "grassi" are grams of protein, carbohydrates and fat. All numbers are JSON numbers (not strings), macronutrients with at most one decimal. "confidenza" must be exactly "alta", "media" or "bassa" (high, medium, low).
${conFoto ? 'If the photo contains no food or drink, reply with "non_cibo": true and "alimenti": [].' : ''}`;
}

function leggiJSON(testo) {
  const s = String(testo || '').replace(/```json|```/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new ErroreAnalisi('lettura');
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new ErroreAnalisi('lettura'); }
}

async function chiamaGemini(modello, { immagine, ...resto }) {
  const parts = [];
  if (immagine) parts.push({ inlineData: { mimeType: 'image/jpeg', data: immagine.split(',')[1] } });
  parts.push({ text: istruzioni({ ...resto, conFoto: !!immagine }) });
  const r = await richiesta(`${API}/models/${encodeURIComponent(modello)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw erroreDaRisposta(r.status, j);
  const cand = j.candidates?.[0];
  const testo = (cand?.content?.parts || []).map(p => p.text || '').join('');
  if (!testo) throw new ErroreAnalisi(j.promptFeedback?.blockReason ? 'bloccato' : 'lettura', '', !j.promptFeedback?.blockReason);
  return leggiJSON(testo);
}

async function analizza(dati) {
  if (!S.apiKey) throw new ErroreAnalisi('nochiave');
  const modelli = S.modelli?.length ? S.modelli : MODELLI_BASE;
  let ultimo;
  for (const m of modelli) {
    try {
      const out = await chiamaGemini(m, dati);
      if (m !== modelli[0]) { S.modelli = [m, ...modelli.filter(x => x !== m)]; salvaImpostazioni(); }
      return out;
    } catch (e) {
      ultimo = e;
      if (!(e instanceof ErroreAnalisi) || !e.riprovaAltro) throw e;
    }
  }
  throw ultimo;
}

/* ================= Foto ================= */
async function preparaFoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('immagine')); i.src = url; });
    return { grande: scala(img, 1024, 0.82), piccola: scala(img, 360, 0.75) };
  } finally { URL.revokeObjectURL(url); }
}
function scala(img, max, qualita) {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', qualita);
}

/* ================= Flusso: aggiungi pasto ================= */
function sceltaTipo(attuale) {
  return `<fieldset class="gruppo-scelte"><legend>${esc(t('chePasto'))}</legend><div class="scelte">
    ${TIPI.map(tp => `<label class="scelta"><input type="radio" name="tipo" value="${tp.id}" ${tp.id === attuale ? 'checked' : ''}><span>${esc(tipoNome(tp.id))}</span></label>`).join('')}
  </div></fieldset>`;
}
const tipoScelto = () => ($('input[name="tipo"]:checked') || {}).value || tipoDaOra();
const tipoIniziale = () => stato.giorno === oggi() ? tipoDaOra() : 'pranzo';

function apriAggiungi() {
  apriSheet(`<h2 id="sheet-titolo">${esc(t('titoloAggiungi'))}</h2>
    <div class="fonti">
      <button class="fonte" data-act="scatta"><span class="fonte-icona">${ICONE.camera}</span><span><b>${esc(t('fonteCam'))}</b><small>${esc(t('fonteCamSub'))}</small></span></button>
      <button class="fonte" data-act="galleria"><span class="fonte-icona">${ICONE.galleria}</span><span><b>${esc(t('fonteGal'))}</b><small>${esc(t('fonteGalSub'))}</small></span></button>
      <button class="fonte" data-act="descrivi"><span class="fonte-icona">${ICONE.matita}</span><span><b>${esc(t('fonteTesto'))}</b><small>${esc(t('fonteTestoSub'))}</small></span></button>
      <button class="fonte secondaria" data-act="manuale"><span class="fonte-icona">${ICONE.numeri}</span><span><b>${esc(t('fonteMano'))}</b><small>${esc(t('fonteManoSub'))}</small></span></button>
    </div>`);
}

async function suFoto(file) {
  if (!file) return;
  apriSheet(`<div class="attesa">${bocco('pensa')}<p>${esc(t('preparoFoto'))}</p></div>`, t('preparoFoto'));
  let foto;
  try { foto = await preparaFoto(file); }
  catch {
    apriSheet(`<div class="attesa">${bocco('confuso')}<p>${esc(t('fotoRotta'))}</p><small>${esc(t('fotoRottaSub'))}</small></div>`, t('fotoRotta'));
    return;
  }
  bozza = { foto: foto.piccola, grande: foto.grande };
  apriSheet(`<h2 id="sheet-titolo">${esc(t('titoloFoto'))}</h2>
    <div class="anteprima"><img src="${foto.grande}" alt="${esc(t('fotoAlt'))}"></div>
    ${sceltaTipo(tipoIniziale())}
    <label class="campo"><span>${esc(t('dettagli'))}</span>
      <textarea id="nota" rows="2" placeholder="${esc(t('dettagliPh'))}"></textarea>
      <small>${esc(t('dettagliNota'))}</small></label>
    <button class="btn primario pieno" data-act="analizza-foto">${esc(t('analizzaFoto'))}</button>`);
}

function apriDescrivi() {
  bozza = {};
  apriSheet(`<h2 id="sheet-titolo">${esc(t('titoloTesto'))}</h2>
    ${sceltaTipo(tipoIniziale())}
    <label class="campo"><span>${esc(t('descrizione'))}</span>
      <textarea id="descrizione" rows="3" placeholder="${esc(t('descrizionePh'))}"></textarea>
      <small>${esc(t('descrizioneNota'))}</small></label>
    <button class="btn primario pieno" data-act="analizza-testo">${esc(t('analizza'))}</button>`);
}

async function eseguiAnalisi(dati) {
  stato.occupato = true;
  const frasi = dati.immagine ? t('attesaFoto') : t('attesaTesto');
  apriSheet(`<div class="attesa">${bocco('pensa')}<p id="frase-attesa">${esc(frasi[0])}</p><small>${esc(t('attesaSub'))}</small><div class="puntini"><span></span><span></span><span></span></div></div>`, frasi[0]);
  let i = 0;
  const giro = setInterval(() => { const el = $('#frase-attesa'); if (el) el.textContent = frasi[++i % frasi.length]; }, 2600);
  try {
    const r = await analizza(dati);
    if (r.non_cibo || !Array.isArray(r.alimenti) || !r.alimenti.length) throw new ErroreAnalisi(r.non_cibo ? 'noncibo' : 'lettura');
    const alimenti = r.alimenti.map(a => nuovoAlimento({
      nome: String(a.nome || t('alimento')).slice(0, 80), grammi: num(a.grammi), kcal: num(a.kcal),
      proteine: num(a.proteine), carboidrati: num(a.carboidrati), grassi: num(a.grassi),
    }));
    bozza = {
      ...bozza, id: null, data: stato.giorno, tipo: dati.tipo,
      ora: stato.giorno === oggi() ? oraAdesso() : tipoOra(dati.tipo),
      nome: String(r.nome_piatto || alimenti[0]?.nome || t('pasto')).slice(0, 80),
      alimenti, nota: dati.nota || dati.testo || '', commento: String(r.commento || '').slice(0, 200),
      confidenza: ['alta', 'media', 'bassa'].includes(r.confidenza) ? r.confidenza : 'media',
    };
    stato.occupato = false;
    apriEditor();
  } catch (e) {
    stato.occupato = false;
    console.warn('Analisi non riuscita', e);
    const tipo = e instanceof ErroreAnalisi ? e.tipo : 'generico';
    const versoChiave = ['nochiave', 'chiave', 'modello', 'regione'].includes(tipo);
    const messaggio = TESTI.it['err_' + tipo] ? t('err_' + tipo) : t('err_generico');
    apriSheet(`<div class="attesa">${bocco('confuso')}<p>${esc(messaggio)}</p></div>
      <div class="riga-bottoni" style="justify-content:center">
        ${versoChiave ? `<button class="btn primario" data-act="vai" data-view="impostazioni">${esc(t('apriImpostazioni'))}</button>` : `<button class="btn primario" data-act="riprova">${esc(t('riprova'))}</button>`}
        <button class="btn" data-act="manuale">${esc(t('fonteMano'))}</button>
      </div>`, messaggio);
    eseguiAnalisi.ultima = dati;
  } finally {
    clearInterval(giro);
  }
}

/* ================= Editor del pasto ================= */
function tassi(a) {
  const g = num(a.grammi);
  return g > 0 ? { kcal: num(a.kcal) / g, proteine: num(a.proteine) / g, carboidrati: num(a.carboidrati) / g, grassi: num(a.grassi) / g } : null;
}
function nuovoAlimento(a) { return { nome: '', grammi: 0, kcal: 0, proteine: 0, carboidrati: 0, grassi: 0, ...a }; }

const CAMPI = [
  ['grammi', 'c_grammi', ''], ['kcal', 'c_kcal', ''], ['proteine', 'c_p', 'n-p'], ['carboidrati', 'c_c', 'n-c'], ['grassi', 'c_g', 'n-g'],
];

function rigaAlimento(a, i) {
  return `<div class="adesivo alimento" data-i="${i}">
    <div class="alimento-testa"><input class="al-nome" value="${esc(a.nome)}" placeholder="${esc(t('alimento'))}" aria-label="${esc(t('alimentoAria'))}">
      <button class="togli" data-act="togli-alimento" aria-label="${esc(t('togli', { x: a.nome || t('alimento') }))}">×</button></div>
    <div class="numeri">${CAMPI.map(([f, et, cl]) => `<label class="${cl}"><span>${esc(t(et))}</span><input data-f="${f}" inputmode="decimal" value="${perCampo(a[f])}" placeholder="0"></label>`).join('')}</div>
  </div>`;
}

function aggiornaTotale() {
  const tot = somma([bozza]);
  const el = $('#ed-totale');
  if (el) el.innerHTML = `<strong>${fmt(tot.kcal)} <small>kcal</small></strong><span class="pasto-info">${infoMacro(tot)}</span>`;
}

function apriEditor() {
  const b = bozza;
  const modifica = !!b.id;
  const fiducia = b.confidenza ? t('fid_' + b.confidenza) : '';
  apriSheet(`<h2 id="sheet-titolo">${esc(t(modifica ? 'titoloModifica' : 'titoloVedo'))}</h2>
    <div class="ed-testa ${b.foto ? '' : 'senza-foto'}">
      ${b.foto ? `<img class="miniatura" src="${b.foto}" alt="">` : ''}
      <label class="campo" style="margin:0"><span>${esc(t('nomePiatto'))}</span><input id="ed-nome" value="${esc(b.nome || '')}" placeholder="${esc(t('nomePiattoPh'))}"></label>
    </div>
    ${sceltaTipo(b.tipo || tipoIniziale())}
    ${!modifica && fiducia ? `<p class="fiducia">${esc(fiducia)} ${esc(t('ricalcolo'))}</p>` : ''}
    ${!modifica && b.commento ? `<div class="commento">${bocco('wow')}<div class="nuvoletta"><p>${esc(b.commento)}</p></div></div>` : ''}
    <div id="ed-alimenti">${b.alimenti.map(rigaAlimento).join('')}</div>
    <button class="btn leggero pieno" data-act="nuovo-alimento">${esc(t('aggiungiAlimento'))}</button>
    <div class="adesivo totale" id="ed-totale"></div>
    <div class="ed-azioni">
      ${modifica ? `<button class="btn pericolo" data-act="elimina-pasto">${esc(t('elimina'))}</button>` : ''}
      <button class="btn primario" data-act="salva-pasto">${esc(t(modifica ? 'salvaModifiche' : 'salvaDiario'))}</button>
    </div>`);
  aggiornaTotale();
}

function suModificaAlimento(e) {
  const box = e.target.closest('.alimento');
  if (!box || !bozza) return;
  const a = bozza.alimenti[+box.dataset.i];
  if (!a) return;
  if (e.target.classList.contains('al-nome')) { a.nome = e.target.value; return; }
  const f = e.target.dataset.f;
  if (!f) return;
  const v = num(e.target.value);
  if (f === 'grammi') {
    const tx = tassi(a);
    a.grammi = v;
    if (tx && v > 0) {
      for (const k of ['kcal', 'proteine', 'carboidrati', 'grassi']) {
        a[k] = k === 'kcal' ? Math.round(tx[k] * v) : arr1(tx[k] * v);
        const inp = $(`input[data-f="${k}"]`, box);
        if (inp) inp.value = perCampo(a[k]);
      }
    }
  } else {
    a[f] = v;
  }
  aggiornaTotale();
}

async function salvaPasto() {
  const b = bozza;
  b.tipo = tipoScelto();
  b.nome = $('#ed-nome').value.trim() || b.alimenti[0]?.nome || t('pasto');
  const alimenti = b.alimenti.filter(a => (a.nome || '').trim() || num(a.kcal) > 0);
  if (!alimenti.length) return avviso(t('almenoUno'));
  const nuovo = !b.id;
  const giorno = b.data || stato.giorno;
  const pasto = {
    id: b.id || uid(), data: giorno, tipo: b.tipo, nome: b.nome.slice(0, 80),
    ora: b.ora || (giorno === oggi() ? oraAdesso() : tipoOra(b.tipo)),
    alimenti: alimenti.map(a => ({ nome: (a.nome || t('alimento')).trim(), grammi: num(a.grammi), kcal: Math.round(num(a.kcal)), proteine: arr1(num(a.proteine)), carboidrati: arr1(num(a.carboidrati)), grassi: arr1(num(a.grassi)) })),
    foto: b.foto || null, nota: b.nota || '', commento: b.commento || '', creato: b.creato || Date.now(),
  };
  try { await DB.metti('pasti', pasto); }
  catch { return avviso(t('memoriaPiena')); }
  stato.giorno = pasto.data;
  stato.festa = nuovo;
  bozza = null;
  chiudiSheet();
  avviso(t(nuovo ? 'salvato' : 'modificheSalvate'));
  vai('oggi');
}

async function apriPasto(id) {
  const p = await DB.prendi('pasti', id);
  if (!p) return;
  bozza = { ...p, alimenti: p.alimenti.map(a => ({ ...a })) };
  apriEditor();
}

async function eliminaPasto() {
  if (!bozza?.id || !confirm(t('confermaElimina'))) return;
  await DB.togli('pasti', bozza.id);
  bozza = null;
  chiudiSheet();
  avviso(t('eliminato'));
  disegna();
}

/* ================= Impostazioni: azioni ================= */
async function verificaChiave(bottone) {
  const chiave = $('#imp-chiave').value.trim().replace(/\s+/g, '');
  if (!chiave) return avviso(t('incollaPrima'));
  bottone.disabled = true;
  bottone.textContent = t('verifico');
  try {
    const modelli = scegliModelli(await elencaModelli(chiave));
    S.apiKey = chiave; S.modelli = modelli;
    salvaImpostazioni();
    avviso(t('chiaveSalvata'));
    disegnaImpostazioni();
  } catch (e) {
    bottone.disabled = false;
    bottone.textContent = t('verifica');
    const tipo = e instanceof ErroreAnalisi ? e.tipo : 'generico';
    avviso(tipo === 'chiave' ? t('chiaveNonValida') : t(TESTI.it['err_' + tipo] ? 'err_' + tipo : 'err_generico'));
  }
}

async function esporta() {
  try {
    const dati = {
      app: 'bocconcino', versione: 1, esportato: new Date().toISOString(),
      impostazioni: { ...S, apiKey: '', modelli: [] },
      pasti: await DB.tutti('pasti'), giorni: await DB.tutti('giorni'),
    };
    const nome = `bocconcino-backup-${oggi()}.json`;
    const blob = new Blob([JSON.stringify(dati)], { type: 'application/json' });
    const file = typeof File === 'function' ? new File([blob], nome, { type: 'application/json' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Backup Bocconcino' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } catch { avviso(t('backupFallito')); }
}

async function importa(file) {
  if (!file) return;
  let dati;
  try { dati = JSON.parse(await file.text()); } catch { return avviso(t('backupNonValido')); }
  if (dati?.app !== 'bocconcino' || !Array.isArray(dati.pasti)) return avviso(t('backupAltro'));
  if (!confirm(t('confermaRipristino', { d: new Date(dati.esportato).toLocaleDateString(L().locale) }))) return;
  try {
    await DB.svuota('pasti'); await DB.svuota('giorni');
    for (const p of dati.pasti) if (p?.id && p?.data) await DB.metti('pasti', p);
    for (const g of dati.giorni || []) if (g?.data) await DB.metti('giorni', g);
    const { apiKey, modelli, lingua } = S;
    S = { ...PREDEFINITE, ...(dati.impostazioni || {}), obiettivi: { ...PREDEFINITE.obiettivi, ...(dati.impostazioni?.obiettivi || {}) }, apiKey, modelli, lingua, benvenuto: true };
    salvaImpostazioni();
    avviso(t('ripristinato', { n: dati.pasti.length }));
    disegna();
  } catch { avviso(t('ripristinoFallito')); }
}

async function cancellaTutto() {
  if (!confirm(t('confermaCancella'))) return;
  const lingua = S.lingua;
  await DB.svuota('pasti'); await DB.svuota('giorni');
  try { localStorage.removeItem('bocconcino.impostazioni'); } catch {}
  S = caricaImpostazioni();
  S.lingua = lingua;
  avviso(t('cancellati'));
  vai('oggi');
  benvenuto();
}

/* ================= Benvenuto ================= */
function benvenuto(nomeScritto = '') {
  if (S.benvenuto) return;
  apriSheet(`<div style="display:flex;justify-content:center;margin-bottom:6px">${sceltaLingua('lingua-benv')}</div>
    <div class="attesa" style="padding:14px 10px 10px">${bocco('wow')}</div>
    <h2 id="sheet-titolo" style="text-align:center">${esc(t('benvTitolo'))}</h2>
    <p class="intro" style="text-align:center">${esc(t('benvTesto'))}</p>
    <label class="campo"><span>${esc(t('titoloNome'))}</span><input id="benv-nome" autocomplete="given-name" placeholder="${esc(t('nomePh'))}" value="${esc(nomeScritto)}"></label>
    <button class="btn primario pieno" data-act="inizia">${esc(t('iniziamo'))}</button>`);
}

/* ================= Eventi ================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  switch (el.dataset.act) {
    case 'vai':
      chiudiSheetForzato(); vai(el.dataset.view);
      if (el.dataset.view === 'impostazioni' && !S.apiKey) setTimeout(() => $('#blocco-chiave')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      break;
    case 'aggiungi': apriAggiungi(); break;
    case 'chiudi-sheet': chiudiSheet(); break;
    case 'giorno': { const n = piuGiorni(stato.giorno, +el.dataset.d); if (n <= oggi()) { stato.giorno = n; disegnaOggi(); } break; }
    case 'settimana': { const n = piuGiorni(stato.fineSettimana, +el.dataset.d); stato.fineSettimana = n > oggi() ? oggi() : n; disegnaSettimana(); break; }
    case 'vai-giorno': stato.giorno = el.dataset.k; vai('oggi'); break;
    case 'acqua': impostaAcqua(+el.dataset.n); break;
    case 'scatta': $('#file-cam').click(); break;
    case 'galleria': $('#file-gal').click(); break;
    case 'descrivi': apriDescrivi(); break;
    case 'manuale':
      bozza = { ...(bozza || {}), id: null, data: stato.giorno, tipo: tipoIniziale(), ora: null, nome: '', alimenti: [nuovoAlimento()], commento: '', confidenza: null };
      apriEditor(); break;
    case 'analizza-foto':
      eseguiAnalisi({ immagine: bozza.grande, tipo: tipoScelto(), nota: $('#nota').value.trim().slice(0, 300) }); break;
    case 'analizza-testo': {
      const testo = $('#descrizione').value.trim().slice(0, 500);
      if (!testo) { avviso(t('scriviCosa')); $('#descrizione').focus(); break; }
      eseguiAnalisi({ testo, tipo: tipoScelto() }); break;
    }
    case 'riprova': if (eseguiAnalisi.ultima) eseguiAnalisi(eseguiAnalisi.ultima); break;
    case 'apri-pasto': apriPasto(el.dataset.id); break;
    case 'nuovo-alimento':
      bozza.alimenti.push(nuovoAlimento());
      $('#ed-alimenti').insertAdjacentHTML('beforeend', rigaAlimento(bozza.alimenti.at(-1), bozza.alimenti.length - 1));
      $('#ed-alimenti .alimento:last-child .al-nome').focus(); break;
    case 'togli-alimento': {
      const i = +el.closest('.alimento').dataset.i;
      bozza.alimenti.splice(i, 1);
      $('#ed-alimenti').innerHTML = bozza.alimenti.map(rigaAlimento).join('');
      aggiornaTotale(); break;
    }
    case 'salva-pasto': salvaPasto(); break;
    case 'elimina-pasto': eliminaPasto(); break;
    case 'verifica-chiave': verificaChiave(el); break;
    case 'togli-chiave':
      if (confirm(t('confermaTogliChiave'))) { S.apiKey = ''; S.modelli = []; salvaImpostazioni(); disegnaImpostazioni(); }
      break;
    case 'esporta': esporta(); break;
    case 'importa': $('#file-backup').click(); break;
    case 'cancella-tutto': cancellaTutto(); break;
    case 'inizia':
      S.nome = $('#benv-nome').value.trim().slice(0, 40); S.benvenuto = true; salvaImpostazioni();
      chiudiSheet(); vai(S.apiKey ? 'oggi' : 'impostazioni');
      if (!S.apiKey) setTimeout(() => $('#blocco-chiave')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#sheet').hidden) chiudiSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.g-giorno')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

document.addEventListener('input', e => {
  if (e.target.closest('#ed-alimenti')) suModificaAlimento(e);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.name === 'lingua-imp') { cambiaLingua(el.value); disegnaImpostazioni(); return; }
  if (el.name === 'lingua-benv') {
    const nomeScritto = $('#benv-nome')?.value || '';
    cambiaLingua(el.value); disegna(); benvenuto(nomeScritto); return;
  }
  if (el.id === 'imp-nome') { S.nome = el.value.trim().slice(0, 40); salvaImpostazioni(); avviso(t('nomeSalvato')); }
  if (el.classList.contains('obiettivo')) {
    const v = Math.round(num(el.value));
    if (v > 0) { S.obiettivi[el.dataset.f] = v; salvaImpostazioni(); avviso(t('obiettivoAggiornato')); }
    else el.value = S.obiettivi[el.dataset.f];
  }
  if (el.id === 'imp-acqua') {
    const v = Math.round(num(el.value));
    if (v >= 1 && v <= 16) { S.acquaObiettivo = v; salvaImpostazioni(); avviso(t('obiettivoAggiornato')); }
    else { el.value = S.acquaObiettivo; avviso(t('acquaIntervallo')); }
  }
  if (el.id === 'file-cam' || el.id === 'file-gal') { const f = el.files[0]; el.value = ''; suFoto(f); }
  if (el.id === 'file-backup') { const f = el.files[0]; el.value = ''; importa(f); }
});

/* ================= Avvio ================= */
(async function avvio() {
  try { await navigator.storage?.persist?.(); } catch {}
  applicaLingua();
  vai('oggi');
  benvenuto();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Se l'app resta aperta oltre mezzanotte, "Oggi" passa al giorno nuovo
  let ultimoOggi = oggi();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const ora = oggi();
    if (ora !== ultimoOggi) {
      if (stato.giorno === ultimoOggi) stato.giorno = ora;
      if (stato.fineSettimana === ultimoOggi) stato.fineSettimana = ora;
      ultimoOggi = ora;
      if ($('#sheet').hidden) disegna();
    }
  });
})();

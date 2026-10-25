/* Nazstock — scanner volume & simulator trading saham IDX + AS (uang virtual) */
'use strict';

const START = { IDR: 10_000_000, USD: 1_000 };
const CUR = { IDX: 'IDR', US: 'USD' };
const FEE = { IDX: { buy: 0.0015, sell: 0.0025 }, US: { buy: 0, sell: 0 } };
const LOT = { IDX: 100, US: 1 };
const KEY = 'nazstock_v1', CFGKEY = 'nazstock_cfg_v1';

const $ = s => document.querySelector(s);
const el = (t, a = {}, h = '') => { const e = document.createElement(t); Object.assign(e, a); if (h) e.innerHTML = h; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtIDR = n => (n < -0.5 ? '−' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');
const fmtUSD = n => (n < -0.005 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (m, n) => (m === 'IDX' || m === 'IDR') ? fmtIDR(n) : fmtUSD(n);
const px = (m, n) => m === 'IDX' ? Math.round(n).toLocaleString('id-ID') : (n < 10 ? n.toFixed(3) : n.toFixed(2));
const pct = n => (n > 0 ? '+' : '') + n.toFixed(2).replace('.', ',') + '%';
const cls = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
function big(m, n) {
  if (m === 'IDX') return n >= 1e12 ? 'Rp' + (n / 1e12).toFixed(2).replace('.', ',') + ' T' : n >= 1e9 ? 'Rp' + (n / 1e9).toFixed(1).replace('.', ',') + ' M' : 'Rp' + (n / 1e6).toFixed(0) + ' jt';
  return n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : '$' + (n / 1e6).toFixed(1) + 'M';
}

/* ---------- state ---------- */
const DATA = { IDX: null, US: null };
const QUOTES = { IDX: {}, US: {} };       // t -> {p, o, h, l, v, ts}
let state = load(KEY) || freshState();
let cfg = Object.assign({ goapi: '', rapid: '', rhost: '', rpath: '', strict: false, hours: true, idxMin: 0, idxMax: 1500 }, load(CFGKEY) || {});
let ui = { tab: 'IDX', scanM: 'IDX', scanLabel: 'Semua', cur: null, side: 'buy', chart: null };

function freshState() { return { IDR: { cash: START.IDR, pos: {}, hist: [], realized: 0 }, USD: { cash: START.USD, pos: {}, hist: [], realized: 0 } }; }
function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { } }
function saveCfg() { try { localStorage.setItem(CFGKEY, JSON.stringify(cfg)); } catch { } }

/* ---------- data ---------- */
async function loadData(m) {
  const r = await fetch(`data/${m}.json?v=${Date.now()}`);
  if (!r.ok) throw new Error('data ' + m);
  const d = await r.json();
  d.map = {};
  d.s.forEach(row => { d.map[row[0]] = { t: row[0], n: row[1], main: !!row[2], l1: !!row[3], b: row[4] }; });
  DATA[m] = d;
}
const stock = (m, t) => DATA[m] && DATA[m].map[t];
function lastBar(s) { for (let i = s.b.length - 1; i >= 0; i--) if (s.b[i]) return { i, b: s.b[i] }; return null; }
function prevBar(s, i) { for (let j = i - 1; j >= 0; j--) if (s.b[j]) return s.b[j]; return null; }
function priceOf(m, t) {
  const q = QUOTES[m][t]; if (q) return { p: q.p, ts: q.ts, live: true };
  const s = stock(m, t); const lb = s && lastBar(s);
  return lb ? { p: lb.b[3], ts: null, live: false } : null;
}
function changeOf(m, t) {
  const s = stock(m, t); if (!s) return 0;
  const lb = lastBar(s); if (!lb) return 0;
  const q = QUOTES[m][t];
  if (q) return (q.p / lb.b[3] - 1) * 100;
  const pb = prevBar(s, lb.i); return pb ? (lb.b[3] / pb[3] - 1) * 100 : 0;
}

/* ---------- jam bursa ---------- */
function partsIn(tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const o = {}; f.formatToParts(new Date()).forEach(p => o[p.type] = p.value);
  return { wd: o.weekday, min: (+o.hour % 24) * 60 + (+o.minute) };
}
function marketOpen(m) {
  if (m === 'IDX') {
    const { wd, min } = partsIn('Asia/Jakarta');
    if (wd === 'Sat' || wd === 'Sun') return false;
    const s1e = wd === 'Fri' ? 11 * 60 + 30 : 12 * 60, s2s = wd === 'Fri' ? 14 * 60 : 13 * 60 + 30;
    return (min >= 9 * 60 && min < s1e) || (min >= s2s && min < 15 * 60 + 50);
  }
  const { wd, min } = partsIn('America/New_York');
  if (wd === 'Sat' || wd === 'Sun') return false;
  return min >= 9 * 60 + 30 && min < 16 * 60;
}
const hoursText = m => m === 'IDX' ? 'Sen–Kam 09:00–12:00 & 13:30–15:50, Jum 09:00–11:30 & 14:00–15:50 WIB' : '09:30–16:00 waktu New York (malam–dini hari WIB)';

/* ---------- refresh harga ---------- */
function findNum(o, keys) {
  if (o == null) return null;
  if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) { const v = findNum(o[i], keys); if (v != null) return v; } return null; }
  if (typeof o === 'object') {
    for (const k of keys) if (o[k] != null && !isNaN(+o[k]) && +o[k] > 0) return +o[k];
    for (const v of Object.values(o)) if (v && typeof v === 'object') { const r = findNum(v, keys); if (r != null) return r; }
  }
  return null;
}
function watchSymbols(m) {
  const d = DATA[m]; const set = new Set();
  Object.keys(state[CUR[m]].pos).forEach(t => set.add(t));
  if (ui.cur && ui.cur.m === m) set.add(ui.cur.t);
  d.s.filter(r => r[2]).forEach(r => set.add(r[0]));
  return [...set];
}
async function refreshIDX(syms) {
  if (!cfg.goapi) throw new Error('GoAPI key belum diisi di Pengaturan.');
  let n = 0;
  for (let i = 0; i < syms.length; i += 50) {
    const part = syms.slice(i, i + 50);
    const r = await fetch(`https://api.goapi.io/stock/idx/prices?symbols=${part.join(',')}&api_key=${encodeURIComponent(cfg.goapi)}`);
    const j = await r.json();
    if (!r.ok || j.status === 'error') throw new Error('GoAPI: ' + (j.message || r.status));
    let rows = j.data; if (rows && rows.results) rows = rows.results; if (!Array.isArray(rows)) rows = rows ? Object.values(rows) : [];
    rows.forEach(x => {
      const t = (x.symbol || x.ticker || x.code || '').toUpperCase(); const p = +(x.close ?? x.last ?? x.price);
      if (t && p > 0) { QUOTES.IDX[t] = { p, o: +x.open || null, h: +x.high || null, l: +x.low || null, v: +x.volume || null, d: x.date || null, ts: Date.now() }; n++; }
    });
  }
  return n;
}
async function refreshUS(syms) {
  if (!cfg.rapid || !cfg.rhost || !cfg.rpath) throw new Error('RapidAPI key, host, dan path OHLC.dev belum lengkap di Pengaturan.');
  let n = 0, err = null;
  for (const t of syms.slice(0, 40)) {
    try {
      const url = 'https://' + cfg.rhost.replace(/^https?:\/\//, '').replace(/\/$/, '') + cfg.rpath.replace('{symbol}', encodeURIComponent(t));
      const r = await fetch(url, { headers: { 'x-rapidapi-key': cfg.rapid, 'x-rapidapi-host': cfg.rhost.replace(/^https?:\/\//, '').replace(/\/$/, '') } });
      if (!r.ok) { err = 'OHLC.dev: HTTP ' + r.status; continue; }
      const j = await r.json();
      const p = findNum(j, ['close', 'price', 'last', 'lastPrice', 'regularMarketPrice', 'c']);
      if (p) { QUOTES.US[t] = { p, h: findNum(j, ['high', 'h']), l: findNum(j, ['low', 'l']), ts: Date.now() }; n++; }
    } catch (e) { err = e.message; }
  }
  if (!n && err) throw new Error(err);
  return n;
}
async function refresh(m) {
  const btns = [$('#btn-refresh'), $('#btn-refresh2')]; btns.forEach(b => b.disabled = true);
  status('Memuat ulang data harian…');
  try {
    await loadData(m);
    let msg = `Data harian ${m === 'IDX' ? 'IDX' : 'AS'} per ${DATA[m].asof}.`;
    try {
      const n = m === 'IDX' ? await refreshIDX(watchSymbols(m)) : await refreshUS(watchSymbols(m));
      msg += ` Harga terbaru ${n} saham diperbarui ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}.`;
    } catch (e) { msg += ' ' + e.message; }
    checkStops(m);
    status(msg);
  } catch (e) { status('Gagal memuat data: ' + e.message); }
  btns.forEach(b => b.disabled = false);
  renderAll();
}
function status(t) { $('#status').textContent = t; }

/* ---------- scanner ---------- */
function analyze(m, s, k, at) {
  const b = s.b; let n = at;
  if (n == null) { const lb = lastBar(s); if (!lb) return null; n = lb.i; }
  const cur = b[n]; if (!cur) return null;
  const idx = []; for (let j = n - 1; j >= 0 && idx.length < 60; j--) if (b[j]) idx.push(j);
  if (idx.length < 50) return null;
  const pv = b[idx[0]], prev20 = idx.slice(0, 20).map(j => b[j]);
  const [o, h, l, c, v] = cur;
  if (h <= l || c <= 0 || v <= 0) return null;
  const vols = prev20.map(x => x[4]).sort((a, z) => a - z); const med = (vols[9] + vols[10]) / 2;
  if (!med) return null;
  const closes = [c, ...idx.map(j => b[j][3])];
  const ma20 = closes.slice(0, 20).reduce((a, z) => a + z, 0) / 20, ma50 = closes.slice(0, 50).reduce((a, z) => a + z, 0) / 50;
  const hi20 = Math.max(...prev20.map(x => x[1]));
  const seq = [cur, ...idx.slice(0, 14).map(j => b[j])]; let atr = 0;
  for (let i = 0; i < 14; i++) { const x = seq[i], y = seq[i + 1]; atr += Math.max(x[1] - x[2], Math.abs(x[1] - y[3]), Math.abs(x[2] - y[3])); } atr /= 14;
  const r = v / med, val = c * v, pos = (c - l) / (h - l), g = c / pv[3] - 1;
  const minv = m === 'IDX' ? (s.l1 ? 10e9 : 5e9) : 20e6;
  const green = c > o && c > pv[3], trend = c > ma50 && ma20 >= ma50;
  const reasons = [];
  if (!green) reasons.push('candle merah');
  if (pos < 0.67) reasons.push('tutup lemah');
  if (val < minv) reasons.push('nilai transaksi kecil');
  if (g >= (m === 'IDX' ? 0.10 : 0.08)) reasons.push('naik terlalu tinggi');
  if (!trend) reasons.push('tren belum naik');
  if (c / ma20 - 1 > (m === 'IDX' ? 0.15 : 0.10)) reasons.push('terlalu jauh dari MA20');
  let label = null;
  if (r >= k && (!green || pos < 0.5)) label = 'Waspada';
  else if (r >= k && !reasons.length) label = (pos >= 0.8 && c > hi20) ? 'Akumulasi kuat' : 'Akumulasi';
  else if (r >= Math.max(1.5, k * 0.67) && reasons.length <= 1) label = 'Hampir lolos';
  const score = Math.min(r, 8) / 8 * 40 + pos * 20 + (c > hi20 ? 20 : 0) + (trend ? 10 : 0) + Math.min(val / minv, 2) / 2 * 10;
  const ev = r >= 10 ? 'Volume ekstrem, cek berita/aksi korporasi' : '';
  return { t: s.t, n: s.n, c, chg: g * 100, r, val, score: Math.round(score), label, reasons, l1: s.l1, inval: l, dist: (c - l) / c * 100, atr, vsHi: (c / hi20 - 1) * 100, h, ev, idx: n };
}
function scanMarket(m, k, cap) {
  const d = DATA[m]; if (!d) return [];
  const out = [];
  d.s.forEach(row => {
    const s = d.map[row[0]]; const lb = lastBar(s); if (!lb) return;
    if (cap) {
      const c = lb.b[3];
      if (m === 'US' && c >= 5) return;
      if (m === 'IDX' && (c < (cfg.idxMin || 0) || (cfg.idxMax > 0 && c > cfg.idxMax))) return;
    }
    const a = analyze(m, s, k, lb.i);
    let label = a && a.label;
    // Terkonfirmasi: sinyal Akumulasi kemarin, hari ini tutup di atas high candle sinyal
    const pi = (() => { for (let j = lb.i - 1; j >= 0; j--) if (s.b[j]) return j; return -1; })();
    if (pi >= 0) {
      const y = analyze(m, s, k, pi);
      if (y && (y.label === 'Akumulasi' || y.label === 'Akumulasi kuat') && lb.b[3] > y.h) {
        const base = a || analyze(m, s, 0, lb.i); if (base) { base.label = 'Terkonfirmasi'; base.reasons = []; out.push(base); return; }
      }
    }
    if (label) out.push(a);
  });
  const ord = { 'Akumulasi kuat': 0, 'Terkonfirmasi': 1, 'Akumulasi': 2, 'Hampir lolos': 3, 'Waspada': 4 };
  out.sort((x, y) => ord[x.label] - ord[y.label] || y.score - x.score);
  return out;
}
const badgeCls = { 'Akumulasi kuat': 'b-kuat', 'Akumulasi': 'b-akm', 'Terkonfirmasi': 'b-konf', 'Hampir lolos': 'b-hampir', 'Waspada': 'b-waspada' };

/* ---------- render ---------- */
function renderWallets() {
  for (const cur of ['IDR', 'USD']) {
    const m = cur === 'IDR' ? 'IDX' : 'US'; const w = state[cur];
    let mv = 0; Object.entries(w.pos).forEach(([t, p]) => { const q = priceOf(m, t); mv += p.qty * (q ? q.p : p.avg); });
    const tot = w.cash + mv, pl = (tot / START[cur] - 1) * 100;
    $('#w-' + cur).innerHTML = `<div class="l">Saldo ${cur === 'IDR' ? 'Rupiah · IDX' : 'USD · AS'}</div><div class="v">${money(cur, w.cash)}</div><div class="s">Total ${money(cur, tot)} <span class="${cls(pl)}">${pct(pl)}</span></div>`;
  }
}
function renderMarket() {
  const m = ui.tab, d = DATA[m]; if (!d) return;
  const q = $('#q').value.trim().toUpperCase();
  let rows;
  if (q) { rows = d.s.filter(r => r[0].includes(q) || r[1].toUpperCase().includes(q)).slice(0, 80); $('#list-title').textContent = `Hasil pencarian (${rows.length})`; }
  else { rows = d.s.filter(r => r[2]); $('#list-title').textContent = m === 'IDX' ? 'Saham BUMN' : 'Saham besar AS'; }
  $('#mkt-info').textContent = `Data harian per ${d.asof} (diperbarui ${d.updated}). ${d.s.length} saham tersedia. Bursa ${marketOpen(m) ? 'BUKA' : 'TUTUP'}: ${hoursText(m)}.`;
  const t = $('#list'); t.innerHTML = '<tr><th>Saham</th><th>Harga</th><th>Ubah</th></tr>';
  rows.forEach(r => {
    const p = priceOf(m, r[0]); if (!p) return; const ch = changeOf(m, r[0]);
    const tr = el('tr', { className: 'click' }, `<td><span class="tk">${esc(r[0])}</span><span class="nm">${esc(r[1])}</span></td><td>${px(m, p.p)}${p.live ? ' •' : ''}</td><td class="${cls(ch)}">${pct(ch)}</td>`);
    tr.onclick = () => openStock(m, r[0]); t.appendChild(tr);
  });
}
function renderScan() {
  const m = ui.scanM, k = +$('#scan-k').value, cap = $('#scan-cap').checked;
  $('#scan-cap-t').textContent = m === 'IDX' ? 'Batasi harga' : 'Hanya harga < $5';
  $('#scan-range').classList.toggle('hidden', m !== 'IDX' || !cap);
  if (!DATA[m]) return;
  const res = scanMarket(m, k, cap);
  const labels = ['Semua', 'Akumulasi kuat', 'Terkonfirmasi', 'Akumulasi', 'Hampir lolos', 'Waspada'];
  const ch = $('#scan-chips'); ch.innerHTML = '';
  labels.forEach(L => {
    const n = L === 'Semua' ? res.length : res.filter(x => x.label === L).length;
    const b = el('button', { className: ui.scanLabel === L ? 'on' : '' }, `${L} (${n})`); b.onclick = () => { ui.scanLabel = L; renderScan(); }; ch.appendChild(b);
  });
  const rows = ui.scanLabel === 'Semua' ? res : res.filter(x => x.label === ui.scanLabel);
  $('#scan-info').textContent = `Scan dari data harian per ${DATA[m].asof}. ${res.filter(x => /Akumulasi|Terkonfirmasi/.test(x.label)).length ? '' : 'Belum ada saham yang lolos semua aturan hari ini. '}Klik baris untuk membuka simulator.`;
  const t = $('#scan-table');
  t.innerHTML = '<tr><th>Saham</th><th>Label</th><th>Skor</th><th>Harga</th><th>Ubah</th><th>Rasio vol</th><th>Nilai</th><th>Invalidasi</th><th>ATR14</th><th>vs high 20h</th><th>Catatan</th></tr>';
  rows.slice(0, 300).forEach(a => {
    const note = [...a.reasons, a.ev].filter(Boolean).join(', ') || '—';
    const tr = el('tr', { className: 'click' }, `<td><span class="tk">${esc(a.t)}</span>${m === 'IDX' && !a.l1 ? '<span class="tag">lapis 2</span>' : ''}<span class="nm">${esc(a.n)}</span></td><td><span class="badge ${badgeCls[a.label]}">${a.label}</span></td><td>${a.score}</td><td>${px(m, a.c)}</td><td class="${cls(a.chg)}">${pct(a.chg)}</td><td>${a.r.toFixed(1)}×</td><td>${big(m, a.val)}</td><td>${px(m, a.inval)} <span class="muted">(−${a.dist.toFixed(1)}%)</span></td><td>${px(m, a.atr)}</td><td class="${cls(a.vsHi)}">${pct(a.vsHi)}</td><td style="text-align:left">${esc(note)}</td>`);
    tr.onclick = () => openStock(m, a.t); t.appendChild(tr);
  });
  if (!rows.length) t.appendChild(el('tr', {}, '<td colspan="11" style="text-align:center">Tidak ada saham untuk filter ini.</td>'));
}
function renderPort() {
  const v = $('#v-port'); v.innerHTML = '';
  for (const m of ['IDX', 'US']) {
    const cur = CUR[m], w = state[cur];
    let mv = 0, ul = 0;
    const rows = Object.entries(w.pos).map(([t, p]) => { const q = priceOf(m, t); const pr = q ? q.p : p.avg; const val = p.qty * pr; mv += val; const u = val - p.qty * p.avg; ul += u; return { t, p, pr, val, u }; });
    const tot = w.cash + mv;
    v.appendChild(el('h2', {}, m === 'IDX' ? 'Portofolio Rupiah (IDX)' : 'Portofolio USD (AS)'));
    v.appendChild(el('div', { className: 'cards' }, [
      ['Kas', money(cur, w.cash)], ['Nilai saham', money(cur, mv)], ['Total', money(cur, tot)],
      ['P/L belum terealisasi', `<span class="${cls(ul)}">${money(cur, ul)}</span>`], ['P/L terealisasi', `<span class="${cls(w.realized)}">${money(cur, w.realized)}</span>`],
      ['Total P/L', `<span class="${cls(tot - START[cur])}">${pct((tot / START[cur] - 1) * 100)}</span>`]
    ].map(([l, x]) => `<div class="card"><div class="l">${l}</div><div class="v">${x}</div></div>`).join('')));
    const wrap = el('div', { className: 'tablewrap' }); const t = el('table', { className: 'list' });
    t.innerHTML = `<tr><th>Saham</th><th>${m === 'IDX' ? 'Lot' : 'Lembar'}</th><th>Rata-rata</th><th>Harga</th><th>Nilai</th><th>P/L</th><th>SL / TP</th></tr>`;
    rows.forEach(r => {
      const tr = el('tr', { className: 'click' }, `<td class="tk">${esc(r.t)}</td><td>${m === 'IDX' ? r.p.qty / 100 : r.p.qty}</td><td>${px(m, r.p.avg)}</td><td>${px(m, r.pr)}</td><td>${money(cur, r.val)}</td><td class="${cls(r.u)}">${money(cur, r.u)} (${pct((r.pr / r.p.avg - 1) * 100)})</td><td>${r.p.sl ? px(m, r.p.sl) : '—'} / ${r.p.tp ? px(m, r.p.tp) : '—'}</td>`);
      tr.onclick = () => openStock(m, r.t); t.appendChild(tr);
    });
    if (!rows.length) t.appendChild(el('tr', {}, '<td colspan="7" style="text-align:center">Belum ada posisi.</td>'));
    wrap.appendChild(t); v.appendChild(wrap);
    v.appendChild(el('h2', {}, 'Riwayat transaksi'));
    const w2 = el('div', { className: 'tablewrap' }); const h = el('table', { className: 'list' });
    h.innerHTML = '<tr><th>Waktu</th><th>Saham</th><th>Aksi</th><th>Jumlah</th><th>Harga</th><th>Biaya</th><th>P/L</th><th>Alasan</th></tr>';
    w.hist.slice().reverse().slice(0, 200).forEach(x => h.appendChild(el('tr', {}, `<td>${new Date(x.ts).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="tk">${esc(x.t)}</td><td class="${x.side === 'buy' ? 'up' : 'down'}">${x.side === 'buy' ? 'Beli' : 'Jual'}</td><td>${m === 'IDX' ? x.qty / 100 + ' lot' : x.qty}</td><td>${px(m, x.px)}</td><td>${money(cur, x.fee)}</td><td class="${cls(x.pl || 0)}">${x.pl != null ? money(cur, x.pl) : '—'}</td><td>${esc(x.why)}</td>`)));
    if (!w.hist.length) h.appendChild(el('tr', {}, '<td colspan="8" style="text-align:center">Belum ada transaksi.</td>'));
    w2.appendChild(h); v.appendChild(w2);
  }
}
function renderAll() { renderWallets(); if (ui.tab === 'IDX' || ui.tab === 'US') renderMarket(); if (ui.tab === 'scan') renderScan(); if (ui.tab === 'port') renderPort(); if (ui.cur) renderDetail(); }

/* ---------- detail & chart ---------- */
function openStock(m, t) { ui.cur = { m, t }; ui.side = 'buy'; $('#sheet').classList.remove('hidden'); document.body.style.overflow = 'hidden'; renderDetail(true); }
function closeStock() { ui.cur = null; $('#sheet').classList.add('hidden'); document.body.style.overflow = ''; if (ui.chart) { ui.chart.remove(); ui.chart = null; } }
function renderDetail(newChart) {
  const { m, t } = ui.cur, s = stock(m, t); if (!s) return;
  const p = priceOf(m, t), ch = changeOf(m, t), cur = CUR[m];
  $('#d-title').textContent = t; $('#d-name').textContent = s.n + (m === 'IDX' && s.main ? ' · BUMN' : '');
  const age = p.live ? `harga refresh ${new Date(p.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : `harga penutupan ${DATA[m].asof}`;
  $('#d-price').innerHTML = `<span class="p">${px(m, p.p)}</span><span class="${cls(ch)}">${pct(ch)}</span><span class="muted">${age} · bursa ${marketOpen(m) ? 'buka' : 'tutup'}</span>`;
  const a = analyze(m, s, +$('#scan-k').value);
  $('#d-scan').innerHTML = a ? `${a.label ? `<span class="badge ${badgeCls[a.label]}">${a.label}</span> ` : ''}Rasio volume <b>${a.r.toFixed(1)}×</b> · skor ${a.score} · nilai ${big(m, a.val)} · ATR14 ${px(m, a.atr)} · vs high 20h ${pct(a.vsHi)} · invalidasi ${px(m, a.inval)}${a.reasons.length ? `<div class="muted">Belum lolos: ${a.reasons.join(', ')}</div>` : ''}` : 'Data belum cukup untuk scan.';
  $('#d-qlabel').firstChild.textContent = m === 'IDX' ? 'Jumlah lot (1 lot = 100 lembar)' : 'Jumlah lembar';
  document.querySelectorAll('#d-side button').forEach(b => b.classList.toggle('on', b.dataset.s === ui.side));
  $('#d-go').textContent = ui.side === 'buy' ? 'Beli' : 'Jual';
  $('#d-go').classList.toggle('danger', ui.side === 'sell');
  const pos = state[cur].pos[t];
  $('#d-pos').innerHTML = pos ? `<h2>Posisi kamu</h2><div class="cards"><div class="card"><div class="l">${m === 'IDX' ? 'Lot' : 'Lembar'}</div><div class="v">${m === 'IDX' ? pos.qty / 100 : pos.qty}</div></div><div class="card"><div class="l">Harga rata-rata</div><div class="v">${px(m, pos.avg)}</div></div><div class="card"><div class="l">Nilai</div><div class="v">${money(cur, pos.qty * p.p)}</div></div><div class="card"><div class="l">P/L</div><div class="v ${cls(p.p - pos.avg)}">${money(cur, pos.qty * (p.p - pos.avg))} (${pct((p.p / pos.avg - 1) * 100)})</div></div></div>` : '';
  if (newChart) { $('#d-qty').value = 1; $('#d-sl').value = pos && pos.sl || ''; $('#d-tp').value = pos && pos.tp || ''; $('#d-msg').textContent = ''; drawChart(m, s); }
  estimate();
}
function drawChart(m, s) {
  const box = $('#chart'); box.innerHTML = '';
  if (ui.chart) { ui.chart.remove(); ui.chart = null; }
  if (!window.LightweightCharts) { box.innerHTML = '<p class="muted" style="padding:12px">Chart gagal dimuat (CDN). Fitur lain tetap jalan.</p>'; return; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const c = LightweightCharts.createChart(box, { width: box.clientWidth, height: 320, layout: { background: { color: 'transparent' }, textColor: dark ? '#ccc' : '#333' }, grid: { vertLines: { visible: false }, horzLines: { color: dark ? '#2a2f37' : '#eee' } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false } });
  const dates = DATA[m].dates, bars = [];
  s.b.forEach((b, i) => { if (b) bars.push({ time: dates[i], open: b[0], high: b[1], low: b[2], close: b[3], value: b[4] }); });
  const q = QUOTES[m][s.t];
  if (q && q.d && q.d > dates[dates.length - 1]) bars.push({ time: q.d, open: q.o || q.p, high: q.h || q.p, low: q.l || q.p, close: q.p, value: q.v || 0 });
  const cs = c.addCandlestickSeries({ upColor: '#0f9d58', downColor: '#d93025', borderVisible: false, wickUpColor: '#0f9d58', wickDownColor: '#d93025' });
  cs.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  const vs = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
  c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  vs.setData(bars.map(b => ({ time: b.time, value: b.value, color: b.close >= b.open ? 'rgba(15,157,88,.4)' : 'rgba(217,48,37,.4)' })));
  for (const [n, col] of [[20, '#1a56db'], [50, '#b45309']]) {
    const ma = []; for (let i = n - 1; i < bars.length; i++) ma.push({ time: bars[i].time, value: bars.slice(i - n + 1, i + 1).reduce((a, b) => a + b.close, 0) / n });
    c.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ma);
  }
  c.timeScale().fitContent(); ui.chart = c;
  new ResizeObserver(() => ui.chart === c && c.applyOptions({ width: box.clientWidth })).observe(box);
}
function estimate() {
  if (!ui.cur) return; const { m, t } = ui.cur; const p = priceOf(m, t).p;
  const qty = Math.max(0, Math.floor(+$('#d-qty').value || 0)) * LOT[m], cur = CUR[m];
  const gross = qty * p, fee = gross * FEE[m][ui.side];
  const pos = state[cur].pos[t];
  $('#d-est').innerHTML = ui.side === 'buy'
    ? `${m === 'IDX' ? qty / 100 + ' lot = ' + qty.toLocaleString('id-ID') + ' lembar' : qty + ' lembar'} × ${px(m, p)} = ${money(cur, gross)}<br>Biaya ${money(cur, fee)} · Total bayar <b>${money(cur, gross + fee)}</b> · Kas ${money(cur, state[cur].cash)}`
    : `Terima ${money(cur, gross - fee)} (biaya ${money(cur, fee)}) · Dimiliki ${pos ? (m === 'IDX' ? pos.qty / 100 + ' lot' : pos.qty + ' lembar') : '0'}`;
}

/* ---------- transaksi ---------- */
function canTrade(m, t) {
  if (cfg.hours && !marketOpen(m)) return 'Bursa sedang tutup. Jam bursa: ' + hoursText(m) + '.';
  const p = priceOf(m, t);
  if (cfg.strict && (!p.live || Date.now() - p.ts > 15 * 60 * 1000)) return 'Tekan Refresh harga dulu (harga harus ≤ 15 menit).';
  return null;
}
function execute(m, t, side, qty, price, why) {
  const cur = CUR[m], w = state[cur], gross = qty * price, fee = gross * FEE[m][side];
  if (side === 'buy') {
    if (gross + fee > w.cash + 1e-9) return 'Saldo tidak cukup.';
    const p = w.pos[t] || { qty: 0, avg: 0 };
    p.avg = (p.avg * p.qty + gross + fee) / (p.qty + qty); p.qty += qty; w.pos[t] = p; w.cash -= gross + fee;
    w.hist.push({ ts: Date.now(), t, side, qty, px: price, fee, why });
  } else {
    const p = w.pos[t]; if (!p || p.qty < qty) return 'Jumlah melebihi kepemilikan.';
    const pl = gross - fee - p.avg * qty; w.cash += gross - fee; w.realized += pl; p.qty -= qty;
    if (!p.qty) delete w.pos[t];
    w.hist.push({ ts: Date.now(), t, side, qty, px: price, fee, pl, why });
  }
  save(); return null;
}
function onTrade() {
  const { m, t } = ui.cur, msg = $('#d-msg'); msg.className = 'msg err';
  const lots = Math.floor(+$('#d-qty').value || 0); if (lots < 1) { msg.textContent = 'Isi jumlah minimal 1.'; return; }
  const block = canTrade(m, t); if (block) { msg.textContent = block; return; }
  const price = priceOf(m, t).p, qty = lots * LOT[m];
  const err = execute(m, t, ui.side, qty, price, 'manual'); if (err) { msg.textContent = err; return; }
  const pos = state[CUR[m]].pos[t];
  if (pos) { const sl = +$('#d-sl').value, tp = +$('#d-tp').value; pos.sl = sl > 0 ? sl : null; pos.tp = tp > 0 ? tp : null; save(); }
  msg.className = 'msg ok'; msg.textContent = `${ui.side === 'buy' ? 'Beli' : 'Jual'} ${t} ${m === 'IDX' ? lots + ' lot' : lots + ' lembar'} di ${px(m, price)} berhasil.`;
  renderAll();
}
function checkStops(m) {
  const w = state[CUR[m]]; const done = [];
  Object.entries(w.pos).forEach(([t, p]) => {
    const q = QUOTES[m][t]; if (!q) return;
    const lo = q.l || q.p, hi = q.h || q.p;
    if (p.sl && lo <= p.sl) { execute(m, t, 'sell', p.qty, Math.min(p.sl, q.p), 'stop loss'); done.push(t + ' SL'); }
    else if (p.tp && hi >= p.tp) { execute(m, t, 'sell', p.qty, Math.max(p.tp, Math.min(q.p, p.tp)), 'take profit'); done.push(t + ' TP'); }
  });
  if (done.length) alert('Order otomatis tereksekusi: ' + done.join(', '));
}

/* ---------- pengaturan & ekspor ---------- */
function fillCfg() { $('#k-goapi').value = cfg.goapi; $('#k-rapid').value = cfg.rapid; $('#k-rhost').value = cfg.rhost; $('#k-rpath').value = cfg.rpath; $('#k-strict').checked = cfg.strict; $('#k-hours').checked = cfg.hours; }
function bind() {
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); ui.tab = b.dataset.tab;
    $('#v-market').classList.toggle('hidden', !(ui.tab === 'IDX' || ui.tab === 'US'));
    $('#v-scan').classList.toggle('hidden', ui.tab !== 'scan'); $('#v-port').classList.toggle('hidden', ui.tab !== 'port'); $('#v-set').classList.toggle('hidden', ui.tab !== 'set');
    if (ui.tab === 'IDX' || ui.tab === 'US') $('#q').value = '';
    renderAll();
  });
  $('#q').oninput = renderMarket;
  $('#btn-refresh').onclick = () => refresh(ui.tab === 'US' ? 'US' : 'IDX');
  $('#btn-refresh2').onclick = () => refresh(ui.scanM);
  document.querySelectorAll('#scan-mkt button').forEach(b => b.onclick = () => { document.querySelectorAll('#scan-mkt button').forEach(x => x.classList.toggle('on', x === b)); ui.scanM = b.dataset.m; renderScan(); });
  $('#scan-k').onchange = renderScan; $('#scan-cap').onchange = renderScan;
  $('#scan-min').value = cfg.idxMin || ''; $('#scan-max').value = cfg.idxMax || '';
  const onRange = () => { cfg.idxMin = Math.max(0, +$('#scan-min').value || 0); cfg.idxMax = Math.max(0, +$('#scan-max').value || 0); saveCfg(); renderScan(); };
  $('#scan-min').oninput = onRange; $('#scan-max').oninput = onRange;
  $('#d-close').onclick = closeStock; $('#sheet').onclick = e => { if (e.target.id === 'sheet') closeStock(); };
  document.querySelectorAll('#d-side button').forEach(b => b.onclick = () => { ui.side = b.dataset.s; $('#d-msg').textContent = ''; renderDetail(); });
  $('#d-qty').oninput = estimate; $('#d-go').onclick = onTrade;
  $('#btn-save').onclick = () => { cfg = { goapi: $('#k-goapi').value.trim(), rapid: $('#k-rapid').value.trim(), rhost: $('#k-rhost').value.trim(), rpath: $('#k-rpath').value.trim(), strict: $('#k-strict').checked, hours: $('#k-hours').checked, idxMin: cfg.idxMin, idxMax: cfg.idxMax }; saveCfg(); status('Pengaturan disimpan di browser ini.'); };
  $('#btn-export').onclick = () => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ app: 'nazstock', v: 1, state }, null, 1)], { type: 'application/json' })), download: `nazstock-${new Date().toISOString().slice(0, 10)}.json` }); document.body.appendChild(a); a.click(); a.remove(); };
  $('#f-import').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j.state || !j.state.IDR || !j.state.USD) throw 0; state = j.state; save(); status('Data simulasi berhasil diimpor.'); renderAll(); } catch { status('File impor tidak valid.'); } e.target.value = ''; };
  $('#btn-reset').onclick = () => { if (confirm('Reset saldo ke Rp10.000.000 dan $1.000, hapus semua posisi dan riwayat?')) { state = freshState(); save(); renderAll(); status('Simulasi direset.'); } };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.cur) closeStock(); });
}

(async function init() {
  bind(); fillCfg(); status('Memuat data…');
  try { await Promise.all([loadData('IDX'), loadData('US')]); status(`Data harian IDX per ${DATA.IDX.asof}, AS per ${DATA.US.asof}. Tekan Refresh untuk harga terbaru.`); }
  catch (e) { status('Gagal memuat data: ' + e.message); }
  renderAll();
})();

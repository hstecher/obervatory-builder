// Shared helpers for host and player screens.
const $ = (sel, el = document) => el.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = v => '$' + (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
const fmtTime = ms => { const s = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDec = d => (d > 0 ? '+' : '') + d + '°';

const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* storage blocked */ } },
};

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

function connectStream(params, onMessage, onGone) {
  const es = new EventSource('/api/stream?' + new URLSearchParams(params));
  es.onmessage = e => onMessage(JSON.parse(e.data));
  // A 404 closes the stream for good; network blips keep retrying on their own
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) onGone(); };
  return es;
}

function toast(msg, kind = 'error') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

// Local countdown between server updates
let phaseEndLocal = null;
function syncTimer(state) {
  phaseEndLocal = state.remainingMs != null ? Date.now() + state.remainingMs : null;
}
function updateTimers() {
  document.querySelectorAll('[data-timer]').forEach(el => {
    if (phaseEndLocal == null || window.__paused) { el.textContent = window.__paused ? '⏸ paused' : ''; return; }
    const ms = phaseEndLocal - Date.now();
    el.textContent = fmtTime(ms);
    el.classList.toggle('hurry', ms < 15000);
  });
}
setInterval(updateTimers, 250);

const PHASE_LABEL = { lobby: 'Waiting for players', plan: 'Planning', award: 'Grants awarded', run: 'Observing', report: 'Semester report', final: 'Game over' };
const ROLE_INFO = {
  director: { icon: '🧑‍💼', label: 'Director', job: 'Chooses which grants to apply for' },
  engineer: { icon: '🛠️', label: 'Engineer', job: 'Builds the telescope and buys upgrades' },
  scheduler: { icon: '🗓️', label: 'Scheduler', job: 'Orders the queue to match the weather' },
};

function effSeeing(instruments, seeing) {
  if (!instruments.includes('ao')) return seeing;
  return Math.round(seeing * (seeing <= 1.0 ? 0.35 : 0.6) * 100) / 100;
}

function oddsBadge(odds) {
  if (!odds) return '';
  const c = odds.chance;
  const [cls, label] = c >= 75 ? ['great', 'Great odds'] : c >= 45 ? ['good', 'Good odds'] : c >= 20 ? ['risky', 'Risky'] : ['long', 'Long shot'];
  return `<span class="odds ${cls}" title="${odds.nightly}% of nights at your site have good enough weather">${label} · ${c}%</span>`;
}

function reqChips(g, instruments) {
  const chips = [];
  for (const i of g.instruments || []) chips.push(`<span class="chip">${instruments[i].icon} ${esc(instruments[i].name)}</span>`);
  if (g.instrumentsAny) chips.push(`<span class="chip">${g.instrumentsAny.map(i => instruments[i].icon).join('/')} any camera or spectrograph</span>`);
  chips.push(`<span class="chip">🪞 ≥ ${g.minAp} m</span>`);
  chips.push(`<span class="chip" title="Seeing: how blurry the atmosphere makes stars">🌫️ seeing ≤ ${g.iq}″</span>`);
  chips.push(`<span class="chip">☁️ clouds ≤ ${g.cc}%</span>`);
  if (g.wv != null) chips.push(`<span class="chip ir" title="Water vapor absorbs infrared light">💧 humidity ≤ ${g.wv}%</span>`);
  if (g.faint) chips.push(`<span class="chip" title="Faint targets need dark skies">🌃 faint</span>`);
  return chips.join('');
}

function teamDots(ids, teams) {
  return ids.map(id => teams.find(t => t.id === id)).filter(Boolean)
    .map(t => `<span class="dot" style="background:${t.color}" title="${esc(t.name)}"></span>`).join('');
}

// Bar showing which declinations reach 30° altitude from a site
function decBand(lat) {
  const lo = Math.max(-90, lat - 60), hi = Math.min(90, lat + 60);
  const pct = d => (90 - d) / 180 * 100; // +90 at left
  return `<div class="decband" title="Dec ${fmtDec(lo)} to ${fmtDec(hi)} rises high enough to observe">
    <div class="decband-fill" style="left:${pct(hi)}%;width:${pct(lo) - pct(hi)}%"></div>
    <span class="decband-eq"></span>
    <span class="decband-lbl l">N +90°</span><span class="decband-lbl r">S −90°</span>
  </div>
  <div class="small muted">Can observe Dec ${fmtDec(lo)} to ${fmtDec(hi)}</div>`;
}

function siteMeters(site) {
  const m = (label, v, tip) => `<div class="meter" title="${tip}"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.max(4, Math.min(100, v)))}%"></i></div></div>`;
  return m('Steady air', (2.1 - site.seeing) / 1.6 * 100, `Median seeing ${site.seeing}″`)
    + m('Dry air', 100 - site.humidity * 1.4, `Median humidity ${site.humidity}%`)
    + m('Clear nights', site.clear * 100, `${Math.round(site.clear * 100)}% of nights are clear`)
    + m('Dark skies', (1 - site.lightPollution) * 100, site.lightPollution > 0.2 ? 'City lights nearby' : 'Very dark');
}

// Observatory picture: dome grows with mirror size, laser beam when AO is in use
function observatorySVG(team, opts = {}) {
  const { weather, tonight, small } = opts;
  const ap = team.aperture || 0;
  const r = 16 + ap * 4.5;
  const clouds = weather ? weather.clouds : 15;
  const observing = tonight && tonight.status === 'observing';
  let stars = '';
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % 320, y = (i * 53) % 120, s = (i % 3) * 0.5 + 0.6;
    stars += `<circle cx="${x}" cy="${y}" r="${s}" fill="#fff" opacity="${0.4 + (i % 5) / 8}"/>`;
  }
  let cloudShapes = '';
  const n = Math.round(clouds / 12);
  for (let i = 0; i < n; i++) {
    const x = (i * 71 + 30) % 300, y = 15 + (i * 37) % 70;
    cloudShapes += `<ellipse class="cloud" cx="${x}" cy="${y}" rx="${40 + (i % 3) * 14}" ry="${12 + (i % 2) * 6}" fill="#9aa5b8" opacity="${0.35 + clouds / 250}"/>`;
  }
  const domeY = 150;
  const laser = observing && tonight.ao
    ? `<line x1="160" y1="${domeY - r}" x2="${190}" y2="0" stroke="#ffb340" stroke-width="2.5" opacity=".9" class="laser"/>` : '';
  const slit = observing ? `<rect x="${160 - r * 0.18}" y="${domeY - r}" width="${r * 0.36}" height="${r}" fill="#0b1020"/>` : '';
  const dome = team.site ? `
      <rect x="${160 - r}" y="${domeY}" width="${r * 2}" height="${18 + ap * 2}" fill="#d7dde8"/>
      <path d="M${160 - r},${domeY} A${r},${r} 0 0 1 ${160 + r},${domeY} Z" fill="#eef2f8"/>
      ${slit}
      <text x="160" y="${domeY + 13 + ap}" text-anchor="middle" font-size="10" fill="#334">${ap} m</text>` :
    `<text x="160" y="${domeY - 10}" text-anchor="middle" font-size="28">🏗️</text>`;
  return `<svg viewBox="0 0 320 200" class="obs-svg ${small ? 'small' : ''}" role="img" aria-label="Observatory">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050816"/><stop offset="1" stop-color="#1b2550"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#sky)"/>
    ${stars}${laser}${cloudShapes}
    <path d="M0,200 L0,175 L70,150 L120,${domeY + 10} L200,${domeY + 10} L250,155 L320,170 L320,200 Z" fill="#2b2f3f"/>
    ${dome}
  </svg>`;
}

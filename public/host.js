// Teacher / projector screen.
const app = $('#app');
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('hostKey')) { store.set('otHost', { code: urlParams.get('code'), hostKey: urlParams.get('hostKey') }); history.replaceState(null, '', 'host.html'); }
let host = store.get('otHost');
let S = null;

// Discussion starters shown during the semester report, one per semester
const PROMPTS = [
  'Which site did each team pick? What did they give up to get it?',
  'Why can’t a telescope in Arizona observe the Large Magellanic Cloud? (Hint: look at its Dec!)',
  'Why do infrared telescopes need such dry air?',
  'What does a bigger mirror actually do for a telescope?',
  'What is “seeing”, and how does adaptive optics fix it?',
  'Why would two teams on opposite sides of the equator want to work together?',
  'Was it better to take safe grants or risky ones? Why?',
  'If you started over, what would you build first?',
  'Real observatories like Gemini have twins in Hawaiʻi AND Chile. Why?',
  'How did the Scheduler’s queue order change what got finished?',
];

if (host) start();
else renderSetup();

function renderSetup() {
  app.innerHTML = `<div class="landing card">
    <div style="font-size:3rem">🔭</div>
    <h1>Host a game</h1>
    <p class="muted">Put this screen on the projector. Students join on their own devices.</p>
    <form id="setup" class="stack" style="text-align:left">
      <label>Length<br><select id="rounds">
        <option value="6">Short: 6 semesters (~30 min)</option>
        <option value="8" selected>Standard: 8 semesters (~40 min)</option>
        <option value="10">Long: 10 semesters (~50 min)</option>
      </select></label>
      <label>Planning time per semester<br><select id="plan">
        <option value="90">90 seconds</option>
        <option value="120" selected>2 minutes</option>
        <option value="180">3 minutes</option>
      </select></label>
      <button class="big" type="submit" style="width:100%">Create game</button>
    </form>
  </div>`;
  $('#setup').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const plan = Number($('#plan').value);
      host = await post('/api/rooms', { settings: { rounds: Number($('#rounds').value), planSeconds: plan, firstPlanSeconds: plan * 2 } });
      store.set('otHost', host);
      start();
    } catch (err) { toast(err.message); }
  });
}

function start() {
  connectStream({ code: host.code, hostKey: host.hostKey }, ({ state }) => {
    S = state;
    window.__paused = state.paused;
    syncTimer(state);
    render();
    updateTimers();
  }, () => { store.del('otHost'); host = null; renderSetup(); toast('That game ended. Create a new one.', 'info'); });
}

async function hostAct(type, extra = {}) {
  try { await post('/api/host', { code: host.code, hostKey: host.hostKey, type, ...extra }); }
  catch (e) { toast(e.message); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-host]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.host === 'endGame' && !confirm('End the game now and show awards?')) return;
  if (d.host === 'newGame') {
    if (!confirm('Start a brand-new game? Students will need the new code.')) return;
    store.del('otHost'); host = null; location.reload(); return;
  }
  hostAct(d.host, { event: d.event, uid: d.uid });
});

const teamOf = id => S.teams.find(t => t.id === id);
const ranked = () => [...S.teams].sort((a, b) => b.science - a.science || b.money - a.money);

function render() {
  const joinUrl = location.host;
  const controls = S.phase === 'lobby'
    ? `<button class="big" data-host="start" ${S.teams.length ? '' : 'disabled'}>▶ Start game</button>`
    : S.phase === 'final' ? `<button data-host="newGame" class="ghost">New game</button>`
    : `<div class="controls">
        ${S.paused ? '<button data-host="resume">▶ Resume</button>' : '<button data-host="pause" class="warn">⏸ Pause</button>'}
        ${S.phase === 'plan' ? '<button data-host="addTime" class="ghost">+30s</button>' : ''}
        <button data-host="skip" class="ghost" title="End this phase now and move on">⏭ Next phase</button>
        <button data-host="event" data-event="supernova" class="ghost" title="Trigger a supernova during observing">💥</button>
        <button data-host="event" data-event="storm" class="ghost" title="Storm at an occupied site">⛈️</button>
        <button data-host="event" data-event="boost" class="ghost" title="Everyone gets $5M">🎁</button>
        <button data-host="event" data-event="cut" class="ghost" title="Everyone loses 15% of savings">✂️</button>
        <button data-host="roleLocks" class="ghost" title="When off, any teammate can do any job">${S.roleLocks ? '🔒 Roles on' : '🔓 Roles off'}</button>
        <button data-host="endGame" class="danger">End</button>
      </div>`;
  const header = `<header class="topbar">
    <span class="brand">🔭 Observatory Tycoon</span>
    <span class="phase-tag">Join at <b>${esc(joinUrl)}</b> · code <b style="color:var(--accent-2)">${S.code}</b></span>
    ${S.round ? `<span class="phase-tag">Semester ${S.round}/${S.rounds}</span>` : ''}
    <span class="phase-tag">${PHASE_LABEL[S.phase]}</span><span data-timer style="font-size:1.4rem"></span>
    <span class="spacer"></span>${controls}
  </header>`;

  let main;
  switch (S.phase) {
    case 'lobby': main = lobbyView(joinUrl); break;
    case 'plan': main = planView(); break;
    case 'award': main = awardView(); break;
    case 'run': main = runView(); break;
    case 'report': main = reportView(); break;
    case 'final': main = finalView(); break;
  }
  const sidebar = S.phase === 'lobby' || S.phase === 'final' ? '' : `<div class="stack">${leaderboard()}${newsCard()}</div>`;
  app.innerHTML = header + `<div class="wrap">${sidebar ? `<div class="host-grid"><div class="stack">${main}</div>${sidebar}</div>` : main}</div>`;
}

function lobbyView(joinUrl) {
  const teams = S.teams.map(t => `<div class="team-card" style="--c:${t.color}">
      <b>${esc(t.name)}</b>
      ${t.members.map(m => `<div class="member ${m.online ? '' : 'offline'}">${esc(m.name)}<span class="spacer"></span><button class="ghost tiny" data-host="removePlayer" data-uid="${m.uid}" title="Remove player">✕</button></div>`).join('')}
    </div>`).join('');
  const waiting = S.lobby.map(p => `<span class="team-chip" style="--c:#555">${esc(p.name)} <button class="ghost tiny" data-host="removePlayer" data-uid="${p.uid}">✕</button></span>`).join('');
  return `<div class="card join-hero">
      <div class="url">Go to <b>${esc(joinUrl)}</b> and enter</div>
      <div class="code">${S.code}</div>
      <p class="muted">${S.teams.length} team${S.teams.length === 1 ? '' : 's'} · ${S.teams.reduce((n, t) => n + t.members.length, 0) + S.lobby.length} players</p>
    </div>
    ${S.lobby.length ? `<div class="card" style="margin-top:1rem"><h3>Choosing a team…</h3>${waiting}</div>` : ''}
    <div class="team-list" style="margin-top:1rem">${teams}</div>`;
}

function leaderboard() {
  const rows = ranked().map((t, i) => {
    const site = t.site && S.static.sites[t.site];
    return `<div class="leader">
      <span class="rank">${i + 1}</span>
      <span class="name"><span class="dot" style="background:${t.color}"></span> ${esc(t.name)}${S.phase === 'plan' && t.ready ? ' ✅' : ''}</span>
      <span class="sci">🔬 ${t.science}</span>
      <span class="sub">${site ? `${site.icon} ${esc(site.name)} · ${t.aperture} m · ${t.instruments.map(i => S.static.instruments[i].icon).join('')}` : '🏗️ not built yet'} · ${money(t.money)}</span>
    </div>`;
  }).join('');
  return `<div class="card"><h2>🏆 Science leaderboard</h2>${rows || '<p class="muted">No teams yet</p>'}</div>`;
}

function newsCard() {
  return `<div class="card"><h2>📰 Observatory news</h2><ul class="news">${S.news.slice(0, 14).map(n => `<li>${esc(n.text)}</li>`).join('')}</ul></div>`;
}

function hostGrantCard(g) {
  const t = g.target;
  const winners = g.winners.map(teamOf).filter(Boolean);
  return `<div class="grant ${g.type} ${winners.length ? 'won' : ''}">
    <div class="g-head"><span class="g-icon">${g.icon}</span>
      <div><div class="g-title">${esc(g.title)}</div><div class="g-sponsor">${esc(g.sponsor)}${g.type === 'community' ? ' · unlimited' : g.type === 'collab' ? ' · team-up' : ''}</div></div>
      <div class="g-reward"><b>${money(g.pay)}</b><span>🔬 ${g.sci}</span></div></div>
    <div class="g-target">🎯 ${esc(t.name)}${t.dec != null ? ` <span class="coords">Dec ${fmtDec(t.dec)}</span>` : ''}</div>
    <div class="chips">${reqChips(g, S.static.instruments)}</div>
    <div class="g-foot">
      ${S.phase === 'plan' ? `<span class="small muted">${teamDots(g.applicants, S.teams)} ${g.applicants.length} applied</span>` : ''}
      ${winners.map(w => `<span class="team-chip" style="--c:${w.color}">🏅 ${esc(w.name)}</span>`).join('')}
    </div>
  </div>`;
}

function siteBoard() {
  const sites = Object.values(S.static.sites).map(s => {
    const here = S.teams.filter(t => t.site === s.id);
    const w = S.run && S.run.weather && S.run.weather[s.id];
    const chips = here.map(t => {
      const icon = !t.tonight ? '' : t.tonight.status === 'observing' ? (t.tonight.ao ? '✨' : '🔭') : t.tonight.status === 'lost' ? '☁️' : '😴';
      return `<span class="team-chip" style="--c:${t.color}" title="${esc(t.tonight ? t.tonight.msg : '')}">${icon} ${esc(t.name)} · ${t.aperture} m</span>`;
    }).join('');
    return `<div class="site">
      <div class="row"><span style="font-size:1.4rem">${s.icon}</span><div><div class="site-name">${esc(s.name)}</div><div class="small muted">lat ${fmtDec(s.lat)} · ${s.altitude} m</div></div></div>
      ${w ? `<div class="wx-mini"><span>☁️ ${w.clouds}%</span><span>🌫️ ${w.seeing}″</span><span>💧 ${w.humidity}%</span></div>` : siteMeters(s)}
      ${decBand(s.lat)}
      <div>${chips || '<span class="small muted">no teams</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="card"><h2>🌍 Observatory sites</h2><div class="site-board">${sites}</div></div>`;
}

function planView() {
  const research = S.grants.filter(g => g.type === 'competitive');
  const other = S.grants.filter(g => g.type !== 'competitive');
  const building = S.teams.filter(t => !t.site).length;
  const active = S.teams.filter(t => t.members.length);
  return `<div class="card">
      <div class="row"><h2>📜 Grants on offer: Semester ${S.round}</h2><span class="spacer"></span>
        ${building ? `<span class="muted">🏗️ ${building} team${building > 1 ? 's' : ''} still building</span>` : ''}
        <span class="phase-tag">✅ ${active.filter(t => t.ready).length}/${active.length} teams done</span></div>
      <div class="grant-grid">${research.map(hostGrantCard).join('')}</div>
      <div class="section-title"><h3>Community & team-up grants</h3></div>
      <div class="grant-grid">${other.map(hostGrantCard).join('')}</div>
    </div>${siteBoard()}`;
}

function awardView() {
  const won = S.grants.filter(g => g.winners.length && g.type !== 'community');
  const community = S.grants.filter(g => g.type === 'community' && g.winners.length);
  return `<div class="card"><h2>📜 Grants awarded!</h2>
    <p class="muted">Teams that were behind got first pick. Every team has at least one grant to work on.</p>
    <div class="grant-grid">${won.map(hostGrantCard).join('')}${community.map(hostGrantCard).join('')}</div>
  </div>`;
}

function runView() {
  const run = S.run;
  const bar = Array.from({ length: run.nights }, (_, i) => `<span class="${i < run.night ? 'on' : ''}"></span>`).join('');
  const ev = run.event;
  return `<div class="card">
      <h2>🌙 Observing: night ${run.night} of ${run.nights}</h2>
      <div class="nightbar">${bar}</div>
      ${ev ? `<div class="banner">💥 ${esc(ev.name)} · RA ${ev.ra}, Dec ${fmtDec(ev.dec)}. Who can see it? ${ev.foundBy ? `First spectrum: <b>${esc(teamOf(ev.foundBy).name)}</b>` : 'Waiting for a spectrograph…'}</div>` : ''}
      <p class="small muted">🔭 observing · ✨ observing with adaptive optics · ☁️ lost the night to weather · 😴 nothing left to do</p>
    </div>${siteBoard()}`;
}

function reportView() {
  const rows = ranked().map((t, i) => `<div class="leader">
      <span class="rank">${i + 1}</span>
      <span class="name"><span class="dot" style="background:${t.color}"></span> ${esc(t.name)}</span>
      <span class="sci">+${t.report ? t.report.sciGained : 0}</span>
      <span class="sub">${t.report ? `${t.report.completed.length} grant${t.report.completed.length === 1 ? '' : 's'} done${t.report.partial.length ? `, ${t.report.partial.length} unfinished` : ''} · running costs ${money(t.report.opCost)}` : ''}</span>
    </div>`).join('');
  return `<div class="prompt">💬 ${esc(PROMPTS[(S.round - 1) % PROMPTS.length])}</div>
    <div class="card"><h2>📊 Semester ${S.round} results (science gained)</h2>${rows}</div>`;
}

function finalView() {
  const f = S.final || { awards: [], highlights: {} };
  const card = a => {
    const t = teamOf(a.teamId) || { name: '?', color: '#888' };
    return `<div class="award ${a.spotlight ? 'spotlight' : ''}" style="--c:${t.color}">
      <div class="a-icon">${a.icon}</div><b>${esc(a.title)}</b>
      <div class="a-team">${esc(t.name)}</div><div>${esc(a.value)}</div><div class="a-why">${esc(a.why)}</div>
    </div>`;
  };
  return `<div class="stack">
    <div class="card" style="text-align:center"><h1 style="font-size:2.4rem">🎓 Awards ceremony</h1>
      <p class="muted">Every observatory did something great. Here's what each team did best.</p></div>
    <div class="award-grid">${f.awards.map(card).join('')}</div>
    ${leaderboard()}
  </div>`;
}

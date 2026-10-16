// Student / team screen.
const app = $('#app');
// ?code=&pid= restores a session (handy for reconnecting from another tab)
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('pid')) { store.set('otPlayer', { code: urlParams.get('code'), pid: urlParams.get('pid') }); history.replaceState(null, '', 'play.html'); }
const session = store.get('otPlayer');
let S = null, YOU = null;
const ui = { tab: 'grants', site: null, aperture: null };

if (!session) location.href = '/';
else connectStream({ code: session.code, pid: session.pid }, onMsg, () => {
  store.del('otPlayer');
  app.innerHTML = `<div class="landing card"><h2>Game not found</h2><p class="muted">It may have ended or the server restarted.</p><a href="/"><button>Join again</button></a></div>`;
});

function onMsg({ you, state }) {
  if (you.removed) { store.del('otPlayer'); location.href = '/'; return; }
  YOU = you; S = state;
  window.__paused = state.paused;
  syncTimer(state);
  render();
  updateTimers();
}

async function act(type, extra = {}) {
  try { await post('/api/action', { code: session.code, pid: session.pid, type, ...extra }); }
  catch (e) { toast(e.message); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-ui]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.ui === 'tab') { ui.tab = d.tab; render(); return; }
  if (d.ui === 'site') { ui.site = d.site; render(); return; }
  if (d.ui === 'aperture') { ui.aperture = Number(d.ap); render(); return; }
  if (d.confirm && !confirm(d.confirm)) return;
  if (d.act) act(d.act, { ...d, act: undefined, confirm: undefined });
});

const can = role => !S.roleLocks || YOU.roles.includes(role);
const roleTitle = role => can(role) ? '' : `title="This is the ${ROLE_INFO[role].label}'s job"`;

function render() {
  const team = S.teams.find(t => t.id === YOU.teamId);
  if (!team) return renderTeamPicker();
  if (S.phase === 'lobby') return renderLobby(team);
  if (S.phase === 'final') return renderFinal(team);
  renderGame(team);
}

// ---------- before the game ----------

function renderTeamPicker() {
  const teams = S.teams.map(t => `
    <div class="team-card" style="--c:${t.color}">
      <div class="row"><b>${esc(t.name)}</b><span class="spacer"></span><span class="small muted">${t.members.length}/4</span></div>
      ${t.members.map(m => `<div class="member">${esc(m.name)}</div>`).join('') || '<div class="small muted">empty</div>'}
      <button class="ghost tiny" style="margin-top:.5rem" data-act="joinTeam" data-team-id="${t.id}" ${t.members.length >= 4 ? 'disabled' : ''}>Join this team</button>
    </div>`).join('');
  app.innerHTML = `<div class="wrap" style="max-width:900px">
    <h1>Hi ${esc(YOU.name)}! 👋</h1>
    <p class="muted">Play solo by starting your own team, or join a friend's team (up to 4 players).</p>
    <button class="big" data-act="createTeam">🚀 Start a new team</button>
    ${S.teams.length ? `<h2 style="margin-top:1.5rem">Or join a team</h2><div class="team-list">${teams}</div>` : ''}
  </div>`;
}

function rolesList(team) {
  return team.members.map(m => `<div class="member ${m.online ? '' : 'offline'}">
    <b>${esc(m.name)}</b> ${m.roles.map(r => `<span class="role-badge">${ROLE_INFO[r].icon} ${ROLE_INFO[r].label}</span>`).join(' ')}
  </div>`).join('');
}

function renderLobby(team) {
  app.innerHTML = `<div class="wrap" style="max-width:760px">
    <div class="team-card" style="--c:${team.color}">
      <h1>${esc(team.name)}</h1>
      ${rolesList(team)}
      <div class="tip">${Object.values(ROLE_INFO).map(r => `${r.icon} <b>${r.label}</b>: ${r.job}`).join('<br>')}</div>
      <div class="row" style="margin-top:1rem">
        <span class="muted">Waiting for your teacher to start the game…</span><span class="spacer"></span>
        <button class="ghost tiny" data-act="leaveTeam">Leave team</button>
      </div>
    </div>
    <div class="card" style="margin-top:1rem">
      <h2>How to play</h2>
      <p>🏗️ <b>Build</b> an observatory: pick a site and mirror size. Location decides which part of the sky you can see and how good your weather is.</p>
      <p>📜 <b>Apply</b> for grants. Each one needs certain instruments, a big enough mirror and good enough weather.</p>
      <p>🌙 <b>Observe</b>: each semester has ${8} nights. Your telescope works on whichever grant tonight's weather allows.</p>
      <p>🔬 <b>Earn science</b>. Science points decide the winner, and money buys upgrades so you can take on bigger grants.</p>
    </div>
  </div>`;
}

// ---------- main game ----------

function topbar(team) {
  return `<header class="topbar">
    <span class="brand">🔭 Observatory Tycoon</span>
    <span class="team-pill" style="--c:${team.color}">${esc(team.name)}</span>
    ${YOU.roles.map(r => `<span class="role-badge" title="${ROLE_INFO[r].job}">${ROLE_INFO[r].icon} ${ROLE_INFO[r].label}</span>`).join('')}
    <span class="spacer"></span>
    <span class="stat" title="Money">💰 ${money(team.money)}</span>
    <span class="stat" title="Science points: this decides the winner">🔬 ${team.science}</span>
    <span class="phase-box"><span class="phase-tag">Semester ${S.round}/${S.rounds} · ${PHASE_LABEL[S.phase]}</span><span data-timer></span></span>
  </header>`;
}

function renderGame(team) {
  const site = team.site && S.static.sites[team.site];
  const weather = S.run && S.run.weather && site ? S.run.weather[team.site] : null;
  const left = `
    <div class="card">
      ${observatorySVG(team, { weather, tonight: team.tonight })}
      ${site ? `<div class="row" style="margin-top:.6rem"><b>${site.icon} ${esc(site.name)}</b><span class="muted small">${esc(site.region)} · lat ${fmtDec(site.lat)} · ${site.altitude} m high</span></div>
        <div class="inst-row">${team.instruments.map(i => `<span>${S.static.instruments[i].icon} ${esc(S.static.instruments[i].name)}</span>`).join('') || '<span class="muted">No instruments yet</span>'}</div>
        <div class="small muted" style="margin-top:.4rem">Running costs: ${money(team.opCost)} per semester</div>
        ${decBand(site.lat)}` : `<p class="muted">No observatory yet. Your Engineer picks a site and mirror.</p>`}
    </div>
    ${queueCard(team)}
    <div class="card"><h3>Your team</h3>${rolesList(team)}</div>`;

  let right;
  if (S.paused) right = `<div class="card"><h2>⏸ Paused</h2><p class="muted">Eyes on your teacher!</p></div>`;
  else if (!team.site && S.phase === 'plan') right = readyBar(team) + foundingWizard(team);
  else if (S.phase === 'plan') right = planView(team);
  else if (S.phase === 'award') right = awardView(team);
  else if (S.phase === 'run') right = runView(team);
  else if (S.phase === 'report') right = reportView(team);
  else right = '';

  app.innerHTML = topbar(team) + `<div class="wrap"><div class="game-grid"><div class="stack">${left}</div><div class="stack">${right}</div></div></div>`;
}

function queueCard(team) {
  if (!team.active.length) {
    return `<div class="card"><h3>🗓️ This semester's queue</h3><p class="muted small">No grants yet. Your Director applies during Planning, and grants are handed out when the timer ends.</p></div>`;
  }
  const items = team.active.map((a, i) => {
    const isTonight = team.tonight && team.tonight.grantId === a.grant.id;
    return `<div class="queue-item ${a.done ? 'done' : ''} ${isTonight ? 'tonight' : ''}">
      <div><b>${a.grant.icon} ${esc(a.grant.title)}</b><div class="small muted">${esc(a.grant.target.name)} · ☁️≤${a.grant.cc}% 🌫️≤${a.grant.iq}″${a.grant.wv != null ? ` 💧≤${a.grant.wv}%` : ''}</div></div>
      <div class="row">
        ${a.done ? '✅' : `<button class="ghost tiny" data-act="movePriority" data-grant-id="${a.grant.id}" data-dir="up" ${i === 0 || !can('scheduler') ? 'disabled' : ''} ${roleTitle('scheduler')}>▲</button>
        <button class="ghost tiny" data-act="movePriority" data-grant-id="${a.grant.id}" data-dir="down" ${i === team.active.length - 1 || !can('scheduler') ? 'disabled' : ''} ${roleTitle('scheduler')}>▼</button>`}
      </div>
      <div class="progress"><i style="width:${a.progress / a.needed * 100}%"></i></div>
      <div class="small muted" style="grid-column:1/-1">${a.done ? `✅ Paid ${money(a.grant.pay)}` : `💰 Pays ${money(a.grant.pay)} when finished`} · ${a.progress}/${a.needed} good nights${a.partnerId ? ` · 🤝 with ${esc((S.teams.find(t => t.id === a.partnerId) || {}).name)}` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="card"><h3>🗓️ This semester's queue</h3>${items}
    <div class="tip">Each night the telescope works on the <b>highest</b> grant that tonight's weather allows. Put the picky grants (sharp seeing, dry air) on top so they grab the rare great nights!</div></div>`;
}

function foundingWizard(team) {
  const sites = Object.values(S.static.sites);
  const site = ui.site && S.static.sites[ui.site];
  const siteCards = sites.map(s => `
    <div class="site ${ui.site === s.id ? 'on' : ''}" data-ui="site" data-site="${s.id}">
      <div class="row"><span style="font-size:1.4rem">${s.icon}</span><div><div class="site-name">${esc(s.name)}</div><div class="small muted">${esc(s.region)} · lat ${fmtDec(s.lat)} · ${s.altitude} m</div></div></div>
      ${siteMeters(s)}
      ${decBand(s.lat)}
      <p class="small muted">${esc(s.blurb)}</p>
      <div class="small">Building cost ×${s.costMult}</div>
    </div>`).join('');
  const apOpts = S.static.apertures.map(ap => {
    const cost = site ? Math.round(S.static.apertureCost[ap] * site.costMult * 10) / 10 : null;
    return `<button class="ap-opt ${ui.aperture === ap ? 'on' : ''}" data-ui="aperture" data-ap="${ap}" ${site && cost > team.money ? 'disabled' : ''}>
      <b>${ap} m</b><span class="small">${cost != null ? money(cost) : 'pick a site'}</span></button>`;
  }).join('');
  const cost = site && ui.aperture ? Math.round(S.static.apertureCost[ui.aperture] * site.costMult * 10) / 10 : null;
  return `<div class="card">
    <h2>🏗️ Build your observatory</h2>
    <p class="muted">You have <b>${money(team.money)}</b>. Pick a site, then a mirror size. Save some money for instruments: you need at least one to win most grants!</p>
    <h3 style="margin-top:1rem">1. Choose a site</h3>
    <div class="site-grid">${siteCards}</div>
    <h3 style="margin-top:1rem">2. Choose a mirror size</h3>
    <p class="small muted">Bigger mirrors collect more light, so you can see fainter things and finish grants faster. They also cost more to build and run.</p>
    <div class="ap-row">${apOpts}</div>
    <div class="row" style="margin-top:1rem">
      ${cost != null ? `<span>Total: <b>${money(cost)}</b>, leaving <b>${money(team.money - cost)}</b> for instruments</span>` : ''}
      <span class="spacer"></span>
      <button class="big" data-act="found" data-site="${ui.site || ''}" data-aperture="${ui.aperture || ''}" ${!cost || !can('engineer') ? 'disabled' : ''} ${roleTitle('engineer')}>Build it! 🔨</button>
    </div>
    ${can('engineer') ? '' : '<div class="tip">Your Engineer clicks Build. Help them decide!</div>'}
  </div>`;
}

function planView(team) {
  const tabs = `<div class="tabs">
    <button class="${ui.tab === 'grants' ? 'on' : ''}" data-ui="tab" data-tab="grants">📜 Grants (${team.applications.length} applied)</button>
    <button class="${ui.tab === 'shop' ? 'on' : ''}" data-ui="tab" data-tab="shop">🛠️ Upgrades</button>
    ${team.report ? `<button class="${ui.tab === 'report' ? 'on' : ''}" data-ui="tab" data-tab="report">📊 Last semester</button>` : ''}
  </div>`;
  const body = ui.tab === 'shop' ? shopView(team) : ui.tab === 'report' && team.report ? reportView(team) : grantBoard(team);
  return `<div>${readyBar(team)}${tabs}${body}</div>`;
}

function readyBar(team) {
  const active = S.teams.filter(t => t.members.length);
  const ready = active.filter(t => t.ready).length;
  return `<div class="card ready-bar ${team.ready ? 'is-ready' : ''}">
    <span>⏱ Planning ends in <b data-timer></b> or when every team is done <span class="muted">(${ready}/${active.length} ready)</span></span>
    <span class="spacer"></span>
    ${team.ready
      ? `<span class="small">✅ Waiting for other teams…</span><button class="ghost" data-act="ready">↩ Not done yet</button>`
      : `<button data-act="ready" ${planWarnings(team).length ? `data-confirm="${esc(planWarnings(team).join('\n') + '\n\nFinish planning anyway?')}"` : ''}>✅ We're done planning</button>`}
    ${planWarnings(team).map(w => `<div class="plan-warn">⚠️ ${esc(w)}</div>`).join('')}
  </div>`;
}

function planWarnings(team) {
  const w = [];
  if (!team.site) w.push("You haven't built your observatory yet.");
  else if (!team.instruments.length) w.push('You have no instruments, so you can only win the Public Star Party. Buy one in Upgrades!');
  if (team.site && !team.applications.length) w.push("You haven't applied for any grants. No grants means no money this semester.");
  return w;
}

function grantCard(team, g, extraClass = '') {
  const info = team.grantInfo[g.id] || { ok: false, reasons: [], notes: [] };
  const appIdx = team.applications.indexOf(g.id);
  const applied = appIdx >= 0;
  const won = g.winners.includes(team.id);
  const t = g.target;
  let action = '';
  if (S.phase === 'plan') {
    action = applied
      ? `<span class="choice">#${appIdx + 1} choice</span>
         <button class="ghost tiny" data-act="moveApp" data-grant-id="${g.id}" data-dir="up" ${appIdx === 0 || !can('director') ? 'disabled' : ''}>▲</button>
         <button class="ghost tiny" data-act="moveApp" data-grant-id="${g.id}" data-dir="down" ${appIdx === team.applications.length - 1 || !can('director') ? 'disabled' : ''}>▼</button>
         <button class="ghost tiny" data-act="withdraw" data-grant-id="${g.id}" ${can('director') ? '' : 'disabled'}>Withdraw</button>`
      : !info.ok ? `<span class="small muted">🔒 Not eligible yet</span>`
      : !can('director') ? `<span class="small muted">🧑‍💼 Your Director applies</span>`
      : `<button class="tiny" data-act="apply" data-grant-id="${g.id}">Apply</button>`;
  }
  const others = g.applicants.filter(id => id !== team.id);
  const missingInst = (info.reasons || []).filter(r => r.startsWith('Needs'));
  return `<div class="grant ${g.type} ${info.ok ? '' : 'locked'} ${applied ? 'applied' : ''} ${won ? 'won' : ''} ${extraClass}">
    ${missingInst.length ? `<div class="lock-strip">🔒 ${missingInst.map(esc).join(' · ')}</div>`
      : !info.ok ? `<div class="lock-strip">🔒 ${(info.reasons || []).some(r => /rises|climbs/.test(r)) ? "Can't see this target from your site" : (info.reasons || []).some(r => /mirror/.test(r)) ? 'Your mirror is too small' : 'Not eligible'}</div>` : ''}
    <div class="g-head"><span class="g-icon">${g.icon}</span>
      <div><div class="g-title">${esc(g.title)}</div><div class="g-sponsor">${esc(g.sponsor)}${g.type === 'community' ? ' · unlimited' : g.type === 'collab' ? ' · team-up' : ''}</div></div>
      <div class="g-reward"><b>${money(g.pay)}</b><span>🔬 ${g.sci}</span></div></div>
    <div class="g-target">🎯 ${esc(t.name)} ${t.dec != null ? `<span class="coords">RA ${t.ra} · Dec ${fmtDec(t.dec)}${info.maxAlt != null ? ` · rises to ${Math.max(info.maxAlt, 0)}° at your site` : ''}</span>` : ''}</div>
    <div class="chips">${reqChips(g, S.static.instruments)}</div>
    <div class="g-blurb">${esc(g.blurb)}</div>
    ${g.pairText ? `<div class="notes">🤝 ${esc(g.pairText)}</div>` : ''}
    ${info.ok
      ? `<div class="row small">🌙 ${info.needed} good night${info.needed > 1 ? 's' : ''} needed ${oddsBadge(info.odds)}</div>`
      : `<ul class="reasons">${info.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
         ${info.reasons.some(r => r.startsWith('Needs')) ? `<button class="ghost tiny" data-ui="tab" data-tab="shop">🛠️ Go to Upgrades</button>` : ''}`}
    ${info.notes && info.notes.length ? `<div class="notes">${info.notes.map(esc).join(' · ')}</div>` : ''}
    <div class="g-foot">
      ${g.type === 'competitive' && others.length ? `<span class="small muted">${teamDots(others, S.teams)} ${others.length} other team${others.length > 1 ? 's' : ''}</span>` : ''}
      ${won ? '<span class="choice" style="color:var(--good)">🏅 WON</span>' : ''}
      <span class="spacer"></span>${action}
    </div>
  </div>`;
}

function grantBoard(team) {
  const info = id => team.grantInfo[id] || {};
  const research = S.grants.filter(g => g.type === 'competitive').sort((a, b) => (info(b.id).ok ? 1 : 0) - (info(a.id).ok ? 1 : 0));
  const others = S.grants.filter(g => g.type !== 'competitive').sort((a, b) => (info(b.id).ok ? 1 : 0) - (info(a.id).ok ? 1 : 0));
  return `<div class="card">
    <div class="row"><h2>📜 Grant board</h2><span class="spacer"></span><span class="small muted">You can hold up to ${S.maxActive} grants per semester</span></div>
    <p class="small muted">Apply to grants in order of preference. When time runs out, teams take turns picking from their lists. <b>Teams that are behind pick first!</b> Community grants are unlimited.</p>
    ${can('director') ? '' : '<div class="tip">Your Director applies for grants. Read them together and help choose!</div>'}
    ${team.instruments.length ? '' : `<div class="tip" style="border:1px solid var(--accent-2)">📷 <b>You don't have any instruments yet!</b> Almost every grant needs one. A telescope without a camera can only host a star party.
      <button class="tiny" data-ui="tab" data-tab="shop" style="margin-left:.5rem">🛠️ Buy instruments</button></div>`}
    <div class="section-title"><h3>Research grants</h3><span class="small muted">one winner each</span></div>
    <div class="grant-grid">${research.map(g => grantCard(team, g)).join('')}</div>
    <div class="section-title"><h3>Community & team-up grants</h3></div>
    <div class="grant-grid">${others.map(g => grantCard(team, g)).join('')}</div>
  </div>`;
}

function shopView(team) {
  const site = S.static.sites[team.site];
  const apCost = ap => Math.round((S.static.apertureCost[ap] - S.static.apertureCost[team.aperture]) * site.costMult * 10) / 10;
  const mirrors = S.static.apertures.filter(ap => ap > team.aperture).map(ap => `
    <div class="shop-item">
      <b>🪞 ${ap} m mirror</b>
      <span class="small muted">Collects ${Math.round((ap / team.aperture) ** 2)}× more light than your ${team.aperture} m. Unlocks bigger grants and finishes small ones faster.</span>
      <div class="row"><span class="price">${money(apCost(ap))}</span><span class="spacer"></span>
        <button class="tiny" data-act="upgrade" data-aperture="${ap}" ${apCost(ap) > team.money || !can('engineer') ? 'disabled' : ''} ${roleTitle('engineer')}>Upgrade</button></div>
    </div>`).join('') || '<p class="muted">You have the biggest mirror there is! 🎉</p>';
  const insts = Object.values(S.static.instruments).map(inst => {
    const owned = team.instruments.includes(inst.id);
    const missing = (inst.requires || []).filter(r => !team.instruments.includes(r));
    return `<div class="shop-item ${owned ? 'owned' : ''}">
      <b>${inst.icon} ${esc(inst.name)} ${inst.band === 'ir' ? '<span class="chip ir">infrared</span>' : ''}</b>
      <span class="small muted">${esc(inst.blurb)}</span>
      <div class="row"><span class="price">${owned ? '✅ Installed' : money(inst.cost)}</span><span class="spacer"></span>
        ${owned ? '' : `<button class="tiny" data-act="buy" data-instrument="${inst.id}" ${inst.cost > team.money || missing.length || !can('engineer') ? 'disabled' : ''} ${roleTitle('engineer')}>Buy</button>`}</div>
      ${missing.length ? `<span class="small" style="color:var(--warn)">Needs ${missing.map(m => S.static.instruments[m].name).join(', ')} first</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="card stack">
    <div><h2>🛠️ Upgrades</h2><p class="small muted">You have <b>${money(team.money)}</b>. Every upgrade adds to your running costs, so spend wisely!</p>
      ${can('engineer') ? '' : '<div class="tip">Your Engineer buys upgrades. Tell them what your grants need!</div>'}</div>
    <div><h3>Mirror</h3><div class="shop-grid">${mirrors}</div></div>
    <div><h3>Instruments</h3><div class="shop-grid">${insts}</div></div>
  </div>`;
}

function awardView(team) {
  const won = S.grants.filter(g => team.awarded.includes(g.id));
  const missed = S.grants.filter(g => team.missed.includes(g.id));
  return `<div class="card">
    <h2>📜 Grants awarded!</h2>
    ${team.autoAssigned
      ? `<div class="result-box bad">❌ <b>You didn't win any grants this semester.</b><br>
          ${team.missed.length ? 'Other teams won the grants you applied for.' : "Your team didn't apply for any."}
          ${team.instruments.length ? '' : ' You also have no instruments, and most grants need one.'}
          <br>🎉 To help out, the local astronomy club booked your telescope for a small <b>Public Star Party</b> (${money(won[0] ? won[0].pay : 3)}).</div>`
      : `<div class="result-box good">🏅 <b>You won ${won.length} grant${won.length > 1 ? 's' : ''}!</b> Each one pays when you finish its good nights.</div>`}
    <div class="grant-grid">${won.map(g => grantCard(team, g)).join('')}</div>
    ${missed.length ? `<p class="muted small" style="margin-top:1rem">Missed out on: ${missed.map(g => esc(g.title)).join(', ')} (another team got them, or you were full)</p>` : ''}
    <div class="tip">🗓️ Scheduler: check the queue on the left. Observing starts in a moment!</div>
  </div>`;
}

function runView(team) {
  const run = S.run;
  const site = S.static.sites[team.site];
  const w = run.weather && site ? run.weather[team.site] : null;
  const ev = run.event;
  const bar = Array.from({ length: run.nights }, (_, i) => `<span class="${i < run.night ? 'on' : ''}"></span>`).join('');
  const eff = w ? effSeeing(team.instruments, w.seeing) : null;
  return `<div class="card">
    <h2>🌙 Night ${run.night} of ${run.nights}</h2>
    <div class="nightbar">${bar}</div>
    ${ev ? `<div class="banner">💥 ${esc(ev.name)} (Dec ${fmtDec(ev.dec)})${ev.foundBy ? ` · first spectrum by ${esc((S.teams.find(t => t.id === ev.foundBy) || {}).name)}` : ''}</div>` : ''}
    ${w ? `<h3 style="margin-top:1rem">Weather at ${esc(site.name)} tonight</h3>
    <div class="weather-row">
      <div class="wx">☁️ Clouds<b>${w.clouds}%</b></div>
      <div class="wx">🌫️ Seeing<b>${eff}″</b>${eff !== w.seeing ? `<span class="small muted">${w.seeing}″ before ✨AO</span>` : '<span class="small muted">smaller = sharper</span>'}</div>
      <div class="wx">💧 Humidity<b>${w.humidity}%</b></div>
    </div>` : '<p class="muted">The sun is setting… observing starts soon.</p>'}
    ${team.tonight ? `<div class="tonight-msg ${team.tonight.status}">${esc(team.tonight.msg)}</div>` : ''}
    ${team.tonight && team.tonight.finished ? `<div class="result-box good">🎉 Finished “${esc(team.tonight.finished.title)}”! <b>+${money(team.tonight.finished.pay)}</b> and +${team.tonight.finished.sci} science</div>` : ''}
    ${team.tonight && team.tonight.bonus ? `<div class="bonus">${esc(team.tonight.bonus)}</div>` : ''}
    <div class="row" style="margin-top:1rem">
      <span>📜 Grants: <b>${team.active.filter(a => a.done).length}/${team.active.length}</b> finished</span>
      <span>💰 Earned this semester: <b>${money(team.semesterEarned || 0)}</b></span>
      <span class="muted small">Running costs of ${money(team.opCost)} are paid at the end</span>
    </div>
  </div>`;
}

function reportView(team) {
  const r = team.report;
  if (!r) return `<div class="card"><h2>📊 Semester report</h2><p class="muted">Build an observatory next semester to start earning!</p></div>`;
  return `<div class="card">
    <h2>📊 Semester ${S.phase === 'report' ? S.round : S.round - 1} report</h2>
    <p style="font-size:1.3rem">🔬 <b>+${r.sciGained}</b> science this semester</p>
    ${r.completed.map(c => `<div>✅ ${c.icon} ${esc(c.title)}: <b>+${money(c.pay)}</b>, +${c.sci} science</div>`).join('')}
    ${r.partial.map(p => `<div>⏳ ${p.icon} ${esc(p.title)}: ${p.progress}/${p.needed} nights, partial credit +${p.sci} science, no payment</div>`).join('')}
    ${!r.completed.length && !r.partial.length ? '<div>No grants this semester, so no grant money.</div>' : ''}
    <div class="result-box ${(r.earned || 0) - r.opCost >= 0 ? 'good' : 'bad'}" style="margin-top:.6rem">
      💰 Earned <b>${money(r.earned || 0)}</b> − running costs <b>${money(r.opCost)}</b> = <b>${(r.earned || 0) - r.opCost >= 0 ? '+' : '−'}${money(Math.abs((r.earned || 0) - r.opCost))}</b></div>
    ${r.bailout ? '<div class="tip">💸 You ran out of money! The science council covered your bills this time.</div>' : ''}
    ${r.partial.length ? '<div class="tip">Unfinished grants only earn a little science. Pick grants with better odds, or reorder your queue!</div>' : ''}
  </div>`;
}

function renderFinal(team) {
  const f = S.final || { awards: [], highlights: {} };
  const mine = f.awards.filter(a => a.teamId === team.id);
  const hl = f.highlights[team.id] || [];
  app.innerHTML = topbar(team) + `<div class="wrap stack" style="max-width:1000px">
    <div class="card" style="text-align:center">
      <h1>🎓 Game over!</h1>
      <p style="font-size:1.3rem">${esc(team.name)} finished with <b>🔬 ${team.science}</b> science and <b>${money(team.money)}</b></p>
    </div>
    ${mine.length ? `<h2>Your awards</h2><div class="award-grid">${mine.map(a => awardCard(a)).join('')}</div>` : ''}
    ${hl.length ? `<div class="card"><h2>Your team's best stats</h2>${hl.map(h => `<p>${h.icon} <b>#${h.rank}</b> in ${esc(h.label)}: ${esc(h.value)}</p>`).join('')}</div>` : ''}
    <h2>All awards</h2>
    <div class="award-grid">${f.awards.map(a => awardCard(a)).join('')}</div>
  </div>`;
}

function awardCard(a) {
  const t = S.teams.find(x => x.id === a.teamId) || { name: '?', color: '#888' };
  return `<div class="award ${a.spotlight ? 'spotlight' : ''}" style="--c:${t.color}">
    <div class="a-icon">${a.icon}</div><b>${esc(a.title)}</b>
    <div class="a-team">${esc(t.name)}</div><div>${esc(a.value)}</div><div class="a-why">${esc(a.why)}</div>
  </div>`;
}

'use strict';
const crypto = require('crypto');
const D = require('./data');

const MAX_ACTIVE = 3;       // grants a team can hold per semester
const MAX_APPLICATIONS = 6;
const MAX_TEAM_SIZE = 4;
const NIGHTS = 8;           // nights per semester
const NIGHT_MS = 3000;
const AWARD_MS = 9000;
const REPORT_MS = 15000;
const NEWS_LIMIT = 40;
const MIN_ALTITUDE = 30;    // degrees above horizon a target must reach

const ROLE_LABEL = { director: 'Director', engineer: 'Engineer', scheduler: 'Scheduler' };

class GameError extends Error {
  constructor(msg) { super(msg); this.userFacing = true; }
}

const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const clampInt = (v, lo, hi, dflt) => Number.isFinite(+v) ? clamp(Math.round(+v), lo, hi) : dflt;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function binomAtLeast(n, p, k) {
  let total = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1);
    total += c * p ** i * (1 - p) ** (n - i);
  }
  return total;
}

function sampleWeather(site, rng = Math.random, mod = null) {
  const clear = rng() < site.clear;
  let clouds = clear ? rng() * 25 : 35 + rng() * 65;
  // sum of uniforms ≈ bell curve around the site median
  let seeing = site.seeing * Math.exp((rng() + rng() + rng() - 1.5) * 0.5);
  let humidity = site.humidity + (rng() + rng() + rng() - 1.5) * 25;
  if (mod) {
    clouds += mod.clouds || 0;
    humidity += mod.humidity || 0;
  }
  return {
    clouds: Math.round(clamp(clouds, 0, 100)),
    seeing: Math.round(clamp(seeing, 0.2, 4) * 100) / 100,
    humidity: Math.round(clamp(humidity, 2, 98)),
  };
}

// AO corrects much better when the raw seeing is already decent
function effSeeing(team, seeing) {
  if (!team.instruments.includes('ao')) return seeing;
  return Math.round(seeing * (seeing <= 1.0 ? 0.35 : 0.6) * 100) / 100;
}

function checkNight(team, g, w) {
  const eff = effSeeing(team, w.seeing);
  if (w.clouds > g.cc) return { ok: false, reason: `☁️ Too cloudy (${w.clouds}% > ${g.cc}%)` };
  if (g.wv != null && w.humidity > g.wv) return { ok: false, reason: `💧 Too humid for infrared (${w.humidity}% > ${g.wv}%)` };
  if (eff > g.iq) return { ok: false, reason: `🌫️ Too blurry (${eff}″ > ${g.iq}″)` };
  return { ok: true, eff };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const maxAltitude = (lat, dec) => Math.round(90 - Math.abs(lat - dec));
const hasIR = t => t.instruments.some(i => D.INSTRUMENTS[i].band === 'ir');
const hasOptical = t => t.instruments.some(i => D.INSTRUMENTS[i].band === 'optical');

const AWARDS = [
  { id: 'science', icon: '🏆', title: 'Science Champion', short: 'Science', stat: t => t.science, fmt: v => `${v} science points`,
    why: 'Science is the real goal of every observatory. Money is just how you get there.' },
  { id: 'discovery', icon: '🔍', title: 'Discovery Award', short: 'Discoveries', stat: t => t.stats.discoveries, fmt: v => plural(v, 'discovery', 'discoveries'),
    why: 'Many famous discoveries were surprises found while looking for something else.' },
  { id: 'efficiency', icon: '💡', title: 'Best Bang for the Buck', short: 'Science per $', stat: t => t.stats.spent ? t.science / t.stats.spent : 0,
    fmt: v => `${v.toFixed(1)} science per $1M`, why: 'Real observatories run on taxpayer money and have to make every dollar count.' },
  { id: 'collab', icon: '🤝', title: 'Best Collaborators', short: 'Team-ups', stat: t => t.stats.collabs, fmt: v => plural(v, 'team-up', 'team-ups'),
    why: 'Modern astronomy is done by teams spread across the world, like the Event Horizon Telescope.' },
  { id: 'south', icon: '🧭', title: 'Southern Sky Explorer', short: 'Southern targets', stat: t => t.stats.south, fmt: v => plural(v, 'southern target', 'southern targets'),
    why: 'The Magellanic Clouds and our galaxy’s center are best seen from the Southern Hemisphere.' },
  { id: 'ir', icon: '🔥', title: 'Infrared Pioneer', short: 'Infrared grants', stat: t => t.stats.ir, fmt: v => plural(v, 'infrared grant', 'infrared grants'),
    why: 'Infrared sees through dust, but water vapor blocks it. That’s why IR telescopes go high and dry.' },
  { id: 'ao', icon: '✨', title: 'Sharpest Eyes', short: 'Ultra-sharp grants', stat: t => t.stats.ao, fmt: v => plural(v, 'ultra-sharp grant', 'ultra-sharp grants'),
    why: 'Adaptive optics removes atmospheric blur, letting ground telescopes rival space telescopes.' },
  { id: 'nightowl', icon: '🦉', title: 'Night Owl Scheduler', short: 'Nights used well',
    stat: t => (t.stats.nightsUsed + t.stats.nightsLost) ? t.stats.nightsUsed / (t.stats.nightsUsed + t.stats.nightsLost) : 0,
    fmt: v => `${Math.round(v * 100)}% of nights put to work`, why: 'Queue observing means matching each night’s weather to the right project.' },
  { id: 'comeback', icon: '🚀', title: 'Comeback Award', short: 'Second-half science', stat: t => t.science - (t.stats.scienceAtHalf ?? 0),
    fmt: v => `+${v} science in the second half`, why: 'Science is a long game. Steady improvement pays off.' },
  { id: 'versatile', icon: '🧰', title: 'Swiss Army Telescope', short: 'Instruments', stat: t => t.instruments.length, fmt: v => plural(v, 'instrument', 'instruments'),
    why: 'Observatories like Gemini swap between many instruments to tackle different science.' },
  { id: 'grants', icon: '📜', title: 'Grant Machine', short: 'Grants completed', stat: t => t.stats.completed, fmt: v => plural(v, 'grant completed', 'grants completed'),
    why: 'Finishing what you promise keeps the funding coming.' },
  { id: 'tycoon', icon: '💰', title: 'Richest Observatory', short: 'Money', stat: t => t.money, fmt: v => `$${r1(v)}M in the bank`,
    why: 'A healthy budget means you can say yes to the next big idea.' },
];

class Room {
  constructor(code, settings = {}) {
    this.code = code;
    this.hostKey = crypto.randomBytes(12).toString('hex');
    this.settings = {
      rounds: clampInt(settings.rounds, 3, 12, 8),
      planSeconds: clampInt(settings.planSeconds, 45, 600, 120),
      firstPlanSeconds: clampInt(settings.firstPlanSeconds, 60, 900, 240),
    };
    this.phase = 'lobby';
    this.round = 0;
    this.phaseEnds = null;
    this.phaseDuration = 0;
    this.paused = false;
    this.pausedRemaining = 0;
    this.roleLocks = true;
    this.players = new Map(); // pid (secret) -> player
    this.teams = [];
    this.grants = [];
    this.news = [];
    this.run = null;
    this.final = null;
    this.pendingEvent = null;
    this.siteMods = {};
    this.subscribers = new Set();
    this.oddsCache = new Map();
    this.uidSeq = 0;
    this.teamSeq = 0;
    this.newsSeq = 0;
    this.dirty = false;
    this.lastActivity = Date.now();
  }

  // ---------- connections ----------

  subscribe(res, pid) {
    const sub = { res, pid };
    this.subscribers.add(sub);
    this.sendTo(sub, JSON.stringify(this.baseState()));
    this.changed();
    return sub;
  }
  unsubscribe(res) {
    for (const s of this.subscribers) if (s.res === res) this.subscribers.delete(s);
    this.changed();
  }
  isConnected(pid) {
    for (const s of this.subscribers) if (s.pid === pid) return true;
    return false;
  }
  changed() {
    this.lastActivity = Date.now();
    if (this.dirty) return;
    this.dirty = true;
    setImmediate(() => { this.dirty = false; this.broadcast(); });
  }
  broadcast() {
    const json = JSON.stringify(this.baseState());
    for (const s of this.subscribers) this.sendTo(s, json);
  }
  sendTo(sub, stateJson) {
    const p = sub.pid && this.players.get(sub.pid);
    const you = sub.pid
      ? (p ? { uid: p.uid, name: p.name, teamId: p.teamId, roles: p.teamId ? this.rolesOf(this.teamById(p.teamId), p.id) : [] } : { removed: true })
      : { host: true };
    sub.res.write(`data: {"you":${JSON.stringify(you)},"state":${stateJson}}\n\n`);
  }

  // ---------- players & teams ----------

  join(rawName) {
    const name = String(rawName || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16);
    if (!name) throw new GameError('Please type your name');
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        if (!this.isConnected(p.id)) return p.id; // rejoin after a closed tab
        throw new GameError('That name is already playing. Try adding your last initial.');
      }
    }
    const pid = crypto.randomBytes(9).toString('hex');
    this.players.set(pid, { id: pid, uid: 'p' + (++this.uidSeq), name, teamId: null });
    this.changed();
    return pid;
  }

  teamById(id) { return this.teams.find(t => t.id === id); }
  founded() { return this.teams.filter(t => t.site); }

  rolesOf(team, pid) {
    if (!team) return [];
    const n = team.members.length, i = team.members.indexOf(pid);
    if (i < 0) return [];
    if (n === 1) return ['director', 'engineer', 'scheduler'];
    if (n === 2) return i === 0 ? ['director', 'scheduler'] : ['engineer'];
    return [['director'], ['engineer'], ['scheduler']][i % 3];
  }

  nextTeamName() {
    const used = new Set(this.teams.map(t => t.name));
    const free = D.TEAM_NAMES.map(n => 'Team ' + n).filter(n => !used.has(n));
    return free.length ? pick(free) : 'Team ' + (this.teamSeq + 1);
  }

  createTeam(player) {
    if (player.teamId) this.leaveTeam(player);
    const seq = ++this.teamSeq;
    const team = {
      id: 't' + seq, name: this.nextTeamName(), color: D.TEAM_COLORS[(seq - 1) % D.TEAM_COLORS.length],
      members: [player.id], money: D.START_MONEY, science: 0, site: null, aperture: 0, instruments: [],
      applications: [], active: [], awarded: [], missed: [], ready: false, report: null, tonight: null, history: [],
      semesterStartScience: 0, semesterEarned: 0,
      stats: { completed: 0, failed: 0, discoveries: 0, collabs: 0, south: 0, ir: 0, ao: 0,
        nightsUsed: 0, nightsLost: 0, nightsIdle: 0, spent: 0, earned: 0, scienceAtHalf: null },
    };
    this.teams.push(team);
    player.teamId = team.id;
    if (this.phase !== 'lobby') this.addNews(`👋 ${team.name} just joined the race!`, team.id);
  }

  joinTeam(player, teamId) {
    const team = this.teamById(teamId);
    if (!team) throw new GameError('That team no longer exists');
    if (team.members.length >= MAX_TEAM_SIZE) throw new GameError('That team is full');
    if (player.teamId === team.id) return;
    if (player.teamId) this.leaveTeam(player);
    team.members.push(player.id);
    player.teamId = team.id;
  }

  leaveTeam(player) {
    const team = this.teamById(player.teamId);
    player.teamId = null;
    if (!team) return;
    team.members = team.members.filter(id => id !== player.id);
    // empty lobby teams vanish; mid-game teams stay so a returning player can rejoin
    if (!team.members.length && this.phase === 'lobby') this.teams = this.teams.filter(t => t !== team);
  }

  // ---------- player actions ----------

  playerAction(pid, body) {
    const p = this.players.get(pid);
    if (!p) throw new GameError('You are not in this game');
    const type = body.type;
    if (type === 'createTeam') { this.createTeam(p); return this.changed(); }
    if (type === 'joinTeam') { this.joinTeam(p, body.teamId); return this.changed(); }
    if (type === 'leaveTeam') {
      if (this.phase !== 'lobby') throw new GameError('You can only switch teams before the game starts');
      this.leaveTeam(p); return this.changed();
    }
    const team = this.teamById(p.teamId);
    if (!team) throw new GameError('Join a team first');
    const need = role => {
      if (this.roleLocks && !this.rolesOf(team, pid).includes(role)) throw new GameError(`That’s the ${ROLE_LABEL[role]}’s job!`);
    };
    const inPlan = () => { if (this.phase !== 'plan' || this.paused) throw new GameError('You can only do that during Planning'); };

    switch (type) {
      case 'found': need('engineer'); inPlan(); this.found(team, body.site, Number(body.aperture)); break;
      case 'upgrade': need('engineer'); inPlan(); this.upgrade(team, Number(body.aperture)); break;
      case 'buy': need('engineer'); inPlan(); this.buy(team, body.instrument); break;
      case 'apply': need('director'); inPlan(); this.apply(team, body.grantId); break;
      case 'withdraw': need('director'); inPlan(); team.applications = team.applications.filter(id => id !== body.grantId); break;
      case 'moveApp': need('director'); inPlan(); moveItem(team.applications, team.applications.indexOf(body.grantId), body.dir); break;
      case 'ready': inPlan(); team.ready = !team.ready; break;
      case 'movePriority': {
        need('scheduler');
        if (!['plan', 'award', 'run'].includes(this.phase)) throw new GameError('The semester is over');
        moveItem(team.active, team.active.findIndex(a => a.grant.id === body.grantId), body.dir);
        break;
      }
      default: throw new GameError('Unknown action');
    }
    this.changed();
    // planning ends early once every team says it's done
    if (type === 'ready' && this.teams.every(t => t.ready || !t.members.length)) this.advance();
  }

  apertureCost(site, ap) { return r1(D.APERTURE_COST[ap] * site.costMult); }

  spend(team, cost) {
    if (team.money < cost) throw new GameError(`Not enough money. That costs $${cost}M and you have $${r1(team.money)}M.`);
    team.money = r1(team.money - cost);
    team.stats.spent = r1(team.stats.spent + cost);
  }

  found(team, siteId, ap) {
    if (team.site) throw new GameError('You already built your observatory');
    const site = D.SITES[siteId];
    if (!site) throw new GameError('Pick a site');
    if (!D.APERTURES.includes(ap)) throw new GameError('Pick a mirror size');
    this.spend(team, this.apertureCost(site, ap));
    team.site = siteId;
    team.aperture = ap;
    this.oddsCache.clear();
    this.addNews(`🏗️ ${team.name} built a ${ap} m telescope at ${site.name}!`, team.id);
  }

  upgrade(team, ap) {
    if (!team.site) throw new GameError('Build your observatory first');
    if (!D.APERTURES.includes(ap) || ap <= team.aperture) throw new GameError('Pick a bigger mirror');
    const site = D.SITES[team.site];
    this.spend(team, r1((D.APERTURE_COST[ap] - D.APERTURE_COST[team.aperture]) * site.costMult));
    team.aperture = ap;
    this.addNews(`🪞 ${team.name} upgraded to a giant ${ap} m mirror!`, team.id);
  }

  buy(team, instId) {
    if (!team.site) throw new GameError('Build your observatory first');
    const inst = D.INSTRUMENTS[instId];
    if (!inst) throw new GameError('Unknown instrument');
    if (team.instruments.includes(instId)) throw new GameError('You already have that');
    for (const r of inst.requires || []) {
      if (!team.instruments.includes(r)) throw new GameError(`${inst.name} needs ${D.INSTRUMENTS[r].name} first`);
    }
    this.spend(team, inst.cost);
    team.instruments.push(instId);
    this.oddsCache.clear();
    if (inst.cost >= 10) this.addNews(`${inst.icon} ${team.name} installed a new ${inst.name}!`, team.id);
  }

  apply(team, grantId) {
    const g = this.grants.find(x => x.id === grantId);
    if (!g) throw new GameError('That grant is gone');
    if (team.applications.includes(grantId)) return;
    if (team.applications.length >= MAX_APPLICATIONS) throw new GameError(`You can apply to at most ${MAX_APPLICATIONS} grants`);
    const q = this.qualify(team, g);
    if (!q.ok) throw new GameError(q.reasons[0]);
    team.applications.push(grantId);
  }

  // ---------- grant logic ----------

  nightsNeeded(team, g) {
    let n = g.nights;
    if (team.aperture >= 4 * g.minAp) n--;
    if (g.faint && D.SITES[team.site].lightPollution > 0.2) n++;
    return Math.max(1, n);
  }

  qualify(team, g) {
    if (!team.site) return { ok: false, reasons: ['Build your observatory first'], notes: [] };
    const site = D.SITES[team.site];
    const reasons = [], notes = [];
    for (const i of g.instruments || []) {
      if (!team.instruments.includes(i)) reasons.push(`Needs ${D.INSTRUMENTS[i].icon} ${D.INSTRUMENTS[i].name}`);
    }
    if (g.instrumentsAny && !g.instrumentsAny.some(i => team.instruments.includes(i))) {
      reasons.push('Needs one of: ' + g.instrumentsAny.map(i => D.INSTRUMENTS[i].icon + ' ' + D.INSTRUMENTS[i].name).join(', '));
    }
    if (team.aperture < g.minAp) reasons.push(`Needs a ${g.minAp} m mirror (yours is ${team.aperture} m)`);
    let maxAlt = null;
    if (g.target.dec != null) {
      maxAlt = maxAltitude(site.lat, g.target.dec);
      if (maxAlt < MIN_ALTITUDE) {
        reasons.push(maxAlt <= 0
          ? `Never rises above the horizon at ${site.name} (Dec ${g.target.dec}°, latitude ${site.lat}°)`
          : `Only climbs ${maxAlt}° high at ${site.name}. It needs at least ${MIN_ALTITUDE}°.`);
      }
    }
    if (g.pair === 'northSouth') notes.push(`You are a ${site.lat >= 0 ? 'northern' : 'southern'} observatory`);
    if (g.pair === 'opticalIR') notes.push(`You count as ${[hasOptical(team) && 'optical', hasIR(team) && 'infrared'].filter(Boolean).join(' + ') || 'neither'}`);
    if (team.aperture >= 4 * g.minAp) notes.push('Big mirror: one less night needed');
    if (g.faint && site.lightPollution > 0.2) notes.push('City lights: one more night needed');
    const needed = this.nightsNeeded(team, g);
    const odds = reasons.length ? null : this.odds(team, g, needed);
    return { ok: !reasons.length, reasons, notes, needed, odds, maxAlt };
  }

  // Seeded Monte Carlo so the odds shown don't flicker between updates
  odds(team, g, needed) {
    const key = `${team.site}|${team.instruments.includes('ao')}|${g.id}|${needed}`;
    if (this.oddsCache.has(key)) return this.oddsCache.get(key);
    const rng = mulberry32(hashStr(key));
    const site = D.SITES[team.site];
    const N = 400;
    let good = 0;
    for (let i = 0; i < N; i++) if (checkNight(team, g, sampleWeather(site, rng)).ok) good++;
    const p = good / N;
    const result = { nightly: Math.round(p * 100), chance: Math.round(binomAtLeast(NIGHTS, p, needed) * 100) };
    this.oddsCache.set(key, result);
    return result;
  }

  generateGrants() {
    const r = this.round;
    const maxTier = r >= 4 ? 3 : r >= 2 ? 2 : 1;
    const pool = D.GRANT_TEMPLATES.filter(t => t.tier <= maxTier);
    const count = clamp(this.teams.length + 3, 5, 14);
    const scale = 1 + 0.06 * (r - 1);
    const grants = [];
    const usedTargets = new Set();
    for (let i = 0; i < count; i++) {
      // newest tier weighted up so fresh challenges appear
      // repeat a grant type only after every type has appeared once this round
      const unused = pool.filter(t => !grants.some(g => g.kind === t.kind));
      const t = pick((unused.length ? unused : pool).flatMap(t => t.tier === maxTier ? [t, t] : [t]));
      let cands = D.TARGETS.filter(x => x.types.some(ty => t.types.includes(ty)));
      // guarantee both hemispheres get something each round
      const hemi = i === 0 ? (x => x.dec < -15) : i === 1 ? (x => x.dec > 15) : null;
      if (hemi && cands.some(hemi)) cands = cands.filter(hemi);
      const fresh = cands.filter(x => !usedTargets.has(x.name));
      const target = pick(fresh.length ? fresh : cands);
      usedTargets.add(target.name);
      grants.push({
        ...t, id: `g${r}-${i}`, type: 'competitive', sponsor: pick(D.SPONSORS),
        target: { name: target.name, ra: target.ra, dec: target.dec },
        pay: Math.round(t.pay * scale * (0.9 + Math.random() * 0.3) * 2) / 2,
        sci: Math.round(t.sci * scale * (0.9 + Math.random() * 0.3)),
        winners: [],
      });
    }
    D.COMMUNITY_GRANTS.forEach((t, i) => grants.push({ ...t, id: `g${r}-c${i}`, type: 'community', tier: 1, winners: [] }));
    if (r >= 2 && this.founded().length >= 2) {
      const t = D.COLLAB_GRANTS[r % D.COLLAB_GRANTS.length];
      grants.push({ ...t, id: `g${r}-x`, type: 'collab', tier: 2, pay: Math.round(t.pay * scale * 2) / 2, sci: Math.round(t.sci * scale), winners: [] });
    }
    this.grants = grants;
  }

  // Trailing teams pick first each pass, so no team gets shut out by a faster or richer team
  allocate() {
    const order = [...this.founded()].sort((a, b) => a.science - b.science || a.money - b.money);
    const holds = t => t.active.length;
    const assign = (t, g, partnerId) => {
      t.active.push({ grant: g, needed: this.nightsNeeded(t, g), progress: 0, done: false, partnerId });
      g.winners.push(t.id);
      t.awarded.push(g.id);
    };
    order.forEach(t => { t.awarded = []; t.missed = []; });

    for (const g of this.grants.filter(x => x.type === 'collab')) {
      const apps = order.filter(t => t.applications.includes(g.id) && holds(t) < MAX_ACTIVE && this.qualify(t, g).ok);
      const fits = (a, b) => g.pair === 'northSouth'
        ? (D.SITES[a.site].lat >= 0) !== (D.SITES[b.site].lat >= 0)
        : (hasOptical(a) && hasIR(b)) || (hasIR(a) && hasOptical(b));
      outer: for (let i = 0; i < apps.length; i++) {
        for (let j = i + 1; j < apps.length; j++) {
          if (fits(apps[i], apps[j])) {
            assign(apps[i], g, apps[j].id);
            assign(apps[j], g, apps[i].id);
            this.addNews(`🤝 ${apps[i].name} and ${apps[j].name} teamed up for “${g.title}”!`);
            break outer;
          }
        }
      }
    }

    let progress = true;
    while (progress) {
      progress = false;
      for (const t of order) {
        if (holds(t) >= MAX_ACTIVE) continue;
        const next = t.applications
          .map(id => this.grants.find(g => g.id === id))
          .find(g => g && g.type !== 'collab' && !t.awarded.includes(g.id)
            && !(g.type === 'competitive' && g.winners.length) && this.qualify(t, g).ok);
        if (next) { assign(t, next); progress = true; }
      }
    }

    for (const t of order) {
      t.missed = t.applications.filter(id => !t.awarded.includes(id));
      if (!t.active.length) {
        // nobody walks away empty-handed
        const party = this.grants.find(g => g.kind === 'starparty');
        assign(t, party);
        t.autoAssigned = true;
      } else {
        t.autoAssigned = false;
      }
    }
    const won = this.grants.filter(g => g.type === 'competitive' && g.winners.length).length;
    this.addNews(`📜 Grants awarded! ${won} research grants went out to ${new Set(this.grants.flatMap(g => g.type === 'competitive' ? g.winners : [])).size} teams.`);
  }

  // ---------- semester simulation ----------

  startRun() {
    this.run = { night: 0, nights: NIGHTS, weather: null, event: null };
    this.siteMods = {};
    let ev = this.pendingEvent;
    this.pendingEvent = null;
    if (!ev && Math.random() < 0.45) ev = pick(['supernova', 'supernova', 'storm', 'storm', 'boost']);
    if (ev) this.triggerEvent(ev);
  }

  runNight() {
    const run = this.run;
    run.night++;
    run.weather = {};
    for (const id of Object.keys(D.SITES)) run.weather[id] = sampleWeather(D.SITES[id], Math.random, this.siteMods[id]);
    for (const [id, mod] of Object.entries(this.siteMods)) if (--mod.nightsLeft <= 0) delete this.siteMods[id];

    for (const team of this.founded()) {
      const w = run.weather[team.site];
      const eff = effSeeing(team, w.seeing);
      const todo = team.active.filter(a => !a.done);
      if (!todo.length) {
        team.tonight = { status: 'idle', msg: '😴 All grants done. The telescope is resting.', seeing: eff };
        team.stats.nightsIdle++;
        continue;
      }
      let chosen = null, firstReason = null;
      for (const a of todo) {
        const c = checkNight(team, a.grant, w);
        if (c.ok) { chosen = a; break; }
        if (!firstReason) firstReason = c.reason;
      }
      if (chosen) {
        chosen.progress++;
        team.stats.nightsUsed++;
        team.tonight = { status: 'observing', grantId: chosen.grant.id, seeing: eff, ao: team.instruments.includes('ao'),
          msg: `🔭 Observing ${chosen.grant.target.name} for “${chosen.grant.title}” (good night ${chosen.progress} of ${chosen.needed})` };
        if (chosen.progress >= chosen.needed) this.completeGrant(team, chosen);
      } else {
        team.stats.nightsLost++;
        team.tonight = { status: 'lost', msg: firstReason, seeing: eff };
      }
    }
    if (run.event && run.event.type === 'supernova') this.supernovaNight();
    this.changed();
  }

  completeGrant(team, a) {
    const g = a.grant;
    a.done = true;
    team.money = r1(team.money + g.pay);
    team.science += g.sci;
    team.stats.earned = r1(team.stats.earned + g.pay);
    team.semesterEarned = r1(team.semesterEarned + g.pay);
    if (team.tonight) team.tonight.finished = { title: g.title, icon: g.icon, pay: g.pay, sci: g.sci };
    team.stats.completed++;
    if (g.target.dec != null && g.target.dec < 0) team.stats.south++;
    if (g.wv != null) team.stats.ir++;
    if (g.iq <= 0.5) team.stats.ao++;
    if (g.type !== 'community') this.addNews(`✅ ${team.name} finished “${g.title}” (+${g.sci} science)`, team.id);
    const chance = 0.06 + 0.04 * Math.log2(team.aperture) + 0.05 * ((g.tier || 1) - 1);
    if (Math.random() < chance) {
      team.science += 10;
      team.stats.discoveries++;
      this.addNews(`🔍 DISCOVERY! ${team.name} ${pick(D.DISCOVERIES)} while studying ${g.target.name}! (+10)`, team.id);
    }
    if (g.type === 'collab') {
      team.stats.collabs++;
      const partner = this.teamById(a.partnerId);
      const pa = partner && partner.active.find(x => x.grant.id === g.id);
      if (pa && pa.done) {
        team.science += 5;
        partner.science += 5;
        this.addNews(`🤝 ${team.name} and ${partner.name} completed their team-up! (+5 bonus each)`);
      }
    }
  }

  supernovaNight() {
    const ev = this.run.event;
    for (const team of shuffle(this.founded())) {
      if (ev.observers.includes(team.id)) continue;
      const site = D.SITES[team.site];
      if (maxAltitude(site.lat, ev.dec) < MIN_ALTITUDE || this.run.weather[team.site].clouds > 60) continue;
      const spec = team.instruments.includes('spectro') || team.instruments.includes('irspec');
      const img = team.instruments.includes('imager') || team.instruments.includes('irimager');
      if (!spec && !img) continue;
      ev.observers.push(team.id);
      let bonus;
      if (spec && !ev.foundBy) {
        ev.foundBy = team.id;
        bonus = 15;
        team.stats.discoveries++;
        this.addNews(`💥 ${team.name} took the first spectrum of the supernova and figured out what kind of star exploded! (+15)`, team.id);
      } else {
        bonus = spec ? 6 : 4;
      }
      team.science += bonus;
      if (team.tonight) team.tonight.bonus = `💥 Supernova data! +${bonus} science (${spec ? 'spectrum' : 'light curve'})`;
    }
  }

  endSemester() {
    for (const team of this.teams) {
      const rep = { completed: [], partial: [], opCost: 0, bailout: false };
      for (const a of team.active) {
        if (a.done) { rep.completed.push({ title: a.grant.title, icon: a.grant.icon, pay: a.grant.pay, sci: a.grant.sci }); continue; }
        // partial credit keeps unfinished work worth something
        const ps = Math.floor(a.grant.sci * 0.3 * a.progress / a.needed);
        team.science += ps;
        team.stats.failed++;
        rep.partial.push({ title: a.grant.title, icon: a.grant.icon, progress: a.progress, needed: a.needed, sci: ps });
      }
      rep.opCost = D.opCost(team);
      team.money = r1(team.money - rep.opCost);
      if (team.money < 0) { team.money = 0; rep.bailout = true; }
      rep.sciGained = team.science - team.semesterStartScience;
      rep.earned = team.semesterEarned;
      team.report = rep;
      team.active = [];
      team.tonight = null;
      team.history.push({ round: this.round, science: team.science, money: team.money });
      if (this.round === Math.ceil(this.settings.rounds / 2)) team.stats.scienceAtHalf = team.science;
    }
    this.run = null;
    this.siteMods = {};
  }

  // ---------- events ----------

  triggerEvent(type) {
    switch (type) {
      case 'supernova': {
        if (this.phase !== 'run' && !this.run) { this.pendingEvent = 'supernova'; this.addNews('🔮 Astronomers predict something exciting during the next observing run…'); return; }
        const hostGal = pick(D.TARGETS.filter(t => t.types.includes('galaxy')));
        this.run.event = { type: 'supernova', name: `Supernova in ${hostGal.name}`, ra: hostGal.ra, dec: hostGal.dec, foundBy: null, observers: [] };
        this.addNews(`💥 BREAKING: A star just exploded in ${hostGal.name} (RA ${hostGal.ra}, Dec ${hostGal.dec}°)! Teams that can see it will grab data automatically.`);
        return;
      }
      case 'storm': {
        const occupied = [...new Set(this.founded().map(t => t.site))];
        const siteId = pick(occupied.length ? occupied : Object.keys(D.SITES));
        this.siteMods[siteId] = { clouds: 45, humidity: 20, nightsLeft: 3 };
        this.addNews(`⛈️ A storm is rolling over ${D.SITES[siteId].name}! Expect clouds for the next 3 nights.`);
        return;
      }
      case 'boost':
        this.founded().forEach(t => { t.money = r1(t.money + 5); });
        this.addNews('🎁 Good news! The government boosted science funding: every observatory gets $5M.');
        return;
      case 'cut':
        this.founded().forEach(t => { t.money = r1(t.money * 0.85); });
        this.addNews('✂️ Budget cuts! Every observatory loses 15% of its savings.');
        return;
      default:
        throw new GameError('Unknown event');
    }
  }

  // ---------- phases ----------

  setPhase(phase, ms) {
    this.phase = phase;
    this.phaseDuration = ms || 0;
    this.phaseEnds = ms ? Date.now() + ms : null;
    if (this.paused) this.pausedRemaining = ms || 0;
  }

  beginRound(r) {
    this.round = r;
    for (const t of this.teams) {
      t.applications = []; t.awarded = []; t.missed = []; t.autoAssigned = false; t.ready = false;
      t.semesterStartScience = t.science;
      t.semesterEarned = 0;
    }
    this.oddsCache.clear();
    this.generateGrants();
    this.setPhase('plan', 1000 * (r === 1 ? this.settings.firstPlanSeconds : this.settings.planSeconds));
    this.addNews(`📅 Semester ${r} of ${this.settings.rounds} begins. New grants are posted!`);
  }

  advance() {
    switch (this.phase) {
      case 'plan': this.allocate(); this.setPhase('award', AWARD_MS); break;
      case 'award': this.startRun(); this.setPhase('run', 1500); break;
      case 'run':
        if (this.run.night < NIGHTS) { this.runNight(); this.setPhase('run', NIGHT_MS); }
        else { this.endSemester(); this.setPhase('report', REPORT_MS); }
        break;
      case 'report':
        if (this.round < this.settings.rounds) this.beginRound(this.round + 1);
        else this.finish();
        break;
      default: return;
    }
    this.changed();
  }

  tick() {
    if (this.paused || !this.phaseEnds) return;
    if (Date.now() >= this.phaseEnds) this.advance();
  }

  finish() {
    if (this.run) this.endSemester();
    this.final = this.computeAwards();
    this.setPhase('final', 0);
    this.addNews('🎓 The game is over! Time for the awards ceremony.');
  }

  computeAwards() {
    const teams = this.founded();
    const wins = new Map(teams.map(t => [t.id, 0]));
    const awards = [];
    const ranks = {}; // teamId -> [{cat, value, rank}]
    for (const cat of AWARDS) {
      const scored = teams.map(t => ({ t, v: cat.stat(t) })).filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v || a.t.science - b.t.science);
      scored.forEach((x, i) => (ranks[x.t.id] ||= []).push({ cat, v: x.v, rank: i + 1 }));
    }
    for (const cat of AWARDS) {
      const scored = teams.map(t => ({ t, v: cat.stat(t) })).filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v || wins.get(a.t.id) - wins.get(b.t.id) || a.t.science - b.t.science);
      if (!scored.length) continue;
      const w = scored[0];
      wins.set(w.t.id, wins.get(w.t.id) + 1);
      awards.push({ id: cat.id, icon: cat.icon, title: cat.title, why: cat.why, teamId: w.t.id, value: cat.fmt(w.v) });
    }
    // every team leaves with at least one thing to be proud of
    for (const t of teams) {
      if (wins.get(t.id)) continue;
      const best = (ranks[t.id] || []).sort((a, b) => a.rank - b.rank)[0];
      if (best) awards.push({ id: 'spot-' + t.id, icon: '🌟', title: `Rising Star: ${best.cat.short}`, why: best.cat.why, teamId: t.id, value: `#${best.rank} · ${best.cat.fmt(best.v)}`, spotlight: true });
    }
    const highlights = {};
    for (const t of teams) {
      highlights[t.id] = (ranks[t.id] || []).sort((a, b) => a.rank - b.rank).slice(0, 3)
        .map(x => ({ icon: x.cat.icon, label: x.cat.short, value: x.cat.fmt(x.v), rank: x.rank }));
    }
    return { awards, highlights };
  }

  hostAction(body) {
    switch (body.type) {
      case 'start':
        if (this.phase !== 'lobby') throw new GameError('Already started');
        if (!this.teams.length) throw new GameError('Wait for at least one team');
        this.beginRound(1);
        break;
      case 'pause':
        if (!this.paused && this.phaseEnds) { this.paused = true; this.pausedRemaining = Math.max(0, this.phaseEnds - Date.now()); }
        break;
      case 'resume':
        if (this.paused) { this.paused = false; this.phaseEnds = Date.now() + this.pausedRemaining; }
        break;
      case 'addTime':
        if (this.phase !== 'plan') throw new GameError('Extra time only works during Planning');
        if (this.paused) this.pausedRemaining += 30000; else this.phaseEnds += 30000;
        this.phaseDuration += 30000;
        break;
      case 'skip':
        if (this.phase === 'run') {
          while (this.run.night < NIGHTS) this.runNight();
          this.endSemester();
          this.setPhase('report', REPORT_MS);
        } else {
          this.advance();
        }
        break;
      case 'event': this.triggerEvent(body.event); break;
      case 'roleLocks': this.roleLocks = !this.roleLocks; break;
      case 'removePlayer': {
        const p = [...this.players.values()].find(x => x.uid === body.uid);
        if (p) { this.leaveTeam(p); this.players.delete(p.id); }
        break;
      }
      case 'endGame':
        if (this.phase === 'lobby' || this.phase === 'final') throw new GameError('Nothing to end');
        this.finish();
        break;
      default: throw new GameError('Unknown host action');
    }
    this.changed();
  }

  addNews(text, teamId = null) {
    this.news.unshift({ id: ++this.newsSeq, text, teamId, round: this.round });
    if (this.news.length > NEWS_LIMIT) this.news.length = NEWS_LIMIT;
  }

  // ---------- public state ----------

  baseState() {
    const now = Date.now();
    const assigned = new Set(this.teams.flatMap(t => t.members));
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      paused: this.paused,
      remainingMs: this.paused ? this.pausedRemaining : this.phaseEnds ? Math.max(0, this.phaseEnds - now) : null,
      phaseDuration: this.phaseDuration,
      roleLocks: this.roleLocks,
      maxActive: MAX_ACTIVE,
      static: { sites: D.SITES, instruments: D.INSTRUMENTS, apertures: D.APERTURES, apertureCost: D.APERTURE_COST, startMoney: D.START_MONEY },
      grants: this.grants.map(g => ({ ...g, applicants: this.teams.filter(t => t.applications.includes(g.id)).map(t => t.id) })),
      teams: this.teams.map(t => this.teamState(t)),
      lobby: [...this.players.values()].filter(p => !assigned.has(p.id)).map(p => ({ uid: p.uid, name: p.name, online: this.isConnected(p.id) })),
      run: this.run && { night: this.run.night, nights: this.run.nights, weather: this.run.weather, event: this.run.event },
      news: this.news,
      final: this.final,
    };
  }

  teamState(t) {
    const grantInfo = {};
    for (const g of this.grants) grantInfo[g.id] = this.qualify(t, g);
    return {
      id: t.id, name: t.name, color: t.color,
      members: t.members.map(pid => {
        const p = this.players.get(pid);
        return { uid: p.uid, name: p.name, roles: this.rolesOf(t, pid), online: this.isConnected(pid) };
      }),
      money: t.money, science: t.science, site: t.site, aperture: t.aperture, instruments: t.instruments,
      opCost: D.opCost(t), applications: t.applications, awarded: t.awarded, missed: t.missed, autoAssigned: t.autoAssigned, ready: t.ready, semesterEarned: t.semesterEarned,
      active: t.active.map(a => ({ grant: a.grant, needed: a.needed, progress: a.progress, done: a.done, partnerId: a.partnerId })),
      report: t.report, tonight: t.tonight, history: t.history, stats: t.stats, grantInfo,
    };
  }
}

function moveItem(arr, i, dir) {
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

module.exports = { Room, GameError };

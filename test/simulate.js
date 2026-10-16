'use strict';
// Plays a full game with bot teams (no server, no timers) to catch crashes and eyeball balance.
// Usage: node test/simulate.js [teams=6] [games=1]
const { Room } = require('../game/engine');
const D = require('../game/data');

const nTeams = Number(process.argv[2] || 6);
const games = Number(process.argv[3] || 1);
const fakeRes = { write() {}, end() {} };

const STRATEGIES = [
  { site: 'maunakea', ap: 2, buys: ['imager', 'irimager', 'ao', 'spectro', 'irspec', 'coronagraph'], upAt: { 4: 60, 8: 120 } },
  { site: 'pachon', ap: 2, buys: ['imager', 'spectro', 'irimager', 'ao', 'irspec', 'coronagraph'], upAt: { 4: 50, 8: 110 } },
  { site: 'backyard', ap: 4, buys: ['imager', 'spectro', 'photometer'], upAt: { 8: 70 } },
  { site: 'desert', ap: 2, buys: ['imager', 'photometer', 'spectro', 'irimager'], upAt: { 4: 45 } },
  { site: 'sutherland', ap: 2, buys: ['imager', 'spectro', 'photometer'], upAt: { 4: 45, 8: 90 } },
  { site: 'lapalma', ap: 1, buys: ['imager', 'photometer', 'spectro', 'ao'], upAt: { 2: 30, 4: 60 } },
];

function botPlan(room, team, strat) {
  const pid = team.members[0];
  const tryAct = body => { try { room.playerAction(pid, body); return true; } catch { return false; } };
  if (!team.site) tryAct({ type: 'found', site: strat.site, aperture: strat.ap });
  for (const [ap, threshold] of Object.entries(strat.upAt)) {
    if (team.aperture < +ap && team.money > threshold) tryAct({ type: 'upgrade', aperture: +ap });
  }
  for (const inst of strat.buys) {
    if (!team.instruments.includes(inst) && team.money > D.INSTRUMENTS[inst].cost + 4) { tryAct({ type: 'buy', instrument: inst }); break; }
  }
  // apply to qualifying grants, best science-weighted odds first
  const ranked = room.grants.map(g => ({ g, q: room.qualify(team, g) })).filter(x => x.q.ok)
    .sort((a, b) => b.g.sci * b.q.odds.chance - a.g.sci * a.q.odds.chance);
  for (const { g } of ranked.slice(0, 5)) tryAct({ type: 'apply', grantId: g.id });
}

function playGame(verbose) {
  const room = new Room('TEST', { rounds: 8 });
  room.subscribe(fakeRes, null);
  const strats = new Map();
  for (let i = 0; i < nTeams; i++) {
    const pid = room.join('Kid' + i);
    room.playerAction(pid, { type: 'createTeam' });
    strats.set(room.teams[i].id, STRATEGIES[i % STRATEGIES.length]);
  }
  room.hostAction({ type: 'start' });
  let safety = 0;
  while (room.phase !== 'final' && safety++ < 1000) {
    if (room.phase === 'plan') room.teams.forEach(t => botPlan(room, t, strats.get(t.id)));
    room.advance();
  }
  if (room.phase !== 'final') throw new Error('Game did not finish');
  room.baseState(); // make sure serialisation works
  JSON.stringify(room.baseState());
  if (verbose) {
    for (const t of [...room.teams].sort((a, b) => b.science - a.science)) {
      const s = t.stats;
      console.log(`${t.name.padEnd(16)} ${t.site.padEnd(10)} ${t.aperture}m sci=${String(t.science).padStart(4)} $${String(t.money).padStart(6)} `
        + `done=${s.completed} fail=${s.failed} disc=${s.discoveries} collab=${s.collabs} used/lost/idle=${s.nightsUsed}/${s.nightsLost}/${s.nightsIdle} inst=${t.instruments.join(',')}`);
      console.log('   history sci:', t.history.map(h => h.science).join(' '));
    }
    console.log('\nAwards:');
    for (const a of room.final.awards) console.log(`  ${a.icon} ${a.title.padEnd(32)} ${room.teamById(a.teamId).name.padEnd(16)} ${a.value}`);
    const counts = new Map(room.teams.map(t => [t.id, 0]));
    room.final.awards.forEach(a => counts.set(a.teamId, counts.get(a.teamId) + 1));
    console.log('Teams with zero awards:', [...counts.values()].filter(v => !v).length);
    console.log('\nNews sample:', room.news.slice(0, 8).map(n => n.text));
  }
  return room;
}

for (let g = 0; g < games; g++) playGame(g === 0);
console.log(`\n${games} game(s) completed OK`);
process.exit(0);

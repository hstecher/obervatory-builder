'use strict';
// Static game content: sites, telescopes, instruments, targets and grant templates.
// Money is in millions of dollars ($M).

const START_MONEY = 45;

// seeing: median seeing in arcsec · humidity: median % · clear: fraction of clear nights
// lightPollution: 0 (pristine) .. 1 (city) · costMult: building cost multiplier (remote/high = pricier)
const SITES = {
  backyard: {
    id: 'backyard', name: 'Hometown Hills', region: 'Near a big city', icon: '🏘️',
    lat: 35, lon: -97, altitude: 500, seeing: 1.8, humidity: 60, clear: 0.55, lightPollution: 0.6, costMult: 0.6,
    blurb: 'Cheap and easy to reach, but city lights wash out faint objects and the thick, wobbly air blurs images.',
  },
  desert: {
    id: 'desert', name: 'Desert Mesa', region: 'Arizona, USA', icon: '🌵',
    lat: 32, lon: -111, altitude: 2100, seeing: 1.1, humidity: 30, clear: 0.7, lightPollution: 0.15, costMult: 0.9,
    blurb: 'Dry, dark and affordable. A solid all-rounder for the northern sky.',
  },
  lapalma: {
    id: 'lapalma', name: 'La Palma', region: 'Canary Islands, Spain', icon: '🌋',
    lat: 29, lon: -18, altitude: 2400, seeing: 0.8, humidity: 40, clear: 0.72, lightPollution: 0.05, costMult: 1.1,
    blurb: 'A volcano peak above the clouds with steady air. A bit humid for infrared work.',
  },
  maunakea: {
    id: 'maunakea', name: 'Maunakea', region: 'Hawaiʻi, USA', icon: '🏔️',
    lat: 20, lon: -155, altitude: 4200, seeing: 0.6, humidity: 15, clear: 0.75, lightPollution: 0.05, costMult: 1.5,
    blurb: 'Very high, very dry, very steady air: superb for infrared and adaptive optics. Building up here is expensive.',
  },
  pachon: {
    id: 'pachon', name: 'Cerro Pachón', region: 'Chile', icon: '⛰️',
    lat: -30, lon: -71, altitude: 2700, seeing: 0.7, humidity: 20, clear: 0.85, lightPollution: 0.03, costMult: 1.3,
    blurb: 'The clearest skies on Earth, with a perfect view of the southern sky and the center of our galaxy.',
  },
  sutherland: {
    id: 'sutherland', name: 'Sutherland', region: 'South Africa', icon: '🏜️',
    lat: -32, lon: 21, altitude: 1800, seeing: 1.2, humidity: 35, clear: 0.7, lightPollution: 0.05, costMult: 0.8,
    blurb: 'An affordable, dark southern site. Great sky coverage, average image sharpness.',
  },
};

const APERTURES = [1, 2, 4, 8];
const APERTURE_COST = { 1: 8, 2: 18, 4: 32, 8: 55 };

// band 'ir' instruments need dry air (grant humidity limits)
const INSTRUMENTS = {
  imager: {
    id: 'imager', name: 'Optical Camera', icon: '📷', cost: 4, band: 'optical',
    blurb: 'Takes pictures in visible light. The workhorse of every observatory.',
  },
  photometer: {
    id: 'photometer', name: 'Fast Photometer', icon: '⏱️', cost: 5, band: 'optical',
    blurb: 'Measures tiny brightness dips when a planet passes in front of its star.',
  },
  spectro: {
    id: 'spectro', name: 'Optical Spectrograph', icon: '🌈', cost: 9, band: 'optical',
    blurb: 'Splits light into a rainbow to reveal what things are made of and how fast they move.',
  },
  irimager: {
    id: 'irimager', name: 'Infrared Camera', icon: '🔥', cost: 10, band: 'ir',
    blurb: 'Sees the heat glow of objects hidden behind dust. Water vapor blocks infrared, so it needs dry air.',
  },
  irspec: {
    id: 'irspec', name: 'Infrared Spectrograph', icon: '🧪', cost: 14, band: 'ir',
    blurb: 'Reads the chemistry of cool, dusty objects and the atmospheres of exoplanets.',
  },
  ao: {
    id: 'ao', name: 'Adaptive Optics', icon: '✨', cost: 16, band: 'any',
    blurb: 'A laser guide star and a bendy mirror cancel the atmosphere’s twinkling. Works best where the air is already steady.',
  },
  coronagraph: {
    id: 'coronagraph', name: 'Coronagraph', icon: '🌑', cost: 12, band: 'any', requires: ['ao'],
    blurb: 'Blocks a star’s glare so you can see faint planets right next to it. Needs adaptive optics.',
  },
};

// ra as display string, dec in degrees
const TARGETS = [
  { name: 'Orion Nebula (M42)', ra: '05h35m', dec: -5, types: ['nebula'] },
  { name: 'Andromeda Galaxy (M31)', ra: '00h43m', dec: 41, types: ['galaxy'] },
  { name: 'Crab Nebula (M1)', ra: '05h35m', dec: 22, types: ['nebula'] },
  { name: 'Whirlpool Galaxy (M51)', ra: '13h30m', dec: 47, types: ['galaxy'] },
  { name: 'Ring Nebula (M57)', ra: '18h54m', dec: 33, types: ['nebula'] },
  { name: 'Large Magellanic Cloud', ra: '05h24m', dec: -70, types: ['galaxy'] },
  { name: 'Small Magellanic Cloud', ra: '00h53m', dec: -73, types: ['galaxy'] },
  { name: 'Tarantula Nebula', ra: '05h39m', dec: -69, types: ['nebula'] },
  { name: 'Eta Carinae', ra: '10h45m', dec: -60, types: ['star', 'nebula'] },
  { name: 'Omega Centauri', ra: '13h27m', dec: -47, types: ['cluster'] },
  { name: 'Pleiades (M45)', ra: '03h47m', dec: 24, types: ['cluster'] },
  { name: 'Hercules Cluster (M13)', ra: '16h42m', dec: 36, types: ['cluster'] },
  { name: 'Jewel Box Cluster', ra: '12h54m', dec: -60, types: ['cluster'] },
  { name: 'Betelgeuse', ra: '05h55m', dec: 7, types: ['star'] },
  { name: 'Vega', ra: '18h37m', dec: 39, types: ['star'] },
  { name: 'Polaris', ra: '02h32m', dec: 89, types: ['star'] },
  { name: 'Proxima Centauri', ra: '14h30m', dec: -63, types: ['star', 'exo'] },
  { name: 'TRAPPIST-1', ra: '23h06m', dec: -5, types: ['exo'] },
  { name: 'HR 8799', ra: '23h07m', dec: 21, types: ['exo'] },
  { name: 'Beta Pictoris', ra: '05h47m', dec: -51, types: ['exo'] },
  { name: '51 Pegasi', ra: '22h57m', dec: 21, types: ['exo', 'star'] },
  { name: 'Galactic Center (Sgr A*)', ra: '17h46m', dec: -29, types: ['galcenter'] },
  { name: 'Pillars of Creation (M16)', ra: '18h19m', dec: -14, types: ['nebula'] },
  { name: 'Sombrero Galaxy (M104)', ra: '12h40m', dec: -12, types: ['galaxy'] },
  { name: 'Centaurus A', ra: '13h25m', dec: -43, types: ['galaxy', 'quasar'] },
  { name: 'Quasar 3C 273', ra: '12h29m', dec: 2, types: ['quasar'] },
  { name: 'Hubble Deep Field', ra: '12h37m', dec: 62, types: ['galaxy'] },
];

// iq: max seeing (arcsec) · cc: max cloud % · wv: max humidity % (infrared) · nights: clear nights needed
// tier: earliest difficulty level (1 = round 1, 2 = round 2+, 3 = round 4+)
const GRANT_TEMPLATES = [
  { kind: 'deep', tier: 1, title: 'Deep Portrait', icon: '📷', instruments: ['imager'], minAp: 1, iq: 1.6, cc: 50, nights: 2, pay: 7, sci: 8,
    types: ['galaxy', 'nebula', 'cluster'], blurb: 'Take a long, deep picture to reveal faint detail.' },
  { kind: 'chem', tier: 1, title: 'Star Chemistry', icon: '🌈', instruments: ['spectro'], minAp: 1, iq: 2.0, cc: 60, nights: 2, pay: 9, sci: 11,
    types: ['star', 'cluster'], blurb: 'Spread starlight into a spectrum to find out which elements the star contains.' },
  { kind: 'transit', tier: 1, title: 'Planet Transit Watch', icon: '⏱️', instruments: ['photometer'], minAp: 1, iq: 2.5, cc: 25, nights: 2, pay: 8, sci: 10,
    types: ['exo'], blurb: 'Catch the tiny dip in starlight when a planet passes in front of its star.' },
  { kind: 'nursery', tier: 1, title: 'Dusty Star Nursery', icon: '🔥', instruments: ['irimager'], minAp: 2, iq: 1.2, cc: 60, wv: 35, nights: 2, pay: 12, sci: 15,
    types: ['nebula', 'galcenter'], blurb: 'Infrared light pierces dust clouds to show baby stars forming inside.' },
  { kind: 'redshift', tier: 2, title: 'Galaxy Speed Trap', icon: '🌌', instruments: ['spectro'], minAp: 4, iq: 1.4, cc: 40, faint: true, nights: 3, pay: 16, sci: 22,
    types: ['galaxy', 'quasar'], blurb: 'Measure redshift to learn how fast distant galaxies race away. It’s evidence the universe is expanding!' },
  { kind: 'survey', tier: 2, title: 'Faint Galaxy Hunt', icon: '🔭', instruments: ['imager'], minAp: 4, iq: 1.0, cc: 30, faint: true, nights: 3, pay: 15, sci: 20,
    types: ['galaxy'], blurb: 'Big mirrors collect enough light to spot galaxies billions of light-years away.' },
  { kind: 'sharp', tier: 2, title: 'Razor-Sharp Portrait', icon: '✨', instruments: ['imager'], minAp: 2, iq: 0.4, cc: 40, nights: 2, pay: 15, sci: 20,
    types: ['nebula', 'cluster', 'galaxy'], blurb: 'Needs images sharper than the atmosphere normally allows. A job for adaptive optics.' },
  { kind: 'irchem', tier: 2, title: 'Cool Star Chemistry', icon: '🧪', instruments: ['irspec'], minAp: 2, iq: 1.2, cc: 50, wv: 30, nights: 2, pay: 14, sci: 18,
    types: ['star', 'nebula'], blurb: 'Infrared spectra reveal molecules in cool stars and dusty clouds.' },
  { kind: 'gc', tier: 3, title: 'Stars Orbiting a Black Hole', icon: '🕳️', instruments: ['irimager', 'ao'], minAp: 4, iq: 0.3, cc: 40, wv: 30, nights: 3, pay: 24, sci: 38,
    types: ['galcenter'], blurb: 'Track stars whipping around the giant black hole at the center of the Milky Way.' },
  { kind: 'atmo', tier: 3, title: 'Alien Atmosphere', icon: '🪐', instruments: ['irspec'], minAp: 4, iq: 1.0, cc: 25, wv: 25, nights: 3, pay: 22, sci: 32,
    types: ['exo'], blurb: 'Look for water and other molecules in the air of a planet around another star.' },
  { kind: 'direct', tier: 3, title: 'Photograph an Exoplanet', icon: '🌑', instruments: ['coronagraph', 'irimager'], minAp: 8, iq: 0.3, cc: 30, wv: 35, nights: 3, pay: 32, sci: 55,
    types: ['exo'], blurb: 'Block the star’s glare and capture a real picture of a planet orbiting it.' },
  { kind: 'quasar', tier: 3, title: 'Monster Black Hole Weigh-In', icon: '⚫', instruments: ['spectro'], minAp: 8, iq: 1.2, cc: 40, faint: true, nights: 3, pay: 26, sci: 40,
    types: ['quasar', 'galaxy'], blurb: 'Measure how fast gas swirls around a distant black hole to weigh it.' },
];

// Unlimited: every qualifying team that applies gets one
const COMMUNITY_GRANTS = [
  { kind: 'starparty', title: 'Public Star Party', icon: '🎉', instruments: [], minAp: 1, iq: 3, cc: 70, nights: 1, pay: 3, sci: 3,
    target: { name: 'The Moon and planets', ra: '—', dec: null }, sponsor: 'Local Astronomy Club',
    blurb: 'Share the sky with your community. Every telescope qualifies!' },
  { kind: 'training', title: 'Student Training Night', icon: '🎓', instruments: ['imager'], minAp: 1, iq: 2.5, cc: 60, nights: 1, pay: 4, sci: 5,
    target: { name: 'Bright star clusters', ra: '—', dec: null }, sponsor: 'University Outreach',
    blurb: 'Teach the next generation of astronomers how to observe.' },
];

// Need two teams; pair rule decides which teams fit together
const COLLAB_GRANTS = [
  { kind: 'twin', title: 'Twin-Hemisphere Sky Map', icon: '🌍', pair: 'northSouth', instrumentsAny: ['imager', 'irimager'], minAp: 1, iq: 1.6, cc: 50, nights: 2, pay: 12, sci: 18,
    target: { name: 'The whole sky', ra: 'all', dec: null }, sponsor: 'International Sky Survey',
    pairText: 'Needs one northern AND one southern observatory', blurb: 'No single telescope can see the whole sky. Team up across the equator to map all of it.' },
  { kind: 'rainbow', title: 'Rainbow Team-Up', icon: '🤝', pair: 'opticalIR', instrumentsAny: ['imager', 'spectro', 'irimager', 'irspec'], minAp: 2, iq: 1.4, cc: 50, nights: 2, pay: 13, sci: 20,
    target: { name: 'A newborn star system', ra: '04h31m', dec: 18 }, sponsor: 'Multi-Wavelength Alliance',
    pairText: 'Needs one OPTICAL team AND one INFRARED team', blurb: 'Optical and infrared light tell different parts of the story. Combine them!' },
];

const SPONSORS = ['National Science Fund', 'Space Exploration Agency', 'Planet Hunters Foundation', 'Galaxy Research Council', 'Stellar Science Trust', 'Origins Institute'];

const TEAM_NAMES = ['Pulsar', 'Quasar', 'Nebula', 'Nova', 'Comet', 'Meteor', 'Aurora', 'Eclipse', 'Zenith', 'Photon', 'Orbit', 'Cosmos',
  'Vega', 'Sirius', 'Rigel', 'Orion', 'Lyra', 'Draco', 'Gemini', 'Phoenix', 'Andromeda', 'Polaris', 'Halley', 'Kepler'];
const TEAM_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595', '#94d82d', '#845ef7', '#20c997', '#e8590c'];

const DISCOVERIES = [
  'found a brand-new brown dwarf', 'spotted a galaxy bent by gravitational lensing', 'caught a star flaring wildly',
  'found a hidden baby star', 'detected a mysterious fast-moving cloud', 'found a never-before-seen star cluster',
  'spotted a rare double quasar', 'caught an asteroid photobombing the image',
];

// Operating cost per semester: bigger observatories cost more to run (keeps leaders from snowballing)
function opCost(team) {
  if (!team.site) return 0;
  return Math.round((1 + team.aperture * 0.5 + team.instruments.length * 0.4) * 10) / 10;
}

module.exports = {
  START_MONEY, SITES, APERTURES, APERTURE_COST, INSTRUMENTS, TARGETS, GRANT_TEMPLATES, COMMUNITY_GRANTS, COLLAB_GRANTS,
  SPONSORS, TEAM_NAMES, TEAM_COLORS, DISCOVERIES, opCost,
};

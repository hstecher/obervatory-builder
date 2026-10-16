'use strict';
// Zero-dependency server: static files + JSON API + Server-Sent Events for live game state.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Room } = require('./game/engine');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const rooms = new Map();

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10000) { reject(new Error('Request too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Bad JSON')); }
    });
    req.on('error', reject);
  });
}

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid 1/0 confusion
  let code;
  do code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  while (rooms.has(code));
  return code;
}

const getRoom = code => rooms.get(String(code || '').toUpperCase().trim());

function serveStatic(res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/stream') {
    const room = getRoom(url.searchParams.get('code'));
    if (!room) return sendJSON(res, 404, { error: 'Game not found' });
    const pid = url.searchParams.get('pid');
    const isHost = url.searchParams.get('hostKey') === room.hostKey;
    if (!isHost && !room.players.has(pid)) return sendJSON(res, 404, { error: 'Player not found' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    room.subscribe(res, isHost ? null : pid);
    req.on('close', () => room.unsubscribe(res));
    return;
  }

  let body;
  try { body = req.method === 'POST' ? await readBody(req) : {}; } catch (e) { return sendJSON(res, 400, { error: e.message }); }

  try {
    if (route === 'POST /api/rooms') {
      const code = newCode();
      const room = new Room(code, body.settings || {});
      rooms.set(code, room);
      return sendJSON(res, 200, { code, hostKey: room.hostKey });
    }
    const room = getRoom(body.code);
    if (!room) return sendJSON(res, 404, { error: 'No game with that code. Check the projector!' });
    switch (route) {
      case 'POST /api/join':
        return sendJSON(res, 200, { code: room.code, pid: room.join(body.name) });
      case 'POST /api/action':
        room.playerAction(body.pid, body);
        return sendJSON(res, 200, { ok: true });
      case 'POST /api/host':
        if (body.hostKey !== room.hostKey) return sendJSON(res, 403, { error: 'Not the host' });
        room.hostAction(body);
        return sendJSON(res, 200, { ok: true });
      default:
        return sendJSON(res, 404, { error: 'Unknown endpoint' });
    }
  } catch (e) {
    if (e.userFacing) return sendJSON(res, 400, { error: e.message });
    console.error(e);
    return sendJSON(res, 500, { error: 'Something went wrong on the server' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return sendJSON(res, 200, { ok: true, rooms: rooms.size });
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  serveStatic(res, url.pathname);
});

// One shared clock drives every room's phase timers
setInterval(() => {
  for (const room of rooms.values()) {
    try { room.tick(); } catch (e) { console.error('tick error', room.code, e); }
  }
}, 250);

// Keep SSE connections alive through proxies, and drop abandoned rooms
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const s of room.subscribers) s.res.write(': ping\n\n');
    if (now - room.lastActivity > ROOM_TTL_MS) {
      for (const s of room.subscribers) s.res.end();
      rooms.delete(code);
    }
  }
}, 20000);

server.listen(PORT, () => console.log(`Observatory Tycoon running at http://localhost:${PORT}`));

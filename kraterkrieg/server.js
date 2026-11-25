// Kraterkrieg – statischer Webserver + WebSocket-Relay für Lobbys.
// Die Spielsimulation läuft im Browser des Hosts; der Server leitet nur Nachrichten weiter.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024 });
const rooms = new Map(); // code -> { host, peers: Map<id, ws> }
let nextId = 1;

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

wss.on('connection', ws => {
  ws.id = 'p' + (nextId++);
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = ws.room && rooms.get(ws.room);
    switch (m.t) {
      case 'create': {
        if (ws.room) return;
        const c = code();
        rooms.set(c, { host: ws, peers: new Map() });
        ws.room = c; ws.isHost = true;
        send(ws, { t: 'created', code: c, id: ws.id });
        break;
      }
      case 'join': {
        if (ws.room) return;
        const c = String(m.code || '').trim().toUpperCase();
        const r = rooms.get(c);
        if (!r) return send(ws, { t: 'error', msg: 'Lobby nicht gefunden.' });
        if (r.peers.size >= 11) return send(ws, { t: 'error', msg: 'Lobby ist voll.' });
        r.peers.set(ws.id, ws);
        ws.room = c;
        send(ws, { t: 'joined', code: c, id: ws.id, host: r.host.id });
        send(r.host, { t: 'peer-join', id: ws.id, name: String(m.name || 'Gast').slice(0, 20) });
        break;
      }
      case 'to': { // Host -> Gast/alle
        if (!room || room.host !== ws) return;
        const msg = JSON.stringify({ t: 'msg', from: ws.id, data: m.data });
        if (m.to === 'all') { for (const p of room.peers.values()) if (p.readyState === 1) p.send(msg); }
        else { const p = room.peers.get(m.to); if (p && p.readyState === 1) p.send(msg); }
        break;
      }
      case 'host': { // Gast -> Host
        if (!room || room.host === ws) return;
        send(room.host, { t: 'msg', from: ws.id, data: m.data });
        break;
      }
      case 'kick': {
        if (!room || room.host !== ws) return;
        const p = room.peers.get(m.id);
        if (p) { send(p, { t: 'kicked' }); room.peers.delete(m.id); p.room = null; send(ws, { t: 'peer-leave', id: m.id }); }
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (room.host === ws) {
      for (const p of room.peers.values()) { send(p, { t: 'host-left' }); p.room = null; }
      rooms.delete(ws.room);
    } else {
      room.peers.delete(ws.id);
      send(room.host, { t: 'peer-leave', id: ws.id });
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => {
  console.log(`Kraterkrieg läuft auf http://localhost:${PORT}`);
});

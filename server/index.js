import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

const PORT = process.env.PORT || 8080;
const POINTS_TO_WIN = 7;
const ROUNDS_TO_WIN = 2;
const RESET_DELAY = 1200;
const BETWEEN_ROUNDS_DELAY = 2500;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ARC server running');
    return;
  }

  // Serve static files from dist/
  let filePath = path.join(DIST_DIR, req.url === '/' ? 'index.html' : req.url);
  // Prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback — serve index.html for any unknown route
      filePath = path.join(DIST_DIR, 'index.html');
    }

    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

const wss = new WebSocketServer({ server });

// --- State ---
const queue = [];           // [ws, ws, ...]
const playerToRoom = new Map(); // ws -> room
let nextRoomId = 1;

function createRoom(ws1, ws2) {
  const room = {
    id: nextRoomId++,
    players: [ws1, ws2],
    scores: [0, 0],
    rounds: [0, 0],
    round: 1,
    phase: 'waiting',
    timers: [],
  };
  playerToRoom.set(ws1, room);
  playerToRoom.set(ws2, room);

  send(ws1, { type: 'matched', slot: 0 });
  send(ws2, { type: 'matched', slot: 1 });

  // Start countdown after a brief delay for clients to set up
  setTimeout(() => startCountdown(room), 500);

  return room;
}

function destroyRoom(room) {
  // Clear all pending timers
  for (const t of room.timers) clearTimeout(t);
  room.timers.length = 0;

  for (const ws of room.players) {
    if (ws) playerToRoom.delete(ws);
  }
  room.players = [null, null];
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room, msg) {
  for (const ws of room.players) {
    send(ws, msg);
  }
}

function getSlot(room, ws) {
  if (room.players[0] === ws) return 0;
  if (room.players[1] === ws) return 1;
  return -1;
}

function updateQueuePositions() {
  for (let i = 0; i < queue.length; i++) {
    send(queue[i], { type: 'queued', position: i + 1, total: queue.length });
  }
}

function tryMatch() {
  // Remove any dead connections from queue
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].readyState !== 1) {
      queue.splice(i, 1);
    }
  }

  while (queue.length >= 2) {
    const ws1 = queue.shift();
    const ws2 = queue.shift();
    if (ws1.readyState === 1 && ws2.readyState === 1) {
      createRoom(ws1, ws2);
    } else {
      // Put back any still-alive one
      if (ws1.readyState === 1) queue.unshift(ws1);
      if (ws2.readyState === 1) queue.unshift(ws2);
      break;
    }
  }

  updateQueuePositions();
}

// --- Match Phase Control ---

function startCountdown(room) {
  if (!room.players[0] || !room.players[1]) return;
  room.phase = 'countdown';
  let timer = 3;
  broadcast(room, { type: 'countdown', timer });

  const tick = () => {
    timer--;
    if (timer > 0) {
      broadcast(room, { type: 'countdown', timer });
      room.timers.push(setTimeout(tick, 1000));
    } else {
      room.phase = 'playing';
      broadcast(room, { type: 'go' });
    }
  };
  room.timers.push(setTimeout(tick, 1000));
}

function handleHitReport(room, reporterSlot) {
  if (room.phase !== 'playing') return;

  // Reporter says "I got hit" — award point to the OTHER player
  const scorerSlot = reporterSlot === 0 ? 1 : 0;
  room.scores[scorerSlot]++;
  room.phase = 'scoring';

  broadcast(room, {
    type: 'score_update',
    p1: room.scores[0],
    p2: room.scores[1],
    rounds_p1: room.rounds[0],
    rounds_p2: room.rounds[1],
    round: room.round,
  });

  // Check round win
  if (room.scores[0] >= POINTS_TO_WIN || room.scores[1] >= POINTS_TO_WIN) {
    const roundWinner = room.scores[0] >= POINTS_TO_WIN ? 0 : 1;
    room.rounds[roundWinner]++;

    // Check match win
    if (room.rounds[0] >= ROUNDS_TO_WIN || room.rounds[1] >= ROUNDS_TO_WIN) {
      room.phase = 'match-over';
      broadcast(room, {
        type: 'match_end',
        winner: room.rounds[0] >= ROUNDS_TO_WIN ? 'p1' : 'p2',
        rounds_p1: room.rounds[0],
        rounds_p2: room.rounds[1],
      });
      room.timers.push(setTimeout(() => handleMatchEnd(room), 3000));
      return;
    }

    // Between rounds
    broadcast(room, {
      type: 'round_end',
      winner: roundWinner === 0 ? 'p1' : 'p2',
      rounds_p1: room.rounds[0],
      rounds_p2: room.rounds[1],
    });

    room.timers.push(setTimeout(() => {
      room.round++;
      room.scores = [0, 0];
      broadcast(room, { type: 'reset_positions' });
      room.timers.push(setTimeout(() => startCountdown(room), 500));
    }, BETWEEN_ROUNDS_DELAY));
    return;
  }

  // Normal score — brief reset then continue
  broadcast(room, { type: 'reset_positions' });
  room.timers.push(setTimeout(() => {
    room.phase = 'playing';
    broadcast(room, { type: 'resume' });
  }, RESET_DELAY));
}

function handleMatchEnd(room) {
  const winnerSlot = room.rounds[0] >= ROUNDS_TO_WIN ? 0 : 1;
  const loserSlot = winnerSlot === 0 ? 1 : 0;
  const winnerWs = room.players[winnerSlot];
  const loserWs = room.players[loserSlot];

  destroyRoom(room);

  // Loser goes to back of queue
  if (loserWs && loserWs.readyState === 1) {
    queue.push(loserWs);
  }

  // Winner gets next in queue or waits
  if (winnerWs && winnerWs.readyState === 1) {
    if (queue.length > 0 && queue[0] !== winnerWs) {
      const nextOpponent = queue.shift();
      createRoom(winnerWs, nextOpponent);
    } else {
      queue.push(winnerWs);
    }
  }

  updateQueuePositions();
}

// --- Connection Handling ---

wss.on('connection', (ws) => {
  queue.push(ws);
  tryMatch();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const room = playerToRoom.get(ws);
    if (!room) return;

    const slot = getSlot(room, ws);
    if (slot === -1) return;
    const otherSlot = slot === 0 ? 1 : 0;
    const otherWs = room.players[otherSlot];

    switch (msg.type) {
      case 'state':
        // Relay state to opponent (pass-through)
        send(otherWs, { type: 'opponent_state', data: msg.data });
        break;

      case 'event':
        if (msg.event && msg.event.name === 'i_got_hit') {
          // Score authority — server handles scoring
          handleHitReport(room, slot);
          // Also relay the event so opponent can play effects
          send(otherWs, { type: 'opponent_event', event: msg.event });
        } else {
          // Relay event to opponent
          send(otherWs, { type: 'opponent_event', event: msg.event });
        }
        break;

      case 'pong':
        // Latency measurement (future use)
        break;
    }
  });

  ws.on('close', () => {
    // Remove from queue
    const qIdx = queue.indexOf(ws);
    if (qIdx !== -1) queue.splice(qIdx, 1);

    // Handle room cleanup
    const room = playerToRoom.get(ws);
    if (room) {
      const slot = getSlot(room, ws);
      const otherSlot = slot === 0 ? 1 : 0;
      const otherWs = room.players[otherSlot];

      send(otherWs, { type: 'opponent_disconnected' });
      destroyRoom(room);

      // Put remaining player back in queue
      if (otherWs && otherWs.readyState === 1) {
        queue.push(otherWs);
        tryMatch();
      }
    }

    updateQueuePositions();
  });

  ws.on('error', () => {
    // Handled by close event
  });
});

server.listen(PORT, () => {
  console.log(`ARC server listening on port ${PORT}`);
});

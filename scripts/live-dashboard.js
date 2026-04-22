// scripts/live-dashboard.js
// Real-time composition dashboard -- WebSocket server that streams
// telemetry from trace.jsonl as it is written, plus a static HTML page.
//
// Usage:
//   node scripts/live-dashboard.js          # start server on :3377
//   node scripts/live-dashboard.js --port N # custom port
//
// Open http://localhost:3377 in a browser, then run `npm run main` in
// another terminal. The dashboard updates in real time as beats are emitted.

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');
const TRACE_FILE = path.join(METRICS_DIR, 'trace.jsonl');
const HTML_FILE  = path.join(__dirname, 'dashboard.html');
const DEFAULT_PORT = 3377;

// -Parse CLI args -

function parsePort() {
  const idx = process.argv.indexOf('--port');
  if (idx !== -1 && process.argv[idx + 1]) {
    const p = parseInt(process.argv[idx + 1], 10);
    if (p > 0 && p < 65536) return p;
  }
  return DEFAULT_PORT;
}

// -Minimal WebSocket handshake (RFC 6455) -
// No external dependencies -- just raw sockets.

const crypto = require('crypto');

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC525B63')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  return socket;
}

function wsFrame(data) {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const buf = Buffer.from(json, 'utf8');
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

function wsSend(socket, data) {
  try { socket.write(wsFrame(data)); } catch (_e) { /* client gone */ }
}

// -Tail trace.jsonl and broadcast to connected clients -

function startTailing(clients) {
  let offset = 0;
  let buffer = '';

  // If file already exists, skip to end
  if (fs.existsSync(TRACE_FILE)) {
    offset = fs.statSync(TRACE_FILE).size;
  }

  const watcher = fs.watch(path.dirname(TRACE_FILE), function(_event, filename) {
    if (filename !== path.basename(TRACE_FILE)) return;
    if (!fs.existsSync(TRACE_FILE)) return;

    const stat = fs.statSync(TRACE_FILE);
    if (stat.size <= offset) {
      // File was truncated (new run) -- reset
      offset = 0;
      buffer = '';
      broadcast(clients, { type: 'reset' });
    }

    if (stat.size > offset) {
      const fd = fs.openSync(TRACE_FILE, 'r');
      const chunk = Buffer.alloc(stat.size - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset);
      fs.closeSync(fd);
      offset = stat.size;

      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // partial line stays in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          broadcast(clients, { type: 'beat', data: record });
        } catch (_e) { /* malformed line */ }
      }
    }
  });

  return watcher;
}

function broadcast(clients, message) {
  const frame = wsFrame(message);
  for (const c of clients) {
    try { c.write(frame); } catch (_e) { clients.delete(c); }
  }
}

// -HTTP server -

function startServer(port) {
  const clients = new Set();

  const server = http.createServer(function(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(HTML_FILE, 'utf8'));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.on('upgrade', function(req, socket) {
    const ws = acceptWebSocket(req, socket);
    if (!ws) return;
    clients.add(ws);
    wsSend(ws, { type: 'hello', time: new Date().toISOString() });
    ws.on('close', function() { clients.delete(ws); });
    ws.on('error', function() { clients.delete(ws); });
  });

  const watcher = startTailing(clients);

  server.listen(port, function() {
    console.log('live-dashboard: http://localhost:' + port + '  (Ctrl+C to stop)');
    console.log('live-dashboard: watching ' + path.relative(ROOT, TRACE_FILE));
  });

  process.on('SIGINT', function() {
    watcher.close();
    server.close();
    process.exit(0);
  });
}

startServer(parsePort());

/**
 * server.js - Apple II Super Serial Card Web Server & Serial-to-TCP/IP Bridge
 * 
 * Features:
 * - Express HTTP Server on port 3000 (configurable)
 * - WebSocket Server for real-time dashboard updates & bi-directional communication
 * - Built-in Serial-to-TCP/IP Bridge connecting to AppleWin SSC (port 1977)
 * - REST API endpoints (/api/status, /api/time, /api/quote, /api/weather, /api/send)
 * - Protocol dispatcher for Apple II HTTP client and interactive commands
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const SerialBridge = require('./bridge');

// --- Parse CLI Arguments & Environment Variables ---
const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultVal;
}

const HTTP_PORT = parseInt(process.env.PORT || getArg('--http-port', '3000'), 10);
const TCP_PORT = parseInt(process.env.TCP_PORT || getArg('--tcp-port', '1977'), 10);
const TCP_HOST = process.env.TCP_HOST || getArg('--tcp-host', '127.0.0.1');
const MODE = process.env.MODE || getArg('--mode', 'tcp-client'); // 'tcp-client', 'tcp-server', 'serial'
const SERIAL_PORT = process.env.SERIAL_PORT || getArg('--serial', null);
const BAUD_RATE = parseInt(process.env.BAUD_RATE || getArg('--baud', '9600'), 10);

// --- Retro Quotes Collection ---
const RETRO_QUOTES = [
  "Never trust a computer you can't throw out a window. - Steve Wozniak",
  "Design is not just what it looks like and feels like. Design is how it works. - Steve Jobs",
  "The Apple II is a piece of art that made computers accessible to everyday humans.",
  "640K ought to be enough for anybody. - Unknown",
  "There are 10 types of people in the world: those who understand binary, and those who don't.",
  "Hello, world! Powered by 6502 microprocessor running at 1.023 MHz.",
  "Apple II Super Serial Card: 300 to 19200 baud of retro connectivity!",
  "Simplicity is the ultimate sophistication. - Leonardo da Vinci",
  "BYTE by BYTE, we built the personal computing revolution."
];

// --- App State & Log History ---
const startTime = Date.now();
const messageHistory = [];
function addHistory(direction, type, message) {
  const item = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    timeStr: new Date().toLocaleTimeString(),
    direction, // 'RX' (from Apple II), 'TX' (to Apple II), 'SYS', 'WEB'
    type,      // 'line', 'http', 'cmd', 'chat', 'status'
    message
  };
  messageHistory.push(item);
  if (messageHistory.length > 200) {
    messageHistory.shift();
  }
  broadcastWs({ event: 'log', item });
  return item;
}

// --- Initialize Express & HTTP Server ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Initialize Bridge ---
const bridge = new SerialBridge({
  mode: MODE,
  tcpHost: TCP_HOST,
  tcpPort: TCP_PORT,
  serialPort: SERIAL_PORT,
  baudRate: BAUD_RATE
});

// --- WebSocket Broadcast Helper ---
function broadcastWs(data) {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// --- Bridge Event Handlers ---
bridge.on('connected', (info) => {
  addHistory('SYS', 'status', `Connected to ${info.target} (Mode: ${info.mode})`);
  broadcastWs({ event: 'bridge_status', status: bridge.getStatus() });
  
  // Welcome banner for Apple II terminal
  setTimeout(() => {
    bridge.sendLine('');
    bridge.sendLine('=== APPLE //e NODE.JS WEB BRIDGE ===');
    bridge.sendLine('Connected to Server: ' + new Date().toLocaleString());
    bridge.sendLine('Type HELP for commands or enter HTTP query.');
    bridge.sendLine('====================================');
    bridge.sendLine('');
  }, 300);
});

bridge.on('disconnected', () => {
  addHistory('SYS', 'status', 'Apple II / AppleWin connection disconnected.');
  broadcastWs({ event: 'bridge_status', status: bridge.getStatus() });
});

bridge.on('data', (buffer, cleanStr) => {
  broadcastWs({
    event: 'raw_rx',
    hex: buffer.toString('hex'),
    ascii: cleanStr
  });
});

bridge.on('line', (line) => {
  console.log(`[Apple II -> Server]: "${line}"`);
  addHistory('RX', 'line', line);
});

bridge.on('tx', (str) => {
  // Truncate trailing newlines for clean log display
  const displayStr = str.replace(/[\r\n]+$/, '');
  if (displayStr.length > 0) {
    console.log(`[Server -> Apple II]: "${displayStr}"`);
    addHistory('TX', 'line', displayStr);
  }
});

// --- HTTP Request from Apple II ---
bridge.on('http-request', ({ method, path: reqPath, raw }) => {
  addHistory('RX', 'http', `[HTTP ${method}] ${reqPath}`);

  const [pathname, queryString] = reqPath.split('?');
  const cleanPath = pathname.toLowerCase();

  if (cleanPath === '/' || cleanPath === '/index.html') {
    const body = 
      "Apple II Web Server v1.0\r\n" +
      "System: AppleWin SSC Bridge\r\n" +
      "Status: 200 OK\r\n" +
      "Endpoints:\r\n" +
      "  /api/time\r\n" +
      "  /api/quote\r\n" +
      "  /api/weather\r\n" +
      "  /api/status";
    bridge.sendHttp(200, 'OK', 'text/plain', body);
    addHistory('TX', 'http', 'HTTP 200 OK - Index');
  } 
  else if (cleanPath === '/api/time') {
    const timeStr = new Date().toLocaleString();
    bridge.sendHttp(200, 'OK', 'text/plain', `SERVER TIME: ${timeStr}`);
    addHistory('TX', 'http', `HTTP 200 OK - Time: ${timeStr}`);
  }
  else if (cleanPath === '/api/quote') {
    const quote = RETRO_QUOTES[Math.floor(Math.random() * RETRO_QUOTES.length)];
    bridge.sendHttp(200, 'OK', 'text/plain', quote);
    addHistory('TX', 'http', `HTTP 200 OK - Quote sent`);
  }
  else if (cleanPath === '/api/weather') {
    const weather = "LOCATION: Cupertino, CA\r\nTEMP: 21C / 70F | SKY: Clear Sunny\r\nWIND: 5 MPH NW | RETRO: 100%";
    bridge.sendHttp(200, 'OK', 'text/plain', weather);
    addHistory('TX', 'http', 'HTTP 200 OK - Weather sent');
  }
  else if (cleanPath === '/api/status') {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const body = 
      `STATUS: ONLINE\r\n` +
      `UPTIME: ${uptimeSec}s\r\n` +
      `WEB CLIENTS: ${wss.clients.size}\r\n` +
      `RX BYTES: ${bridge.stats.bytesRx}\r\n` +
      `TX BYTES: ${bridge.stats.bytesTx}`;
    bridge.sendHttp(200, 'OK', 'text/plain', body);
    addHistory('TX', 'http', 'HTTP 200 OK - Status sent');
  }
  else {
    bridge.sendHttp(404, 'Not Found', 'text/plain', `ERROR 404: Path ${reqPath} not found.`);
    addHistory('TX', 'http', `HTTP 404 Not Found - ${reqPath}`);
  }
});

// --- Interactive Commands from Apple II ---
bridge.on('command', ({ cmd, arg, raw }) => {
  addHistory('RX', 'cmd', `Command: ${cmd}${arg ? ' ' + arg : ''}`);

  switch (cmd) {
    case 'HELP':
      bridge.sendLine('--- APPLE //e COMMANDS ---');
      bridge.sendLine('TIME       : SHOW SERVER TIME');
      bridge.sendLine('QUOTE      : RETRO COMPUTING QUOTE');
      bridge.sendLine('WEATHER    : WEATHER REPORT');
      bridge.sendLine('STATUS     : SERVER & BRIDGE STATS');
      bridge.sendLine('PING       : TEST LATENCY (PONG)');
      bridge.sendLine('CHAT <MSG> : BROADCAST TO WEB BROWSER');
      bridge.sendLine('GET <PATH> : SEND HTTP GET REQUEST');
      bridge.sendLine('--------------------------');
      break;

    case 'TIME':
    case 'DATE':
      bridge.sendLine(`TIME: ${new Date().toLocaleString()}`);
      break;

    case 'QUOTE': {
      const q = RETRO_QUOTES[Math.floor(Math.random() * RETRO_QUOTES.length)];
      bridge.sendLine(`QUOTE: ${q}`);
      break;
    }

    case 'WEATHER':
      bridge.sendLine('LOCATION: Cupertino, CA');
      bridge.sendLine('TEMP: 21C / 70F | SKY: Clear Sunny');
      break;

    case 'STATUS':
    case 'SYS': {
      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      bridge.sendLine(`STATUS: ONLINE | UPTIME: ${uptimeSec}s`);
      bridge.sendLine(`BRIDGE: ${bridge.mode} (${bridge.getStatus().target})`);
      bridge.sendLine(`RX: ${bridge.stats.bytesRx}b | TX: ${bridge.stats.bytesTx}b | WEB TABS: ${wss.clients.size}`);
      break;
    }

    case 'PING':
      bridge.sendLine('PONG! AppleWin SSC Bridge Active.');
      break;

    case 'CHAT':
    case 'MSG': {
      if (!arg) {
        bridge.sendLine('USAGE: CHAT <your message>');
      } else {
        addHistory('RX', 'chat', `[Apple II]: ${arg}`);
        broadcastWs({
          event: 'chat_message',
          sender: 'Apple II',
          text: arg,
          timestamp: new Date().toLocaleTimeString()
        });
        bridge.sendLine(`OK: Sent to ${wss.clients.size} web client(s).`);
      }
      break;
    }

    default:
      bridge.sendLine(`OK: "${raw}" (Type HELP for list)`);
      break;
  }
});

// --- REST API Endpoints for Web Clients ---

// Server & Bridge Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    serverTime: new Date().toISOString(),
    bridge: bridge.getStatus(),
    webClients: wss.clients.size,
    memory: process.memoryUsage()
  });
});

// Current Time
app.get('/api/time', (req, res) => {
  const timeStr = new Date().toLocaleString();
  if (req.accepts('json') && !req.query.format) {
    res.json({ time: timeStr, timestamp: Date.now() });
  } else {
    res.type('text/plain').send(timeStr);
  }
});

// Retro Quote
app.get('/api/quote', (req, res) => {
  const quote = RETRO_QUOTES[Math.floor(Math.random() * RETRO_QUOTES.length)];
  if (req.accepts('json') && !req.query.format) {
    res.json({ quote });
  } else {
    res.type('text/plain').send(quote);
  }
});

// Weather
app.get('/api/weather', (req, res) => {
  const data = {
    location: 'Cupertino, CA',
    tempC: 21,
    tempF: 70,
    condition: 'Clear Sunny',
    humidity: '45%',
    wind: '5 mph NW'
  };
  if (req.accepts('json') && !req.query.format) {
    res.json(data);
  } else {
    res.type('text/plain').send(`${data.location}: ${data.tempC}C/${data.tempF}F, ${data.condition}`);
  }
});

// Send Message to Apple II
app.post('/api/send', (req, res) => {
  const message = req.body.message || req.body.text;
  if (!message) {
    return res.status(400).json({ error: 'Missing message parameter' });
  }

  const success = bridge.sendLine(`[WEB]: ${message}`);
  if (success) {
    addHistory('WEB', 'chat', `[Web User]: ${message}`);
    broadcastWs({
      event: 'chat_message',
      sender: 'Web User',
      text: message,
      timestamp: new Date().toLocaleTimeString()
    });
    res.json({ success: true, message: 'Sent to Apple II' });
  } else {
    res.status(503).json({ error: 'Bridge is not currently connected to Apple II' });
  }
});

// Message Log History
app.get('/api/history', (req, res) => {
  res.json({ history: messageHistory });
});

// Data submission from Apple II / client
app.post('/api/apple2/data', (req, res) => {
  console.log('[API Data Received]:', req.body);
  addHistory('RX', 'http', `Data: ${JSON.stringify(req.body)}`);
  res.json({ status: 'success', received: req.body });
});

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
  // Send initial state & recent history
  ws.send(JSON.stringify({
    event: 'init',
    bridge: bridge.getStatus(),
    history: messageHistory.slice(-50),
    serverTime: new Date().toISOString()
  }));

  broadcastWs({ event: 'clients_count', count: wss.clients.size });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'send') {
        const text = msg.text || '';
        if (text) {
          bridge.sendLine(`[WEB]: ${text}`);
          addHistory('WEB', 'chat', `[Web User]: ${text}`);
          broadcastWs({
            event: 'chat_message',
            sender: 'Web User',
            text: text,
            timestamp: new Date().toLocaleTimeString()
          });
        }
      } else if (msg.action === 'raw_send') {
        bridge.sendLine(msg.text || '');
      } else if (msg.action === 'reconnect') {
        bridge.stop();
        bridge.start();
      }
    } catch (e) {
      console.warn('[WS] Invalid JSON message:', e.message);
    }
  });

  ws.on('close', () => {
    broadcastWs({ event: 'clients_count', count: wss.clients.size });
  });
});

// --- Start Everything ---
server.listen(HTTP_PORT, () => {
  console.log('===============================================================');
  console.log(` Apple II SSC Web Server & Serial-to-TCP/IP Bridge`);
  console.log('===============================================================');
  console.log(` HTTP Web Server  : http://localhost:${HTTP_PORT}`);
  console.log(` Bridge Mode      : ${MODE}`);
  if (MODE === 'serial') {
    console.log(` Serial Port      : ${SERIAL_PORT || '(none specified)'} @ ${BAUD_RATE} baud`);
  } else {
    console.log(` TCP Target       : ${TCP_HOST}:${TCP_PORT} (AppleWin SSC default: 1977)`);
  }
  console.log('---------------------------------------------------------------');
  console.log(` Open http://localhost:${HTTP_PORT} in your browser to view dashboard.`);
  console.log(' Starting bridge connection...');
  console.log('===============================================================');

  // Start the serial/TCP bridge
  bridge.start();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  bridge.stop();
  server.close(() => {
    console.log('[Server] Terminated.');
    process.exit(0);
  });
});

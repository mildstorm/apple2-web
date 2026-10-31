/**
 * bridge.js - Apple II Super Serial Card (SSC) Bridge Engine
 * 
 * Supports:
 * - TCP Client mode: Connects to AppleWin SSC TCP listening port (default: 127.0.0.1:1977)
 * - TCP Server mode: Listens on TCP port for incoming Apple II / emulator connections
 * - Serial COM mode: Connects directly to hardware/virtual COM ports (if serialport is installed)
 * - Auto-reconnect with graceful retry
 * - 7-bit ASCII & Apple II Carriage Return (\r) line handling
 * - Built-in HTTP request parsing & command dispatch
 */

const net = require('net');
const EventEmitter = require('events');

class SerialBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.mode = options.mode || 'tcp-client'; // 'tcp-client', 'tcp-server', 'serial'
    this.tcpHost = options.tcpHost || '127.0.0.1';
    this.tcpPort = options.tcpPort || 1977;
    this.serialPortName = options.serialPort || null;
    this.baudRate = options.baudRate || 9600;
    this.reconnectInterval = options.reconnectInterval || 2000;

    this.socket = null;
    this.server = null;
    this.serialPort = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.rxBuffer = '';

    // Stats
    this.stats = {
      bytesRx: 0,
      bytesTx: 0,
      packetsRx: 0,
      packetsTx: 0,
      connectedAt: null,
      lastRxAt: null,
      lastTxAt: null,
      reconnectAttempts: 0
    };
  }

  start() {
    if (this.mode === 'tcp-client') {
      this._startTcpClient();
    } else if (this.mode === 'tcp-server') {
      this._startTcpServer();
    } else if (this.mode === 'serial') {
      this._startSerial();
    } else {
      console.error(`[Bridge] Unknown mode: ${this.mode}`);
    }
  }

  // --- TCP Client Mode (AppleWin default) ---
  _startTcpClient() {
    this._clearReconnect();
    console.log(`[Bridge] Connecting to AppleWin SSC at ${this.tcpHost}:${this.tcpPort}...`);

    const socket = new net.Socket();
    this.socket = socket;

    socket.on('connect', () => {
      this.isConnected = true;
      this.stats.connectedAt = new Date();
      this.stats.reconnectAttempts = 0;
      console.log(`[Bridge] Connected to AppleWin SSC (${this.tcpHost}:${this.tcpPort})`);
      this.emit('connected', { target: `${this.tcpHost}:${this.tcpPort}`, mode: this.mode });
    });

    socket.on('data', (data) => {
      this._handleIncomingData(data);
    });

    socket.on('error', (err) => {
      // Avoid spamming error stack if AppleWin is simply not started yet
      if (err.code === 'ECONNREFUSED') {
        // Normal when AppleWin is not running yet
      } else {
        console.warn(`[Bridge] TCP Socket warning: ${err.message}`);
      }
    });

    socket.on('close', () => {
      if (this.isConnected) {
        console.log('[Bridge] Connection closed by AppleWin SSC.');
        this.emit('disconnected');
      }
      this.isConnected = false;
      this.socket = null;
      this._scheduleReconnect();
    });

    socket.connect(this.tcpPort, this.tcpHost);
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.stats.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.mode === 'tcp-client') {
        this._startTcpClient();
      }
    }, this.reconnectInterval);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- TCP Server Mode ---
  _startTcpServer() {
    this.server = net.createServer((sock) => {
      console.log(`[Bridge] Client connected from ${sock.remoteAddress}:${sock.remotePort}`);
      if (this.socket) {
        console.log('[Bridge] Replacing existing client connection.');
        this.socket.destroy();
      }
      this.socket = sock;
      this.isConnected = true;
      this.stats.connectedAt = new Date();
      this.emit('connected', { target: `${sock.remoteAddress}:${sock.remotePort}`, mode: this.mode });

      sock.on('data', (data) => {
        this._handleIncomingData(data);
      });

      sock.on('close', () => {
        console.log('[Bridge] Client disconnected.');
        this.isConnected = false;
        this.socket = null;
        this.emit('disconnected');
      });

      sock.on('error', (err) => {
        console.warn(`[Bridge] Client socket error: ${err.message}`);
      });
    });

    this.server.listen(this.tcpPort, () => {
      console.log(`[Bridge] TCP Server listening on port ${this.tcpPort}...`);
    });
  }

  // --- Serial Port Mode (Hardware / Virtual COM) ---
  _startSerial() {
    try {
      const { SerialPort } = require('serialport');
      console.log(`[Bridge] Opening Serial Port ${this.serialPortName} @ ${this.baudRate} baud...`);
      this.serialPort = new SerialPort({
        path: this.serialPortName,
        baudRate: this.baudRate
      });

      this.serialPort.on('open', () => {
        this.isConnected = true;
        this.stats.connectedAt = new Date();
        console.log(`[Bridge] Serial Port ${this.serialPortName} opened.`);
        this.emit('connected', { target: this.serialPortName, mode: this.mode });
      });

      this.serialPort.on('data', (data) => {
        this._handleIncomingData(data);
      });

      this.serialPort.on('error', (err) => {
        console.error(`[Bridge] Serial error: ${err.message}`);
        this.emit('error', err);
      });

      this.serialPort.on('close', () => {
        this.isConnected = false;
        console.log('[Bridge] Serial port closed.');
        this.emit('disconnected');
      });
    } catch (err) {
      console.error(`[Bridge] serialport module error: ${err.message}`);
      console.log('[Bridge] Falling back to TCP client mode.');
      this.mode = 'tcp-client';
      this._startTcpClient();
    }
  }

  // --- Data Ingestion & Normalization ---
  _handleIncomingData(buffer) {
    this.stats.bytesRx += buffer.length;
    this.stats.packetsRx++;
    this.stats.lastRxAt = new Date();

    // Mask to 7-bit ASCII (Apple II keyboard sets high bit 0x80)
    let cleanStr = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i] & 0x7F;
      cleanStr += String.fromCharCode(byte);
    }

    this.emit('data', buffer, cleanStr);

    // Accumulate in line buffer (Apple II lines end with \r or \r\n)
    this.rxBuffer += cleanStr;

    let crIndex;
    while ((crIndex = this.rxBuffer.search(/[\r\n]/)) !== -1) {
      const line = this.rxBuffer.slice(0, crIndex).trim();
      // Skip delimiter
      if (this.rxBuffer[crIndex] === '\r' && this.rxBuffer[crIndex + 1] === '\n') {
        this.rxBuffer = this.rxBuffer.slice(crIndex + 2);
      } else {
        this.rxBuffer = this.rxBuffer.slice(crIndex + 1);
      }

      if (line.length > 0) {
        this._processLine(line);
      }
    }
  }

  _processLine(line) {
    this.emit('line', line);

    // Detect HTTP Request
    const httpMatch = line.match(/^(GET|POST|HEAD|PUT|DELETE)\s+([^\s]+)(?:\s+HTTP\/[0-9.]+)?/i);
    if (httpMatch) {
      const method = httpMatch[1].toUpperCase();
      const path = httpMatch[2];
      this.emit('http-request', { method, path, raw: line });
      return;
    }

    // Detect Interactive Commands
    const parts = line.split(' ');
    const cmd = parts[0].toUpperCase();
    const arg = parts.slice(1).join(' ');
    this.emit('command', { cmd, arg, raw: line });
  }

  // --- Sending to Apple II ---
  send(data) {
    if (!this.isConnected) {
      return false;
    }

    let buf;
    if (Buffer.isBuffer(data)) {
      buf = data;
    } else {
      buf = Buffer.from(data, 'ascii');
    }

    this.stats.bytesTx += buf.length;
    this.stats.packetsTx++;
    this.stats.lastTxAt = new Date();

    if (this.socket && !this.socket.destroyed) {
      this.socket.write(buf);
      this.emit('tx', buf.toString('ascii'));
      return true;
    } else if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.write(buf);
      this.emit('tx', buf.toString('ascii'));
      return true;
    }
    return false;
  }

  sendLine(str = '') {
    // Apple II terminal prefers \r\n or \r
    return this.send(str + '\r\n');
  }

  sendHttp(statusCode, statusText, contentType, bodyText) {
    const payload = `${bodyText}\r\n`;
    const resp = 
      `HTTP/1.0 ${statusCode} ${statusText}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${Buffer.byteLength(payload, 'ascii')}\r\n` +
      `Server: Apple2-Web-NodeJS\r\n` +
      `\r\n` +
      payload;
    return this.send(resp);
  }

  getStatus() {
    return {
      mode: this.mode,
      target: this.mode === 'serial' ? this.serialPortName : `${this.tcpHost}:${this.tcpPort}`,
      connected: this.isConnected,
      stats: { ...this.stats }
    };
  }

  stop() {
    this._clearReconnect();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.serialPort) {
      this.serialPort.close();
      this.serialPort = null;
    }
    this.isConnected = false;
  }
}

module.exports = SerialBridge;

/**
 * bridge.ts - Apple II Super Serial Card (SSC) Bridge Engine
 *
 * Supports:
 * - TCP Client mode: Connects to AppleWin SSC TCP listening port (default: 127.0.0.1:1977)
 * - TCP Server mode: Listens on TCP port for incoming Apple II / emulator connections
 * - Serial COM mode: Connects directly to hardware/virtual COM ports (if serialport is installed)
 * - Auto-reconnect with graceful retry
 * - 7-bit ASCII & Apple II Carriage Return (\r) line handling
 * - Built-in HTTP request parsing & command dispatch
 */

import * as net from 'net';
import * as os from 'os';
import { EventEmitter } from 'events';

export type BridgeMode = 'tcp-client' | 'tcp-server' | 'serial';

export interface SerialBridgeOptions {
  mode?: BridgeMode;
  tcpHost?: string;
  tcpPort?: number;
  localAddress?: string | null;
  listenHost?: string | null;
  serialPort?: string | null;
  baudRate?: number;
  reconnectInterval?: number;
}

export interface BridgeStats {
  bytesRx: number;
  bytesTx: number;
  packetsRx: number;
  packetsTx: number;
  connectedAt: Date | null;
  lastRxAt: Date | null;
  lastTxAt: Date | null;
  reconnectAttempts: number;
}

export interface BridgeStatus {
  mode: BridgeMode;
  target: string | null;
  connected: boolean;
  stats: BridgeStats;
}

/** The part of the optional `serialport` package's SerialPort used here. */
interface SerialPortLike {
  isOpen: boolean;
  on(event: 'open' | 'close', cb: () => void): unknown;
  on(event: 'data', cb: (data: Buffer) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  write(data: Buffer): unknown;
  close(): void;
}
type SerialPortModule = { SerialPort: new (opts: { path: string; baudRate: number }) => SerialPortLike };

export class SerialBridge extends EventEmitter {
  mode: BridgeMode;
  tcpHost: string;
  tcpPort: number;
  localAddress: string | null;
  listenHost: string | null;
  serialPortName: string | null;
  baudRate: number;
  reconnectInterval: number;

  socket: net.Socket | null;
  server: net.Server | null;
  serialPort: SerialPortLike | null;
  isConnected: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  rxBuffer: string;
  stats: BridgeStats;

  constructor(options: SerialBridgeOptions = {}) {
    super();
    this.mode = options.mode || 'tcp-client'; // 'tcp-client', 'tcp-server', 'serial'
    this.tcpHost = options.tcpHost || '127.0.0.1';
    this.tcpPort = options.tcpPort || 1977;
    this.localAddress = options.localAddress || null;
    this.listenHost = options.listenHost || null; // tcp-server mode; default 127.0.0.1
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

  start(): void {
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
  _startTcpClient(): void {
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

    socket.on('data', (data: Buffer) => {
      this._handleIncomingData(data);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
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

    const connectOpts: net.TcpNetConnectOpts = {
      host: this.tcpHost,
      port: this.tcpPort
    };

    const localAddress = this.localAddress || SerialBridge.linkLocalSource(this.tcpHost);
    if (localAddress) {
      connectOpts.localAddress = localAddress;
    }

    socket.connect(connectOpts);
  }

  _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.stats.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.mode === 'tcp-client') {
        this._startTcpClient();
      }
    }, this.reconnectInterval);
  }

  _clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- TCP Server Mode ---
  _startTcpServer(): void {
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

      sock.on('data', (data: Buffer) => {
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

    // Anything that reaches this port types on the Apple: this PC only unless
    // a listen address is given.
    const listenHost = this.listenHost || '127.0.0.1';
    this.server.listen(this.tcpPort, listenHost, () => {
      console.log(`[Bridge] TCP Server listening on ${listenHost}:${this.tcpPort}...`);
    });
  }

  // --- Serial Port Mode (Hardware / Virtual COM) ---
  _startSerial(): void {
    try {
      // Optional dependency: loaded only when serial mode is used.
      const { SerialPort } = require('serialport') as SerialPortModule;
      console.log(`[Bridge] Opening Serial Port ${this.serialPortName} @ ${this.baudRate} baud...`);
      const serialPort = new SerialPort({
        path: this.serialPortName as string,
        baudRate: this.baudRate
      });
      this.serialPort = serialPort;

      serialPort.on('open', () => {
        this.isConnected = true;
        this.stats.connectedAt = new Date();
        console.log(`[Bridge] Serial Port ${this.serialPortName} opened.`);
        this.emit('connected', { target: this.serialPortName, mode: this.mode });
      });

      serialPort.on('data', (data: Buffer) => {
        this._handleIncomingData(data);
      });

      serialPort.on('error', (err: Error) => {
        console.error(`[Bridge] Serial error: ${err.message}`);
        this.emit('error', err);
      });

      serialPort.on('close', () => {
        this.isConnected = false;
        console.log('[Bridge] Serial port closed.');
        this.emit('disconnected');
      });
    } catch (err) {
      console.error(`[Bridge] serialport module error: ${(err as Error).message}`);
      console.log('[Bridge] Falling back to TCP client mode.');
      this.mode = 'tcp-client';
      this._startTcpClient();
    }
  }

  // --- Data Ingestion & Normalization ---
  _handleIncomingData(buffer: Buffer): void {
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

    let crIndex: number;
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

  _processLine(line: string): void {
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
  send(data: Buffer | string): boolean {
    if (!this.isConnected) {
      return false;
    }

    let buf: Buffer;
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

  sendLine(str = ''): boolean {
    // Apple II terminal prefers \r\n or \r
    return this.send(str + '\r\n');
  }

  sendHttp(statusCode: number, statusText: string, contentType: string, bodyText: string): boolean {
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

  getStatus(): BridgeStatus {
    return {
      mode: this.mode,
      target: this.mode === 'serial' ? this.serialPortName : `${this.tcpHost}:${this.tcpPort}`,
      connected: this.isConnected,
      stats: { ...this.stats }
    };
  }

  stop(): void {
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

  /**
   * A link-local board (169.254.x.x, the STM32 on a direct cable) is only
   * reachable from the PC's own link-local address, and Windows does not always
   * pick that one as the source. Returns the address to bind, or null.
   * BRIDGE_LOCAL_ADDR overrides the search.
   */
  static linkLocalSource(host: string | null | undefined): string | null {
    if (process.env.BRIDGE_LOCAL_ADDR) return process.env.BRIDGE_LOCAL_ADDR;
    if (!host || !host.startsWith('169.254.')) return null;
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        const lname = name.toLowerCase();
        if (lname.includes('tailscale') || lname.includes('bluetooth')) continue;
        for (const addr of ifaces[name]!) {
          if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('169.254.')) {
            return addr.address;
          }
        }
      }
    } catch (e) {}
    return null;
  }
}

export default SerialBridge;

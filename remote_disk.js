/**
 * remote_disk.js - Read the floppy inside the Apple II over the Super Serial Card
 *
 * The Apple (the STM32 emulator, or real hardware) runs apple2/a2srv.bin, a
 * small sector server that reads the Disk II in slot 6, drive 1, at the
 * nibble level and sends the raw address and data fields over the SSC in
 * slot 2. The Apple is booted from A2REMOTE.DSK, whose HELLO makes the SSC
 * DOS's input (IN#2): the PC is its keyboard. This module:
 *   - types commands on the Apple over the SSC (type)
 *   - starts A2SRV with BRUN A2SRV (or, for a disk without it, as monitor hex
 *     lines over the SSC), and stops it again, back at the BASIC prompt
 *   - asks for tracks, decodes the 4&4 address and 6&2 data fields, checks
 *     their checksums, and puts the sectors in DOS 3.3 order
 *   - builds a 143360-byte .dsk image of the disk in the drive, reading only
 *     the tracks the VTOC marks in use unless asked for all of them
 *
 * Standalone use:
 *   node remote_disk.js ping|load|quit|dump [out.dsk] [--full]|type <text>
 *                       [--host 169.254.246.139] [--port 6502] [--baud 9600]
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const EventEmitter = require('events');
const SerialBridge = require('./bridge');

const LOAD_ADDR = 0x6000;
const BIN_PATH = path.join(__dirname, 'apple2', 'a2srv.bin');
const TRACKS = 35;
const SECTORS = 16;
const HELLO = Buffer.from('A2SV', 'ascii');   // followed by the version digit
const A2SRV_VERSION = 2;                       // 2: memory dump (M) and RAM test (R)

// ---- GCR tables -------------------------------------------------------------

// The 64 disk bytes of 6&2 encoding, in value order.
const NIB62 = [
  0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6, 0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3,
  0xB4, 0xB5, 0xB6, 0xB7, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3,
  0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE5, 0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC,
  0xED, 0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF
];
const DEC62 = new Int16Array(256).fill(-1);
NIB62.forEach((b, i) => { DEC62[b] = i; });

// DOS 3.3 logical sector -> physical sector on the disk; a .dsk file is in
// logical order.
const DOS_TO_PHYS = [0, 13, 11, 9, 7, 5, 3, 1, 14, 12, 10, 8, 6, 4, 2, 15];
const PHYS_TO_DOS = new Array(16);
DOS_TO_PHYS.forEach((p, l) => { PHYS_TO_DOS[p] = l; });

function decode44(odd, even) {
  return ((odd << 1) | 1) & even;
}

/** 8 address-field nibbles -> { volume, track, sector, ok } */
function decodeAddress(n) {
  const volume = decode44(n[0], n[1]);
  const track = decode44(n[2], n[3]);
  const sector = decode44(n[4], n[5]);
  const check = decode44(n[6], n[7]);
  return { volume, track, sector, ok: (volume ^ track ^ sector ^ check) === 0 };
}

/** 343 data-field nibbles (86 twos, 256 sixes, checksum) -> 256 bytes, or null */
function decode62(n) {
  if (n.length < 343) return null;
  const twos = new Uint8Array(86);
  const out = Buffer.alloc(256);
  let sum = 0;
  for (let i = 0; i < 86; i++) {
    const v = DEC62[n[i]];
    if (v < 0) return null;
    sum ^= v;
    twos[i] = sum;
  }
  for (let i = 0; i < 256; i++) {
    const v = DEC62[n[86 + i]];
    if (v < 0) return null;
    sum ^= v;
    out[i] = (sum << 2) & 0xFF;
  }
  const last = DEC62[n[342]];
  if (last < 0 || (sum ^ last) !== 0) return null;
  for (let i = 0; i < 256; i++) {
    const v = (twos[i % 86] >> ((Math.floor(i / 86)) * 2)) & 3;
    out[i] |= ((v & 1) << 1) | ((v >> 1) & 1);
  }
  return out;
}

// ---- small TCP helpers for the board's side ports ---------------------------

function connectTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const opts = { host, port };
    const local = SerialBridge.linkLocalSource(host);
    if (local) opts.localAddress = local;
    const sock = net.connect(opts);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`${host}:${port} 접속 시간 초과`)); }, timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
    sock.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one command on the board CLI (TCP 2323) and return its text. */
async function boardCli(host, command, port = 2323, waitMs = 1200) {
  const sock = await connectTcp(host, port);
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
  sock.on('error', () => {});
  await sleep(800);
  const bannerLen = buf.length;
  sock.write(command + '\r\n');
  await sleep(waitMs);
  sock.destroy();
  // Strip telnet negotiation (IAC WILL/WONT/DO/DONT x).
  const raw = buf.subarray(bannerLen);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0xFF && i + 2 < raw.length && raw[i + 1] >= 0xFB && raw[i + 1] <= 0xFE) { i += 2; continue; }
    out.push(raw[i]);
  }
  return Buffer.from(out).toString('latin1');
}

/** Type text on the Apple's keyboard through the board's key port (TCP 6510). */
async function typeKeys(host, text, port = 6510) {
  const sock = await connectTcp(host, port);
  sock.on('data', () => {});
  sock.on('error', () => {});
  await sleep(300);
  sock.write(Buffer.from(text, 'latin1'));
  await sleep(500);
  sock.destroy();
}

/** Control-Reset through the key port (F2 with Control, as tools/a2e-keys.py). */
async function controlReset(host, port = 6510) {
  const frame = (flags, vk) => [0xFF, 0xFE, flags, vk, flags ^ vk ^ 0x5A];
  const sock = await connectTcp(host, port);
  sock.on('data', () => {});
  sock.on('error', () => {});
  await sleep(300);
  sock.write(Buffer.from([...frame(0x05, 0x71), ...frame(0x04, 0x71)]));
  await sleep(500);
  sock.destroy();
}

// ---- the sector client --------------------------------------------------------
class RemoteDisk extends EventEmitter {
  /**
   * @param {SerialBridge} bridge  a byte stream to the Apple's SSC (the STM32's
   *   TCP 6502, AppleWin's SSC socket, or tools/com_relay.py for a real COM port)
   * @param {object} opts
   *   board         the STM32 board's address, for its key (6510) and CLI (2323)
   *                 ports; only used as a last resort to get A2SRV started.
   *                 null for real hardware: then everything goes over the SSC.
   *   charDelayMs   pause between typed characters (a real SSC has a one-byte
   *                 receiver and nothing buffers it while DOS echoes)
   *   lineDelayMs   pause after each typed line, for BASIC/DOS to take it
   *   baud          the line speed, to size the waits for a track (5.6 KB)
   */
  constructor(bridge, opts = {}) {
    super();
    this.bridge = bridge;
    this.board = opts.board || null;
    this.keysPort = opts.keysPort || 6510;
    this.cliPort = opts.cliPort || 2323;
    this.charDelayMs = opts.charDelayMs || 0;
    this.lineDelayMs = opts.lineDelayMs != null ? opts.lineDelayMs : 300;
    this.baud = opts.baud || 0;
    // One track is up to 16 x 352 bytes; at a real serial speed that takes a while.
    this.trackTimeoutMs = this.baud
      ? Math.ceil((16 * 352 * 10 * 1000) / this.baud * 1.5) + 5000
      : 8000;
    this.rx = Buffer.alloc(0);
    this.waiter = null;
    this.busy = false;
    // null until known: after this process starts, A2SRV may still be running
    // on the Apple from before. Once known, it is tracked here and no ping is
    // sent to an Apple sitting at the BASIC prompt (it would type "*P" there).
    this.serverRunning = null;
    this.returnTo = 'basic';      // where A2SRV's RTS lands: 'basic' or 'monitor'
    this._onData = (buf) => {
      this.rx = Buffer.concat([this.rx, buf]);
      if (this.rx.length > 1 << 20) this.rx = this.rx.subarray(-65536);
      if (this.waiter) this.waiter();
    };
    bridge.on('data', this._onData);
  }

  detach() {
    this.bridge.removeListener('data', this._onData);
  }

  _send(bytes) {
    if (!this.bridge.send(Buffer.from(bytes))) {
      throw new Error('SSC 브릿지가 연결되어 있지 않습니다.');
    }
  }

  /** Wait until parse(rx) returns something other than undefined. */
  _waitFor(parse, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error('SSC 응답 시간 초과'));
      }, timeoutMs);
      const check = () => {
        let result;
        try {
          result = parse();
        } catch (e) {
          clearTimeout(timer);
          this.waiter = null;
          reject(e);
          return;
        }
        if (result !== undefined) {
          clearTimeout(timer);
          this.waiter = null;
          resolve(result);
        }
      };
      this.waiter = check;
      check();
    });
  }

  /** Wait for "A2SV<n>"; this.version = n. */
  _waitHello(timeoutMs) {
    return this._waitFor(() => {
      const i = this.rx.indexOf(HELLO);
      if (i < 0 || this.rx.length < i + HELLO.length + 1) return undefined;
      this.version = this.rx[i + HELLO.length] - 0x30;
      return true;
    }, timeoutMs).then(() => true, () => false);
  }

  /**
   * Type on the Apple through the SSC, as its keyboard. `text` may hold several
   * lines (\n or \r); each is ended with RETURN unless `enter` is false.
   * Control characters (Ctrl-C = \x03, ...) go as they are.
   */
  async type(text, { enter = true } = {}) {
    if (!this.bridge.isConnected) throw new Error('SSC 브릿지가 연결되어 있지 않습니다.');
    const lines = String(text).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const last = i === lines.length - 1;
      const line = lines[i] + (last && !enter ? '' : '\r');
      if (!line) continue;
      if (this.charDelayMs > 0) {
        for (const ch of line) {
          this._send(Buffer.from(ch, 'latin1'));
          await sleep(this.charDelayMs);
        }
      } else {
        this._send(Buffer.from(line, 'latin1'));
      }
      if (line.endsWith('\r')) await sleep(this.lineDelayMs);
    }
  }

  /**
   * Is A2SRV there? A ping that nobody answers lands on the Apple's input line
   * as "*P", so after a failed ping the line is cancelled with Ctrl-X.
   */
  async ping(timeoutMs = 1500) {
    this.rx = Buffer.alloc(0);
    this._send([0xAA, 0x50]);
    const ok = await this._waitHello(timeoutMs);
    this.serverRunning = ok;
    if (!ok) {
      this._send([0x18]); // Ctrl-X: cancel the input line
      await sleep(100);
    }
    return ok;
  }

  /** Where the emulated Apple is: 'monitor', 'basic' or 'other' (board CLI). */
  async promptState() {
    const text = await boardCli(this.board, 'screen', this.cliPort);
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.length > 0 && !l.startsWith('a2>'));
    const last = lines.length ? lines[lines.length - 1].trimStart() : '';
    if (last.startsWith('*')) return { state: 'monitor', screen: lines };
    if (last.startsWith(']')) return { state: 'basic', screen: lines };
    return { state: 'other', screen: lines };
  }

  _hexLines() {
    const bin = fs.readFileSync(BIN_PATH);
    const lines = [];
    for (let off = 0; off < bin.length; off += 16) {
      const chunk = bin.subarray(off, off + 16);
      const hex = Array.from(chunk, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      lines.push(`${(LOAD_ADDR + off).toString(16).toUpperCase()}:${hex}`);
    }
    return { bin, lines };
  }

  /**
   * Make sure A2SRV runs on the Apple. The Apple is expected at the BASIC
   * prompt with its input on the SSC (booted from A2REMOTE.DSK):
   *   1. BRUN A2SRV - the program is on the A2REMOTE disk
   *   2. otherwise CALL-151 and the program as monitor hex lines, 6000G
   *      (any disk in the drive; DOS is entered again with 3D0G on quit)
   *   3. STM32 only: the board's key port and CLI, from the monitor
   */
  async load(log = () => {}) {
    if (this.serverRunning !== false && await this.ping()) {
      if (this.version >= A2SRV_VERSION) {
        log(`A2SRV가 이미 실행 중입니다 (v${this.version}).`);
        return { alreadyRunning: true };
      }
      log(`실행 중인 A2SRV가 구버전(v${this.version})이라 종료하고 새로 올립니다.`);
      await this.quit();
    }

    {
      log('BRUN A2SRV 입력 (SSC)');
      this.rx = Buffer.alloc(0);
      await this.type('BRUN A2SRV');
      if (await this._waitHello(this.baud ? 15000 : 8000)) {
        this.serverRunning = true;
        this.returnTo = 'basic';
        if (this.version >= A2SRV_VERSION) {
          log(`A2SRV 실행 확인 (v${this.version}).`);
          return { alreadyRunning: false, how: 'brun' };
        }
        log(`디스크의 A2SRV가 구버전(v${this.version})입니다 - 종료하고 새 버전을 SSC로 보냅니다. (build_remote_dsk.py로 디스크를 다시 만들면 빨라집니다)`);
        await this.quit();
      }
    }

    const { bin, lines } = this._hexLines();
    log(`모니터로 A2SRV ${bin.length}바이트를 SSC로 전송합니다.`);
    this._send([0x18]);
    await this.type('CALL-151');
    this.rx = Buffer.alloc(0);
    await this.type(lines.join('\r'));
    await this.type(`${LOAD_ADDR.toString(16).toUpperCase()}G`);
    if (await this._waitHello(8000)) {
      this.serverRunning = true;
      this.returnTo = 'monitor-from-basic';
      log(`A2SRV 실행 확인 (v${this.version}).`);
      return { alreadyRunning: false, how: 'monitor' };
    }

    if (!this.board) {
      throw new Error('A2SRV가 응답하지 않습니다. Apple이 A2REMOTE 디스크로 부팅되어 BASIC 프롬프트(])에서 SSC 입력을 기다리는지, SSC 속도/케이블을 확인하세요.');
    }
    return this._loadViaBoard(log, bin, lines);
  }

  /**
   * Write the current apple2/a2srv.bin onto the floppy in the drive, with the
   * Apple's own DOS: the program goes into $6000 as monitor hex lines over
   * the SSC (not run), 3D0G returns to BASIC, and BSAVE A2SRV stores it.
   * The Apple must be at the BASIC prompt with DOS and SSC input (A2REMOTE).
   */
  async installA2srv(log = () => {}) {
    if (this.serverRunning) await this.quit();
    const { bin, lines } = this._hexLines();
    log(`A2SRV ${bin.length}바이트를 모니터로 $${LOAD_ADDR.toString(16).toUpperCase()}에 올립니다 (SSC).`);
    this._send([0x18]);
    await this.type('CALL-151');
    await this.type(lines.join('\r'));
    await this.type('3D0G');
    // The A2SRV on the disk is locked (AppleCommander and LOCK below), and
    // BSAVE onto a locked file stops with FILE LOCKED. On a disk without it,
    // UNLOCK just says FILE NOT FOUND.
    const cmd = `BSAVE A2SRV,A$${LOAD_ADDR.toString(16).toUpperCase()},L${bin.length}`;
    log(`UNLOCK A2SRV → ${cmd} → LOCK A2SRV 입력 - 디스켓에 저장`);
    const diskWait = this.baud ? 5000 : 2500;
    await this.type('UNLOCK A2SRV');
    await sleep(diskWait);
    await this.type(cmd);
    await sleep(diskWait + 1500); // DOS writes the file
    await this.type('LOCK A2SRV');
    await sleep(diskWait);
    return { bytes: bin.length, command: cmd };
  }

  /** STM32 emulator only: get to the monitor with the board's own ports. */
  async _loadViaBoard(log, bin, lines) {
    let { state } = await this.promptState();
    log(`Apple 화면 상태: ${state}`);
    if (state === 'other') {
      log('프롬프트가 보이지 않아 Control-Reset을 보냅니다.');
      await controlReset(this.board, this.keysPort);
      await sleep(1500);
      ({ state } = await this.promptState());
    }
    if (state === 'basic') {
      await typeKeys(this.board, '\rCALL-151\r', this.keysPort);
      await sleep(800);
      ({ state } = await this.promptState());
    }
    if (state !== 'monitor') {
      throw new Error('Apple을 모니터(*) 또는 BASIC(]) 프롬프트로 만들 수 없습니다.');
    }
    log('키보드 포트로 IN#2 (2 Ctrl-K) 입력 후 A2SRV를 SSC로 전송합니다.');
    await typeKeys(this.board, '2\x0b\r', this.keysPort);
    await sleep(800);
    this.rx = Buffer.alloc(0);
    this.bridge.send(Buffer.from('\r' + lines.join('\r') + '\r' + `${LOAD_ADDR.toString(16).toUpperCase()}G\r`, 'ascii'));
    if (!(await this._waitHello(8000))) {
      throw new Error('A2SRV가 시작 신호(A2SV)를 보내지 않았습니다.');
    }
    this.serverRunning = true;
    this.returnTo = 'monitor';
    log(`A2SRV 실행 확인 (v${this.version}).`);
    return { alreadyRunning: false, how: 'board', bytes: bin.length };
  }

  /** Stop A2SRV: it puts the head back for DOS and returns (to BASIC). */
  async quit() {
    this.rx = Buffer.alloc(0);
    this._send([0xAA, 0x51]);
    try {
      await this._waitFor(() => (this.rx.indexOf(0x51) >= 0 ? true : undefined), 5000);
    } finally {
      this.serverRunning = false;
    }
    if (this.returnTo === 'monitor-from-basic') {
      await sleep(200);
      await this.type('3D0G'); // DOS warm start: back to the ] prompt
    }
    this.returnTo = 'basic';
    return true;
  }

  /**
   * One request for a track. Resolves to
   *   { sectors: Map(physical -> Buffer(256)), bad: [...], missing, timeout }
   */
  async readTrackOnce(track, timeoutMs = this.trackTimeoutMs) {
    this.rx = Buffer.alloc(0);
    this._send([0xAA, 0x54, track]);
    const sectors = new Map();
    const bad = [];
    let pos = 0;
    return this._waitFor(() => {
      for (;;) {
        if (pos >= this.rx.length) return undefined;
        const tag = this.rx[pos];
        if (tag === 0x53) { // 'S'
          if (this.rx.length - pos < 1 + 8 + 343) return undefined;
          const addr = decodeAddress(this.rx.subarray(pos + 1, pos + 9));
          const data = decode62(this.rx.subarray(pos + 9, pos + 9 + 343));
          pos += 1 + 8 + 343;
          if (!addr.ok || addr.track !== track || addr.sector > 15) {
            bad.push({ reason: 'address', ...addr });
          } else if (!data) {
            bad.push({ reason: 'data checksum', sector: addr.sector });
          } else {
            sectors.set(addr.sector, data);
            this.volume = addr.volume;
          }
        } else if (tag === 0x45 || tag === 0x58) { // 'E' / 'X'
          if (this.rx.length - pos < 2) return undefined;
          const missing = this.rx[pos + 1];
          if (tag === 0x58 && missing === 0xFF) throw new Error(`트랙 번호 오류: ${track}`);
          return { sectors, bad, missing, timeout: tag === 0x58 };
        } else {
          pos++; // stray byte
        }
      }
    }, timeoutMs);
  }

  /** All 16 sectors of a track, retrying; physical sector -> Buffer. */
  async readTrack(track, attempts = 4) {
    const got = new Map();
    let lastErr = null;
    for (let a = 0; a < attempts && got.size < SECTORS; a++) {
      try {
        const r = await this.readTrackOnce(track);
        for (const [s, d] of r.sectors) got.set(s, d);
        if (r.timeout && r.sectors.size === 0) {
          lastErr = new Error(`트랙 ${track}: 디스크에서 섹터를 찾지 못했습니다 (디스크 없음/비표준 포맷?)`);
        }
      } catch (e) {
        lastErr = e;
        if (!(await this.ping(1500))) throw e;
      }
    }
    return { sectors: got, error: got.size < SECTORS ? lastErr : null };
  }

  /**
   * The disk as a DOS-order .dsk image. With `full` false (the default) the
   * VTOC (track 17) is read first and only tracks with sectors in use are
   * read - over a real 9600-baud line a track takes about 6 seconds, and a
   * fresh disk uses only a few. Tracks not read are zeros and listed in
   * `skipped`; sectors that could not be read are listed in `unreadable`.
   */
  async readDisk({ full = false, onProgress = () => {} } = {}) {
    if (this.busy) throw new Error('이미 디스크를 읽는 중입니다.');
    this.busy = true;
    const started = Date.now();
    try {
      const image = Buffer.alloc(TRACKS * SECTORS * 256);
      const unreadable = [];
      const read = new Set();

      const readInto = async (t) => {
        const { sectors, error } = await this.readTrack(t);
        if (read.size === 0 && sectors.size === 0) {
          throw error || new Error(`트랙 ${t}을 읽을 수 없습니다.`);
        }
        for (let p = 0; p < SECTORS; p++) {
          const data = sectors.get(p);
          const logical = PHYS_TO_DOS[p];
          if (data) data.copy(image, (t * SECTORS + logical) * 256);
          else unreadable.push({ track: t, sector: logical });
        }
        read.add(t);
      };

      let plan = [];
      let vtocUsed = null;
      if (!full) {
        onProgress({ track: 17, done: 0, total: 1, phase: 'vtoc' });
        await readInto(17);
        vtocUsed = usedTracks(image.subarray(17 * SECTORS * 256, 17 * SECTORS * 256 + 256));
      }
      if (vtocUsed) {
        plan = vtocUsed.filter((t) => t !== 17);
      } else {
        plan = [];
        for (let t = 0; t < TRACKS; t++) if (!read.has(t)) plan.push(t);
      }
      const total = plan.length + read.size;
      for (const t of plan) {
        await readInto(t);
        onProgress({ track: t, done: read.size, total, sectorsMissing: unreadable.length });
      }
      onProgress({ track: -1, done: total, total });
      const skipped = [];
      for (let t = 0; t < TRACKS; t++) if (!read.has(t)) skipped.push(t);
      return { image, unreadable, skipped, dos: !!vtocUsed, volume: this.volume, ms: Date.now() - started };
    } finally {
      this.busy = false;
    }
  }
}

// ---- memory: dump and RAM test (A2SRV 'M' and 'R') ------------------------------

// MFLAGS for A2SRV's M/R commands
const MAP = { normal: 0x00, rom: 0x01, lc1: 0x02, lc2: 0x04, intcx: 0x08 };
const SCRATCH = 0x80;

Object.assign(RemoteDisk.prototype, {
  /** addr..addr+len-1 from the Apple's memory, in pieces, sum-checked. */
  async readMemory(addr, len, map = 'normal', onProgress = () => {}) {
    const flags = MAP[map];
    if (flags === undefined) throw new Error(`알 수 없는 메모리 맵: ${map}`);
    if (addr < 0 || len < 1 || addr + len > 0x10000) throw new Error('주소 범위가 $0000-$FFFF를 벗어납니다.');
    const piece = this.baud ? 1024 : 4096;
    const out = Buffer.alloc(len);
    for (let off = 0; off < len; off += piece) {
      const n = Math.min(piece, len - off);
      const a = addr + off;
      let data = null;
      for (let attempt = 0; attempt < 3 && !data; attempt++) {
        try {
          data = await this._readMemoryOnce(a, n, flags);
        } catch (e) {
          if (attempt === 2) throw e;
          if (!(await this.ping(1500))) throw e;
        }
      }
      data.copy(out, off);
      onProgress({ done: off + n, total: len });
    }
    return out;
  },

  async _readMemoryOnce(addr, len, flags) {
    this.rx = Buffer.alloc(0);
    this._send([0xAA, 0x4D, addr & 0xFF, addr >> 8, len & 0xFF, len >> 8, flags]);
    const timeout = this.baud ? Math.ceil(len * 10 * 1000 / this.baud * 1.5) + 4000 : 6000;
    const buf = await this._waitFor(() => {
      const start = this.rx.indexOf(0x4D);
      if (start < 0 || this.rx.length < start + 1 + len + 2) return undefined;
      return this.rx.subarray(start + 1, start + 1 + len + 2);
    }, timeout);
    const data = Buffer.from(buf.subarray(0, len));
    let sum = 0;
    for (const b of data) sum = (sum + b) & 0xFFFF;
    const got = buf[len] | (buf[len + 1] << 8);
    if (sum !== got) throw new Error(`메모리 $${hex4(addr)} 체크섬 불일치`);
    return data;
  },

  /** One RAM test block (1-16 pages). -> { errors: n, faults: [{addr, expected, actual}] } */
  async ramTestBlock(page, count, flags) {
    this.rx = Buffer.alloc(0);
    this._send([0xAA, 0x52, page, count, flags]);
    let pos = 0;
    const faults = [];
    return this._waitFor(() => {
      for (;;) {
        if (pos >= this.rx.length) return undefined;
        const tag = this.rx[pos];
        if (tag === 0x46) { // 'F'
          if (this.rx.length - pos < 5) return undefined;
          const r = this.rx;
          faults.push({ addr: r[pos + 1] | (r[pos + 2] << 8), expected: r[pos + 3], actual: r[pos + 4] });
          pos += 5;
        } else if (tag === 0x44) { // 'D'
          if (this.rx.length - pos < 3) return undefined;
          return { errors: this.rx[pos + 1] | (this.rx[pos + 2] << 8), faults };
        } else {
          pos++;
        }
      }
    }, this.baud ? 20000 : 8000);
  },

  /**
   * Test pages first..last (inclusive) in blocks of up to 16 pages.
   * Pages $00-$01 (zero page, stack), A2SRV's code ($60-$64) and $C0-$CF
   * (I/O) are left out; $66-$75 is A2SRV's own save area and is tested
   * without saving it.
   */
  async ramTestRange(first, last, map, onBlock = () => {}) {
    const flags = MAP[map] || 0;
    const skip = (p) => p < 2 || (p >= 0x60 && p <= 0x64) || (p >= 0xC0 && p <= 0xCF);
    const scratch = (p) => p >= 0x66 && p <= 0x75;
    const blocks = [];
    let p = first;
    while (p <= last) {
      if (skip(p)) { p++; continue; }
      const kind = scratch(p);
      let n = 0;
      while (p + n <= last && n < 16 && !skip(p + n) && scratch(p + n) === kind) n++;
      blocks.push({ page: p, count: n, scratch: kind });
      p += n;
    }
    const result = { tested: 0, errors: 0, faults: [] };
    for (const b of blocks) {
      const r = await this.ramTestBlock(b.page, b.count, flags | (b.scratch ? SCRATCH : 0));
      result.tested += b.count * 256;
      result.errors += r.errors;
      for (const f of r.faults) if (result.faults.length < 200) result.faults.push(f);
      onBlock({ page: b.page, count: b.count, errors: r.errors });
    }
    return result;
  },

  /**
   * Machine type, main RAM test, language card RAM test, ROM checksums.
   * opts: { lc: true, rom: true }. Contents of RAM are kept.
   */
  async diagnostics(opts = {}, onStep = () => {}) {
    const report = { at: new Date().toISOString() };
    onStep('기종 확인 (ROM ID 바이트)');
    const idPage = await this.readMemory(0xFB00, 0x100, 'rom');
    report.machine = identifyMachine(idPage);

    onStep('주 메모리 RAM 검사 $0200-$BFFF');
    const main = await this.ramTestRange(0x02, 0xBF, 'normal', (b) => onStep(`주 메모리 $${hex2(b.page)}00 - ${b.errors ? b.errors + '개 오류' : 'OK'}`));
    report.main = summarizeRam(main, '$0200-$BFFF (페이지 $00-$01, $6000-$64FF 제외)');

    if (opts.lc !== false) {
      onStep('Language Card RAM 확인');
      const probe = await this.ramTestBlock(0xD0, 1, MAP.lc2);
      if (probe.errors > 256) {
        report.lc = { present: false, note: 'Language Card RAM이 응답하지 않습니다 (없거나 고장). $D000 한 페이지 검사에서 오류 ' + probe.errors + '개' };
      } else {
        const b2 = await this.ramTestRange(0xD0, 0xFF, 'lc2', (b) => onStep(`LC bank 2 $${hex2(b.page)}00 - ${b.errors ? b.errors + '개 오류' : 'OK'}`));
        const b1 = await this.ramTestRange(0xD0, 0xDF, 'lc1', (b) => onStep(`LC bank 1 $${hex2(b.page)}00 - ${b.errors ? b.errors + '개 오류' : 'OK'}`));
        report.lc = {
          present: true,
          bank2: summarizeRam(b2, '$D000-$FFFF (bank 2 + 공통)'),
          bank1: summarizeRam(b1, '$D000-$DFFF (bank 1)')
        };
      }
    }

    if (opts.rom !== false) {
      onStep('ROM $D000-$FFFF 읽는 중');
      const rom = await this.readMemory(0xD000, 0x3000, 'rom');
      report.romImage = rom;
      report.rom = {
        crc32: hex8(crc32(rom)),
        chips2k: [0xD0, 0xD8, 0xE0, 0xE8, 0xF0, 0xF8].map((pg) => {
          const off = (pg - 0xD0) * 256;
          return { range: `$${hex2(pg)}00-$${hex2(pg + 7)}FF`, crc32: hex8(crc32(rom.subarray(off, off + 0x800))) };
        }),
        halves8k: [
          { range: '$D000-$DFFF', crc32: hex8(crc32(rom.subarray(0, 0x1000))) },
          { range: '$E000-$FFFF', crc32: hex8(crc32(rom.subarray(0x1000))) }
        ]
      };
    }
    return report;
  }
});

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }
function hex8(n) { return (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** The model from the monitor ROM's ID bytes ($FB00 page: $FBB3, $FBC0, $FB1E). */
function identifyMachine(page) {
  const b3 = page[0xB3];
  const c0 = page[0xC0];
  const n1e = page[0x1E];
  let name = '알 수 없음';
  if (b3 === 0x38) name = 'Apple ][ (원형)';
  else if (b3 === 0xEA && n1e === 0xAD) name = 'Apple ][+';
  else if (b3 === 0xEA && n1e === 0x8A) name = 'Apple /// (에뮬레이션 모드)';
  else if (b3 === 0x06 && c0 === 0xEA) name = 'Apple //e';
  else if (b3 === 0x06 && c0 === 0xE0) name = 'Apple //e Enhanced (또는 IIgs)';
  else if (b3 === 0x06 && c0 === 0x00) name = 'Apple //c';
  return { name, id: { FBB3: hex2(b3), FBC0: hex2(c0), FB1E: hex2(n1e) } };
}

/** Errors by data bit and by 16K bank, so a bad chip can be found. */
function summarizeRam(r, label) {
  const bits = new Array(8).fill(0);
  const banks = {};
  for (const f of r.faults) {
    const diff = f.expected ^ f.actual;
    for (let b = 0; b < 8; b++) if (diff & (1 << b)) bits[b]++;
    const bank = `$${hex4(f.addr & 0xC000)}-$${hex4((f.addr & 0xC000) + 0x3FFF)}`;
    banks[bank] = (banks[bank] || 0) + 1;
  }
  return {
    label,
    bytesTested: r.tested,
    errors: r.errors,
    ok: r.errors === 0,
    badBits: bits.map((n, b) => ({ bit: b, count: n })).filter((x) => x.count > 0),
    badBanks: banks,
    faults: r.faults.slice(0, 40).map((f) => ({
      addr: `$${hex4(f.addr)}`, expected: `$${hex2(f.expected)}`, actual: `$${hex2(f.actual)}`,
      bits: [0, 1, 2, 3, 4, 5, 6, 7].filter((b) => (f.expected ^ f.actual) & (1 << b))
    }))
  };
}

/**
 * Tracks with any sector in use, from a DOS 3.3 VTOC (track 17 sector 0), or
 * null when it does not look like one. Bitmap: 4 bytes a track from $38,
 * a set bit is a free sector.
 */
function usedTracks(vtoc) {
  if (!vtoc || vtoc.length < 256) return null;
  const catTrack = vtoc[1];
  const tracks = vtoc[0x34];
  const sectors = vtoc[0x35];
  if (catTrack < 1 || catTrack >= 35 || tracks !== 35 || sectors !== 16 || vtoc[0x27] !== 122) return null;
  const used = [];
  for (let t = 0; t < 35; t++) {
    const free = (vtoc[0x38 + t * 4] << 8) | vtoc[0x39 + t * 4];
    if (free !== 0xFFFF) used.push(t);
  }
  if (!used.includes(catTrack)) used.push(catTrack);
  return used.sort((a, b) => a - b);
}

module.exports = { RemoteDisk, decode62, decodeAddress, usedTracks, crc32, identifyMachine, MAP, NIB62, DOS_TO_PHYS, PHYS_TO_DOS, boardCli };

// ---- command line ---------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
  };
  const host = opt('--host', process.env.BRIDGE_HOST || '169.254.246.139');
  const port = parseInt(opt('--port', process.env.BRIDGE_PORT || '6502'), 10);
  const baud = parseInt(opt('--baud', '0'), 10);
  const isBoard = host.startsWith('169.254.') && !args.includes('--no-board');
  const cmd = args[0] || 'dump';
  const out = args[1] && !args[1].startsWith('--') ? args[1] : path.join(__dirname, 'remote', 'drive1.dsk');

  const bridge = new SerialBridge({ mode: 'tcp-client', tcpHost: host, tcpPort: port });
  bridge.start();
  const rd = new RemoteDisk(bridge, {
    board: isBoard ? host : null,
    baud,
    charDelayMs: baud ? 2 : 0
  });
  const log = (m) => console.log(`[A2SRV] ${m}`);

  bridge.once('connected', async () => {
    try {
      await sleep(300);
      if (cmd === 'ping') {
        log((await rd.ping()) ? `응답 있음 (A2SV v${rd.version})` : '응답 없음');
      } else if (cmd === 'load') {
        await rd.load(log);
      } else if (cmd === 'quit') {
        await rd.quit();
        log('종료됨');
      } else if (cmd === 'type') {
        await rd.type(args.slice(1).filter((a) => !a.startsWith('--')).join(' '));
        log('입력 완료');
      } else if (cmd === 'dump') {
        await rd.load(log);
        const r = await rd.readDisk({
          full: args.includes('--full'),
          onProgress: (p) => process.stdout.write(`\r[A2SRV] 트랙 ${p.done || 0}/${p.total}   `)
        });
        process.stdout.write('\n');
        await rd.quit();
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, r.image);
        log(`${out} 저장 (볼륨 ${r.volume}, ${(r.ms / 1000).toFixed(1)}초, 읽은 트랙 ${35 - r.skipped.length}, 읽지 못한 섹터 ${r.unreadable.length}개)`);
        if (r.unreadable.length) log(JSON.stringify(r.unreadable.slice(0, 20)));
      } else {
        log(`알 수 없는 명령: ${cmd}`);
      }
    } catch (e) {
      console.error(`[A2SRV] 오류: ${e.message}`);
      process.exitCode = 1;
    } finally {
      bridge.stop();
      setTimeout(() => process.exit(), 100);
    }
  });
  setTimeout(() => {
    if (!bridge.isConnected) {
      console.error(`[A2SRV] ${host}:${port} SSC에 연결할 수 없습니다.`);
      process.exit(1);
    }
  }, 8000);
}

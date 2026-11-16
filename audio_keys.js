/**
 * audio_keys.js - Type on the Apple II through its cassette input
 *
 * The Apple runs apple2/a2kbda.bin (the A2REMOTE disk's HELLO loads it), which
 * reads keys from the cassette port while BASIC/DOS waits for input. This
 * module turns text into the sound A2KBDA understands and plays it on the
 * PC's audio output (headphone/line out -> Apple cassette IN, volume high).
 *
 * Packet, as square-wave half cycles (one level between two edges):
 *   leader   833 us halves (600 Hz), 200 of them (about 0.17 s)
 *   sync     150 us, then 250 us
 *   bytes    MSB first; bit 0 = 2 x 250 us, bit 1 = 2 x 500 us
 *            LEN, LEN data bytes, CHK = $A5 ^ LEN ^ data
 *   tail     one more 500 us half, then silence
 * Characters go as 7-bit ASCII (A2KBDA sets bit 7); lines end with RETURN.
 * Up to 255 bytes a packet; A2KBDA buffers a packet, so all its lines arrive
 * even while the Apple is busy with the first one.
 *
 * Command line:
 *   node audio_keys.js play "CATALOG"         play it now
 *   node audio_keys.js wav  "CATALOG" out.wav write the sound to a file
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const RATE = 44100;
const HALF = { leader: 833e-6, sync1: 150e-6, sync2: 250e-6, zero: 250e-6, one: 500e-6 };
const LEADER_HALVES = 200;
const MAX_PACKET = 255;

/** The half-cycle durations (seconds) of one packet carrying `bytes`. */
function packetHalves(bytes) {
  if (bytes.length < 1 || bytes.length > MAX_PACKET) throw new Error(`packet of ${bytes.length} bytes (1-${MAX_PACKET})`);
  const halves = [];
  for (let i = 0; i < LEADER_HALVES; i++) halves.push(HALF.leader);
  halves.push(HALF.sync1, HALF.sync2);
  let chk = 0xA5 ^ bytes.length;
  const putByte = (b) => {
    for (let bit = 7; bit >= 0; bit--) {
      const h = (b >> bit) & 1 ? HALF.one : HALF.zero;
      halves.push(h, h);
    }
  };
  putByte(bytes.length);
  for (const b of bytes) {
    putByte(b);
    chk ^= b;
  }
  putByte(chk);
  halves.push(HALF.one);
  return halves;
}

/**
 * 8-bit unsigned mono PCM of the half cycles: the level flips at each half
 * boundary (times kept exact, samples rounded), then silence.
 * opts.amplitude 0-127 (default 115), opts.silence seconds before/after.
 */
function halvesToPcm(halves, opts = {}) {
  const amp = opts.amplitude == null ? 115 : opts.amplitude;
  const pad = Math.round((opts.silence == null ? 0.05 : opts.silence) * RATE);
  const total = halves.reduce((a, b) => a + b, 0);
  const n = Math.ceil(total * RATE) + 2 * pad;
  const pcm = Buffer.alloc(n, 128);
  let t = 0;
  let level = 1;
  let edge = 0;
  let next = halves[0];
  for (let i = 0; i < n - 2 * pad; i++) {
    const ts = (i + 0.5) / RATE;
    while (edge < halves.length && ts >= t + next) {
      t += next;
      edge++;
      level = -level;
      next = halves[edge];
    }
    if (edge >= halves.length) break;
    pcm[pad + i] = 128 + level * amp;
  }
  return pcm;
}

function wavFile(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);      // PCM
  h.writeUInt16LE(1, 22);      // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE, 28);   // bytes per second
  h.writeUInt16LE(1, 32);      // block align
  h.writeUInt16LE(8, 34);      // bits
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Text to packets: CR/LF become RETURN, non-ASCII is dropped; each line ends
 * with RETURN unless `enter` is false. Lines are packed into packets of up to
 * 255 bytes without splitting a line where possible.
 */
function textToPackets(text, { enter = true } = {}) {
  const lines = String(text).replace(/\r\n|\n/g, '\r').split('\r');
  const chunks = lines.map((l, i) => {
    const last = i === lines.length - 1;
    return Buffer.from(l.replace(/[^\x00-\x7f]/g, '') + (last && !enter ? '' : '\r'), 'latin1');
  }).filter((b) => b.length > 0);
  const packets = [];
  let cur = [];
  let size = 0;
  for (let c of chunks) {
    while (c.length > MAX_PACKET) {
      if (size) { packets.push(Buffer.concat(cur)); cur = []; size = 0; }
      packets.push(c.subarray(0, MAX_PACKET));
      c = c.subarray(MAX_PACKET);
    }
    if (size + c.length > MAX_PACKET) { packets.push(Buffer.concat(cur)); cur = []; size = 0; }
    cur.push(c);
    size += c.length;
  }
  if (size) packets.push(Buffer.concat(cur));
  return packets;
}

/** One WAV holding all packets of `text`, `gap` seconds of silence between them. */
function textToWav(text, opts = {}) {
  const gap = opts.gap == null ? 1.5 : opts.gap;
  const parts = textToPackets(text, opts).map((p, i) => halvesToPcm(packetHalves(p), { silence: i ? gap / 2 : 0.05 }));
  const pcm = Buffer.concat(parts);
  return { wav: wavFile(pcm), seconds: pcm.length / RATE, packets: parts.length };
}

/** Play a WAV on the default output and resolve when it has finished. */
function playWav(wav) {
  const file = path.join(os.tmpdir(), `a2kbda_${process.pid}_${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  const done = () => { try { fs.unlinkSync(file); } catch (e) {} };
  let cmd;
  let args;
  if (process.platform === 'win32') {
    // winsound is in Python's standard library on Windows - nothing to install
    cmd = process.env.PYTHON || 'python';
    args = ['-c', 'import sys, winsound; winsound.PlaySound(sys.argv[1], winsound.SND_FILENAME)', file];
  } else if (process.platform === 'darwin') {
    cmd = 'afplay';
    args = [file];
  } else {
    cmd = 'aplay';
    args = ['-q', file];
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, so, se) => {
      done();
      if (err) reject(new Error(`소리 재생 실패 (${cmd}): ${se || err.message}`));
      else resolve();
    });
  });
}

/**
 * The STM32 emulator board takes the same signal without sound: TCP 6503
 * ("cassette") wants the half cycles themselves, two bytes each,
 * microseconds, little endian, and plays them into $C060 on the emulated
 * CPU's clock. Packets go one at a time, `gap` seconds apart, as on the wire.
 */
function sendHalvesToBoard(packetsHalves, { host, port = 6503, gap = 1.5 } = {}) {
  const net = require('net');
  const SerialBridge = require('./bridge');
  return new Promise((resolve, reject) => {
    const opts = { host, port };
    const local = SerialBridge.linkLocalSource(host);
    if (local) opts.localAddress = local;
    const sock = net.connect(opts);
    sock.setNoDelay(true);
    sock.on('error', (e) => reject(new Error(`보드 카세트 포트 ${host}:${port}: ${e.message}`)));
    sock.on('connect', async () => {
      let seconds = 0;
      for (let i = 0; i < packetsHalves.length; i++) {
        const halves = packetsHalves[i];
        const buf = Buffer.alloc(halves.length * 2);
        halves.forEach((h, j) => buf.writeUInt16LE(Math.max(1, Math.round(h * 1e6)), j * 2));
        sock.write(buf);
        const len = halves.reduce((a, b) => a + b, 0);
        seconds += len;
        // let the board play it before the next one
        await new Promise((r) => setTimeout(r, (len + (i < packetsHalves.length - 1 ? gap : 0.2)) * 1000));
      }
      sock.end();
      resolve({ seconds, packets: packetsHalves.length });
    });
  });
}

let queue = Promise.resolve();
/**
 * Type text on the Apple through its cassette input; calls go one after
 * another. opts.board = { host, port } sends the signal to the STM32 board
 * instead of playing it on the PC's audio output.
 */
function typeByAudio(text, opts = {}) {
  const run = async () => {
    if (opts.board) {
      const halves = textToPackets(text, opts).map(packetHalves);
      return sendHalvesToBoard(halves, { ...opts.board, gap: opts.gap });
    }
    const { wav, seconds, packets } = textToWav(text, opts);
    await playWav(wav);
    return { seconds, packets };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

module.exports = { packetHalves, halvesToPcm, wavFile, textToPackets, textToWav, playWav, sendHalvesToBoard, typeByAudio, RATE };

if (require.main === module) {
  const [cmd, text, out] = process.argv.slice(2);
  if (cmd === 'wav' && text) {
    const r = textToWav(text);
    fs.writeFileSync(out || 'a2kbda.wav', r.wav);
    console.log(`${out || 'a2kbda.wav'}: ${r.packets} packet(s), ${r.seconds.toFixed(2)} s`);
  } else if (cmd === 'play' && text) {
    typeByAudio(text).then((r) => console.log(`played ${r.packets} packet(s), ${r.seconds.toFixed(2)} s`), (e) => { console.error(e.message); process.exit(1); });
  } else if (cmd === 'board' && text) {
    const host = out || process.env.BRIDGE_HOST || '169.254.246.139';
    typeByAudio(text, { board: { host } }).then((r) => console.log(`sent ${r.packets} packet(s) to ${host}:6503, ${r.seconds.toFixed(2)} s`), (e) => { console.error(e.message); process.exit(1); });
  } else {
    console.log('usage: node audio_keys.js play "CATALOG" | wav "CATALOG" out.wav | board "CATALOG" [host]');
  }
}

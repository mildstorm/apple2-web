/**
 * test_runner.ts - Integration test for the Apple2-Web server and its SSC bridge
 * (runs as dist/test_runner.js: npm test)
 *
 * A mock AppleWin SSC socket is opened and dist/server.js is started against
 * it, on ports of its own (HTTP 3999, SSC 19770) so a running server or
 * AppleWin is not disturbed. Then over HTTP:
 *   1. /api/status reports the bridge connected to the mock SSC
 *   2. /api/files lists the catalog of apple2-web.dsk (Python + Java tools)
 *   3. a request with a foreign Host header is refused (DNS rebinding)
 *   4. a cross-site POST is refused (CSRF) and changes nothing
 *   5. /api/remote/status sees the SSC
 *   6. text typed in the web keyboard arrives on the SSC, ending with RETURN
 *   7. a control key (Ctrl-C) arrives as its byte
 * Nothing on the disk is written.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';

const HTTP_PORT = 3999;
const SSC_PORT = 19770;
const TIMEOUT_MS = 30000;

let mockServer: net.Server | undefined;
let serverProc: ChildProcess | undefined;
let sscRx = Buffer.alloc(0);   // everything the server sent to the "Apple"

function cleanup(): void {
  if (serverProc) {
    try { serverProc.kill(); } catch (e) {}
  }
  if (mockServer) {
    try { mockServer.close(); } catch (e) {}
  }
}

function finish(code: number): never {
  cleanup();
  process.exit(code);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface HttpResult {
  status: number;
  body: string;
  json: any;
}

function request(method: string, urlPath: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    const req = http.request({ host: '127.0.0.1', port: HTTP_PORT, method, path: urlPath, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { body += c; });
      res.on('end', () => {
        let json: any = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode || 0, body, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

let passed = 0;
function pass(msg: string): void {
  passed++;
  console.log(`[PASS ${passed}] ${msg}`);
}
function fail(msg: string, detail?: unknown): never {
  console.error(`[FAIL] ${msg}`, detail === undefined ? '' : detail);
  finish(1);
}

/** Retry until the server answers with the bridge connected (or give up). */
async function waitForBridge(): Promise<HttpResult> {
  const until = Date.now() + 15000;
  let last: HttpResult | null = null;
  while (Date.now() < until) {
    try {
      last = await request('GET', '/api/status');
      if (last.json && last.json.bridge && last.json.bridge.connected === true) return last;
    } catch (e) {
      // server not listening yet
    }
    await sleep(250);
  }
  return fail('bridge did not connect to the mock SSC', last && last.body);
}

/** Wait until the bytes the mock SSC received contain `want`. */
async function waitForSsc(want: Buffer, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (sscRx.includes(want)) return true;
    await sleep(50);
  }
  return false;
}

async function runTests(): Promise<void> {
  // 1. bridge connected
  const status = await waitForBridge();
  if (status.json.status !== 'online') fail('/api/status is not online', status.body);
  pass(`/api/status online, bridge connected to ${status.json.bridge.target}`);

  // 2. catalog of the local disk
  const files = await request('GET', '/api/files');
  if (files.status !== 200 || !files.json || !files.json.success || !Array.isArray(files.json.files)) {
    fail('/api/files did not return the catalog (Python, Java and tools/AppleCommander.jar are needed)', files.body);
  }
  pass(`/api/files lists ${files.json.count} file(s) on ${files.json.disk}`);

  // 3. DNS rebinding: foreign Host header
  const rebind = await request('GET', '/api/status', { headers: { Host: 'evil.example' } });
  if (rebind.status !== 403) fail('request with Host: evil.example was not refused', rebind.status);
  pass('foreign Host header refused (403)');

  // 4. CSRF: POST from another site (would create a backup if accepted)
  const csrf = await request('POST', '/api/backups/create', { headers: { Origin: 'http://evil.example' } });
  if (csrf.status !== 403) fail('cross-site POST was not refused', csrf.status);
  pass('cross-site POST refused (403)');

  // 5. remote status
  const remote = await request('GET', '/api/remote/status');
  if (!remote.json || remote.json.available !== true || remote.json.sscConnected !== true) {
    fail('/api/remote/status does not see the SSC', remote.body);
  }
  pass('/api/remote/status: SSC connected');

  // 6. web keyboard -> SSC. The first call asks whether A2SRV runs (no
  //    answer from the mock: about 1.5 s), cancels that line, then types.
  sscRx = Buffer.alloc(0);
  const typed = await request('POST', '/api/remote/type', { body: { text: 'CATALOG', enter: true, via: 'ssc' } });
  if (typed.status !== 200 || !typed.json || !typed.json.success) fail('/api/remote/type failed', typed.body);
  if (!(await waitForSsc(Buffer.from('CATALOG\r', 'ascii')))) fail('typed text did not reach the SSC', sscRx.toString('latin1'));
  pass('web keyboard text "CATALOG" + RETURN arrived on the SSC');

  // 7. control key
  sscRx = Buffer.alloc(0);
  const key = await request('POST', '/api/remote/type', { body: { key: 'ctrl-c', via: 'ssc' } });
  if (key.status !== 200 || !key.json || !key.json.success) fail('/api/remote/type (ctrl-c) failed', key.body);
  if (!(await waitForSsc(Buffer.from([0x03])))) fail('Ctrl-C did not reach the SSC', [...sscRx]);
  pass('Ctrl-C arrived on the SSC as $03');

  console.log('\n=============================================');
  console.log(` ALL ${passed} INTEGRATION TESTS PASSED`);
  console.log('=============================================\n');
  finish(0);
}

console.log('[Test] Starting Apple2-Web integration test...');

// Mock AppleWin SSC socket: records what the server sends to the Apple.
mockServer = net.createServer((sock) => {
  console.log(`[Mock SSC] Server connected on ${SSC_PORT}.`);
  sock.on('data', (buf: Buffer) => { sscRx = Buffer.concat([sscRx, buf]); });
  sock.on('error', () => {});
});

mockServer.on('error', (err) => fail(`mock SSC could not listen on 127.0.0.1:${SSC_PORT}`, err.message));

mockServer.listen(SSC_PORT, '127.0.0.1', () => {
  console.log(`[Mock SSC] Listening on 127.0.0.1:${SSC_PORT}. Starting dist/server.js on port ${HTTP_PORT}...`);
  const proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(HTTP_PORT),
      LISTEN_HOST: '127.0.0.1',
      SERIAL_PORT: '',               // not a COM port, even if set in the shell
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_PORT: String(SSC_PORT)
    }
  });
  serverProc = proc;
  proc.on('error', (err) => fail('could not start dist/server.js', err.message));
  proc.on('exit', (code) => {
    if (serverProc === proc) {
      serverProc = undefined;
      fail(`dist/server.js exited early (code ${code})`);
    }
  });
  runTests().catch((e: Error) => fail('unexpected error', e.message));
});

setTimeout(() => fail(`timed out after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS).unref();

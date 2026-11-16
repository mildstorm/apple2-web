/**
 * server.js - Apple II DOS 3.3 Web File Manager
 * 
 * Features:
 * - Express HTTP Server on port 3000
 * - Real-time DOS 3.3 Disk File Manager for Apple II (apple2-web.dsk)
 * - View, export, add, edit, and delete files on Apple II disk image
 * - Direct download of disk image (.dsk)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const SerialBridge = require('./bridge');
const { RemoteDisk, crc32 } = require('./remote_disk');

const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const DSK_PATH = path.join(__dirname, 'apple2-web.dsk');
// The disk in the Apple's drive 1 (real or emulated), as last read over the
// SSC (read-only here).
const REMOTE_DIR = path.join(__dirname, 'remote');
const REMOTE_DSK = path.join(REMOTE_DIR, 'drive1.dsk');
const BACKUP_DIR = path.join(__dirname, 'backups');
const AC_TOOL = path.join(__dirname, 'ac_tool.py');

// Cross-platform Python command detection (Windows: python/py, Linux/Mac: python3)
function getPythonCommand() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const tryCmd = (cmd) => {
    try {
      require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  };
  if (process.platform !== 'win32' && tryCmd('python3')) return 'python3';
  if (tryCmd('python')) return 'python';
  if (tryCmd('python3')) return 'python3';
  if (tryCmd('py')) return 'py';
  return 'python';
}
const PYTHON_CMD = getPythonCommand();

// Auto-initialize apple2-web.dsk from template on clean clone
if (!fs.existsSync(DSK_PATH)) {
  const templateDsk = path.join(__dirname, 'tools', 'dos33_template.dsk');
  if (fs.existsSync(templateDsk)) {
    fs.copyFileSync(templateDsk, DSK_PATH);
    console.log('[Init] Auto-created apple2-web.dsk from tools/dos33_template.dsk');
  }
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// The Apple's Super Serial Card, reached one of three ways - always as a TCP
// byte stream:
//   --serial COM12 [--baud 9600] [--rtscts]   a real Apple II on a PC COM port;
//                                              tools/com_relay.py relays it to
//                                              127.0.0.1:<--relay-port 6502>
//   --stm32 [--host 169.254.246.139]           the STM32 emulator board, TCP 6502
//   (default) [--host 127.0.0.1 --port 1977]   AppleWin's SSC socket
const argv = process.argv;
const argOf = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};
let bridge = null;
let relayProc = null;
const isStm32 = argv.includes('--stm32');
const SERIAL_PORT = argOf('--serial', process.env.SERIAL_PORT || null);
const SERIAL_BAUD = parseInt(argOf('--baud', process.env.SERIAL_BAUD || '9600'), 10);
const RELAY_PORT = parseInt(argOf('--relay-port', '6502'), 10);
const BRIDGE_HOST = SERIAL_PORT ? '127.0.0.1'
  : (process.env.BRIDGE_HOST || argOf('--host', isStm32 ? '169.254.246.139' : '127.0.0.1'));
const BRIDGE_PORT = SERIAL_PORT ? RELAY_PORT
  : parseInt(process.env.BRIDGE_PORT || argOf('--port', isStm32 ? '6502' : '1977'), 10);
const BRIDGE_ENABLED = !argv.includes('--no-bridge');
const BRIDGE_LABEL = SERIAL_PORT ? `${SERIAL_PORT} @ ${SERIAL_BAUD}` : `${BRIDGE_HOST}:${BRIDGE_PORT}`;
// Text notices to the Apple (file saved, ...) go over the SSC, which is now the
// Apple's keyboard: they would be typed into BASIC. Only with --notify.
const NOTIFY_ENABLED = argv.includes('--notify');

if (BRIDGE_ENABLED && SERIAL_PORT) {
  const relayArgs = [path.join(__dirname, 'tools', 'com_relay.py'), SERIAL_PORT,
    '--baud', String(SERIAL_BAUD), '--port', String(RELAY_PORT)];
  if (argv.includes('--rtscts')) relayArgs.push('--rtscts');
  relayProc = require('child_process').spawn(PYTHON_CMD, relayArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const relayOut = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(l));
  relayProc.stdout.on('data', relayOut);
  relayProc.stderr.on('data', relayOut);
  relayProc.on('exit', (code) => {
    console.error(`[COM] relay ended (code ${code}). Check the port name and that pyserial is installed (python -m pip install pyserial).`);
    relayProc = null;
  });
  process.on('exit', () => { if (relayProc) relayProc.kill(); });
  process.on('SIGINT', () => process.exit());
}

if (BRIDGE_ENABLED) {
  try {
    bridge = new SerialBridge({ mode: 'tcp-client', tcpHost: BRIDGE_HOST, tcpPort: BRIDGE_PORT });
    bridge.start();
    bridge.on('connected', () => console.log(`[Bridge] Apple II SSC connected (${BRIDGE_LABEL})`));
    bridge.on('error', () => {}); // silence if not running
  } catch (e) {
    // Bridge optional
  }
}

// The Apple's floppy and keyboard over the SSC (remote_disk.js, apple2/a2srv.s)
const remoteDisk = bridge ? new RemoteDisk(bridge, {
  board: isStm32 ? BRIDGE_HOST : null,   // the board's key/CLI ports, emulator only
  baud: SERIAL_PORT ? SERIAL_BAUD : 0,
  charDelayMs: SERIAL_PORT ? 2 : 0,      // a real SSC holds one received byte
  lineDelayMs: SERIAL_PORT ? 400 : 250
}) : null;
const remoteState = {
  phase: 'idle',      // idle | loading | reading | done | error
  message: '',
  track: 0,
  tracks: 35,
  log: [],
  lastSync: null      // { at, ms, volume, unreadable }
};

function remoteLog(msg) {
  console.log(`[A2SRV] ${msg}`);
  remoteState.message = msg;
  remoteState.log.push(`${new Date().toLocaleTimeString()} ${msg}`);
  if (remoteState.log.length > 30) remoteState.log.shift();
}

/** ?disk=remote selects the disk read from the Apple's drive 1; anything else the local one. */
function diskFor(req) {
  const which = String((req.query && req.query.disk) || (req.body && req.body.disk) || 'local').toLowerCase();
  if (which === 'remote' || which === 'stm32') {
    return { id: 'remote', path: REMOTE_DSK, name: 'drive1.dsk', readOnly: true };
  }
  return { id: 'local', path: DSK_PATH, name: 'apple2-web.dsk', readOnly: false };
}

function notifyAppleII(msg) {
  if (!NOTIFY_ENABLED) return;
  // A2SRV owns the SSC while it runs; text would only be thrown away there.
  if (remoteDisk && remoteDisk.serverRunning) return;
  if (bridge && bridge.isConnected) {
    try {
      bridge.sendLine(`\r\n*** [WEB NOTICE] ${msg} ***\r\n`);
    } catch (e) {}
  }
}

// =========================================================
// 1. 디스크 뮤텍스 락 (Concurrency Queue)
// =========================================================
let isDiskBusy = false;
const diskQueue = [];

function withDiskLock(taskFn) {
  return new Promise((resolve, reject) => {
    const execute = () => {
      isDiskBusy = true;
      taskFn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          isDiskBusy = false;
          if (diskQueue.length > 0) {
            const next = diskQueue.shift();
            next();
          }
        });
    };

    if (isDiskBusy) {
      diskQueue.push(execute);
    } else {
      execute();
    }
  });
}

// =========================================================
// 2. 자동 백업 스냅샷 및 롤백 시스템
// =========================================================
function createBackupSnapshot(label = 'auto') {
  if (!fs.existsSync(DSK_PATH)) return null;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `apple2-web_${timestamp}_${label}.dsk`;
  const backupPath = path.join(BACKUP_DIR, filename);

  fs.copyFileSync(DSK_PATH, backupPath);

  // 최신 15개 스냅샷 유지 (오래된 것 자동 정리)
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('apple2-web_') && f.endsWith('.dsk'))
    .sort()
    .reverse();

  if (files.length > 15) {
    for (let i = 15; i < files.length; i++) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, files[i])); } catch (e) {}
    }
  }

  const stat = fs.statSync(backupPath);
  return {
    filename,
    timestamp: now.toISOString(),
    displayTime: now.toLocaleString(),
    size: stat.size,
    label
  };
}

function rollbackToSnapshot(filename) {
  const safeName = path.basename(filename);
  const target = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(target)) {
    throw new Error('지정한 백업 스냅샷 파일이 존재하지 않습니다.');
  }

  // 롤백 직전의 현재 상태도 스냅샷 보존
  createBackupSnapshot('pre_rollback');
  fs.copyFileSync(target, DSK_PATH);
  notifyAppleII('DISK ROLLED BACK TO SNAPSHOT. TYPE CATALOG.');
  return true;
}

// =========================================================
// 3. Applesoft BASIC 미닫힌 OPEN 파일 구문 검사 (Linter)
// =========================================================
function lintApplesoftBasic(code) {
  const warnings = [];
  if (!code) return { hasWarnings: false, warnings };

  const lines = code.split('\n');
  let hasOpen = false;
  let hasClose = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (/\bOPEN\b/i.test(upper) || /CHR\$\(4\)[+;,\s]*"?OPEN/i.test(upper) || /D\$[+;,\s]*"?OPEN/i.test(upper)) {
      hasOpen = true;
    }
    if (/\bCLOSE\b/i.test(upper) || /CHR\$\(4\)[+;,\s]*"?CLOSE/i.test(upper) || /D\$[+;,\s]*"?CLOSE/i.test(upper)) {
      hasClose = true;
    }
  }

  if (hasOpen && !hasClose) {
    warnings.push('OPEN 명령이 감지되었으나 CLOSE 명령이 누락되었습니다. 실기에서 디스크 교체 시 파일 버퍼 미닫힘으로 데이터가 손상될 수 있으니 CLOSE를 추가하세요.');
  }

  return { hasWarnings: warnings.length > 0, warnings };
}

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. 파일 목록 조회 (JSON)
app.get('/api/files', (req, res) => {
  const disk = diskFor(req);
  if (!fs.existsSync(disk.path)) {
    const hint = disk.id === 'remote' ? ' [📡 Apple에서 읽기]로 먼저 Apple 드라이브 1을 읽어 오세요.' : '';
    return res.status(404).json({ error: `${disk.name} 파일이 없습니다.${hint}` });
  }

  exec(`"${PYTHON_CMD}" "${AC_TOOL}" json "${disk.path}"`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    try {
      const files = JSON.parse(stdout.trim());
      res.json({ success: true, disk: disk.name, source: disk.id, readOnly: disk.readOnly, count: files.length, files });
    } catch (e) {
      res.status(500).json({ error: '파일 목록 파싱 실패: ' + e.message });
    }
  });
});

// 2. 파일 내용 조회/추출 (BASIC은 텍스트, 바이너리는 Raw Hex)
app.get('/api/files/:filename', (req, res) => {
  // The name exactly as the catalog has it: DOS 3.3 names may hold spaces
  // ("GUN SOUND.OBJ") or control characters. It goes to Python as an
  // argument (execFile, no shell), so nothing in it is interpreted.
  const filename = req.params.filename;
  if (!filename || filename.length > 30 || /[\0"]/.test(filename)) {
    return res.status(400).json({ error: '잘못된 파일명입니다.' });
  }
  const fileType = (req.query.type || '').toUpperCase();
  const disk = diskFor(req);
  if (!fs.existsSync(disk.path)) {
    return res.status(404).json({ error: `${disk.name} 파일이 없습니다.` });
  }

  if (fileType === 'B') {
    const tempBin = path.join(__dirname, `_temp_${Date.now()}.bin`);
    execFile(PYTHON_CMD, [AC_TOOL, 'get', disk.path, filename, tempBin], (err, stdout, stderr) => {
      if (err || !fs.existsSync(tempBin)) {
        return res.status(500).json({ error: stderr || err?.message || '바이너리 추출 실패' });
      }
      try {
        const buf = fs.readFileSync(tempBin);
        fs.unlinkSync(tempBin);
        res.json({
          success: true,
          filename,
          type: 'B',
          size: buf.length,
          hex: buf.toString('hex')
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  } else {
    execFile(PYTHON_CMD, [AC_TOOL, 'export', disk.path, filename], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return res.status(500).json({ error: stderr || err.message });
      }
      res.json({ success: true, filename, type: 'A', content: stdout });
    });
  }
});

// 3. 새 파일 추가 / 수정 (BASIC 텍스트 또는 바이너리 Hex 저장 - 뮤텍스 & 안전 스냅샷 보장)
app.post('/api/files', (req, res) => {
  let { filename, content, type, hex } = req.body;
  if (diskFor(req).readOnly) {
    return res.status(403).json({ error: 'Apple에서 읽어 온 디스크는 읽기 전용입니다. 로컬 디스크로 전환한 뒤 저장하세요.' });
  }
  if (!filename) {
    return res.status(400).json({ error: '파일명이 필요합니다.' });
  }
  filename = filename.trim().toUpperCase().replace(/[^A-Z0-9_\-\.]/g, '');
  type = (type || 'A').toUpperCase();

  // BASIC 문법 안전 검사 (미닫힌 OPEN 방지)
  let linterResult = { hasWarnings: false, warnings: [] };
  if (type === 'A') {
    linterResult = lintApplesoftBasic(content || '');
  }

  withDiskLock(() => {
    return new Promise((resolve, reject) => {
      // 쓰기 직전 자동 스냅샷 백업
      const backupInfo = createBackupSnapshot(`before_save_${filename}`);

      if (type === 'B' && hex) {
        // 바이너리 데이터 저장
        const tempFile = path.join(__dirname, `_temp_${Date.now()}.bin`);
        const buf = Buffer.from(hex, 'hex');
        fs.writeFileSync(tempFile, buf);

        exec(`"${PYTHON_CMD}" "${AC_TOOL}" put "${DSK_PATH}" "${filename}" B 0x0801 "${tempFile}"`, (err, stdout, stderr) => {
          try { fs.unlinkSync(tempFile); } catch (e) {}
          if (err) return reject(new Error(stderr || err.message));
          notifyAppleII(`SAVED FILE: ${filename} (BIN, ${buf.length}B)`);
          resolve({
            success: true,
            message: `바이너리 파일 '${filename}' (${buf.length} bytes) 디스크 저장 완료`,
            backup: backupInfo,
            warnings: []
          });
        });
      } else {
        // BASIC 프로그램 저장
        content = content || '';
        const tempFile = path.join(__dirname, `_temp_${Date.now()}.bas`);
        fs.writeFileSync(tempFile, content, 'utf8');

        exec(`"${PYTHON_CMD}" "${AC_TOOL}" put-basic "${DSK_PATH}" "${filename}" "${tempFile}"`, (err, stdout, stderr) => {
          try { fs.unlinkSync(tempFile); } catch (e) {}
          if (err) return reject(new Error(stderr || err.message));
          notifyAppleII(`SAVED FILE: ${filename} (BASIC)`);
          resolve({
            success: true,
            message: `Applesoft BASIC 파일 '${filename}' 디스크 저장 완료`,
            backup: backupInfo,
            warnings: linterResult.warnings
          });
        });
      }
    });
  })
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});

// 4. 파일 삭제 (뮤텍스 & 안전 스냅샷 보장)
app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename.toUpperCase().replace(/[^A-Z0-9_\-\.]/g, '');
  if (diskFor(req).readOnly) {
    return res.status(403).json({ error: 'Apple에서 읽어 온 디스크는 읽기 전용입니다.' });
  }

  withDiskLock(() => {
    return new Promise((resolve, reject) => {
      const backupInfo = createBackupSnapshot(`before_delete_${filename}`);
      exec(`"${PYTHON_CMD}" "${AC_TOOL}" delete "${DSK_PATH}" "${filename}"`, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        notifyAppleII(`DELETED FILE: ${filename}`);
        resolve({
          success: true,
          message: `파일 '${filename}' 삭제 완료`,
          backup: backupInfo
        });
      });
    });
  })
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});

// 5. 디스크 백업 스냅샷 목록 조회
app.get('/api/backups', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('apple2-web_') && f.endsWith('.dsk'))
      .sort()
      .reverse();

    const backups = files.map(file => {
      const stat = fs.statSync(path.join(BACKUP_DIR, file));
      return {
        filename: file,
        size: stat.size,
        mtime: stat.mtime.toLocaleString()
      };
    });
    res.json({ success: true, count: backups.length, backups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 6. 백업 스냅샷으로 디스크 롤백(복원)
app.post('/api/backups/rollback', (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: '복원할 스냅샷 파일명이 필요합니다.' });
  }

  withDiskLock(async () => {
    rollbackToSnapshot(filename);
    return { success: true, message: `디스크가 스냅샷 '${filename}' 시점으로 안전하게 복원되었습니다.` };
  })
    .then(result => res.json(result))
    .catch(err => res.status(500).json({ error: err.message }));
});

// 7. 수동 스냅샷 생성
app.post('/api/backups/create', (req, res) => {
  try {
    const info = createBackupSnapshot('manual');
    res.json({ success: true, message: '새 디스크 스냅샷이 생성되었습니다.', backup: info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 8. 디스크 이미지 (.dsk) 통째로 다운로드
app.get('/api/download/dsk', (req, res) => {
  const disk = diskFor(req);
  if (fs.existsSync(disk.path)) {
    res.download(disk.path, disk.name);
  } else {
    res.status(404).send('DSK 파일이 존재하지 않습니다.');
  }
});

// 9. 브릿지 및 서버 상태 확인
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    targetDsk: DSK_PATH,
    bridge: bridge ? bridge.getStatus() : { connected: false }
  });
});

// =========================================================
// 11. Apple II 원격 키보드 & 드라이브 1 읽기 (Super Serial Card)
//     실기(COM 포트) / STM32 에뮬레이터 / AppleWin 공통
// =========================================================
const REMOTE_BOOT_DSK = path.join(__dirname, 'a2remote.dsk');
const typedHistory = [];   // 웹에서 보낸 명령 기록 (최근 50개)

function remoteStatus() {
  const exists = fs.existsSync(REMOTE_DSK);
  return {
    available: !!remoteDisk,
    link: SERIAL_PORT ? 'serial' : isStm32 ? 'stm32' : 'tcp',
    target: BRIDGE_LABEL,
    sscConnected: !!(bridge && bridge.isConnected),
    serverRunning: !!(remoteDisk && remoteDisk.serverRunning),
    busy: !!(remoteDisk && remoteDisk.busy) || remoteState.phase === 'loading' || remoteState.phase === 'reading',
    phase: remoteState.phase,
    message: remoteState.message,
    done: remoteState.done || 0,
    total: remoteState.total || 0,
    log: remoteState.log,
    typed: typedHistory.slice(-20),
    job: remoteState.job || null,
    lastSync: remoteState.lastSync,
    lastDump: remoteState.lastDump || null,
    hasDiag: !!remoteState.diag,
    snapshot: exists ? { path: REMOTE_DSK, mtime: fs.statSync(REMOTE_DSK).mtime } : null
  };
}

function requireRemote(res) {
  if (!remoteDisk) {
    res.status(503).json({ error: 'SSC 브릿지가 꺼져 있습니다 (--no-bridge).' });
    return false;
  }
  if (!bridge.isConnected) {
    res.status(503).json({ error: `SSC(${BRIDGE_LABEL})에 연결되어 있지 않습니다. 케이블/보드 전원과 서버 실행 옵션(--serial COMx 또는 --stm32)을 확인하세요.` });
    return false;
  }
  if (remoteDisk.busy || remoteState.phase === 'loading' || remoteState.phase === 'reading') {
    res.status(409).json({ error: '지금 Apple 작업(디스크 읽기/덤프/진단)이 진행 중입니다. 끝난 뒤 다시 시도하세요.' });
    return false;
  }
  return true;
}

app.get('/api/remote/status', (req, res) => {
  res.json(remoteStatus());
});

// Apple 쪽 작업(디스크 읽기, 메모리 덤프, 진단)을 하나씩 돌림:
// A2SRV 실행(BRUN A2SRV) → work() → A2SRV 종료(BASIC 프롬프트로).
// 바로 202를 돌려주고 진행은 /api/remote/status 로 확인.
function runRemoteJob(res, job, startMsg, work) {
  if (!requireRemote(res)) return;
  remoteState.job = job;
  remoteState.phase = 'loading';
  remoteState.done = 0;
  remoteState.total = 0;
  remoteState.log = [];
  remoteLog('A2SRV 시작 중...');
  res.status(202).json({ success: true, message: startMsg });

  (async () => {
    try {
      await remoteDisk.load(remoteLog);
      remoteState.phase = 'reading';
      const msg = await work((done, total) => {
        remoteState.done = done;
        remoteState.total = total;
      });
      try {
        await remoteDisk.quit();
      } catch (e) {
        remoteLog(`A2SRV 종료 응답 없음: ${e.message}`);
      }
      remoteState.phase = 'done';
      remoteLog(msg);
    } catch (e) {
      remoteState.phase = 'error';
      remoteLog(`오류: ${e.message}`);
      // A2SRV가 떠 있으면 내려서 키보드(SSC) 입력이 BASIC으로 돌아가게 함
      if (remoteDisk.serverRunning) {
        try { await remoteDisk.quit(); } catch (e2) {}
      }
    }
  })();
}

// 드라이브 1을 읽어 remote/drive1.dsk 로 저장. 기본은 VTOC에서 사용 중인 트랙만
// ({ full: true } 이면 35트랙 전부).
app.post('/api/remote/sync', (req, res) => {
  const full = !!(req.body && req.body.full);
  runRemoteJob(res, 'sync', 'Apple 드라이브 1 읽기를 시작했습니다.', async (progress) => {
    remoteLog(full ? '드라이브 1 전체(35트랙) 읽는 중...' : '드라이브 1 읽는 중 (VTOC의 사용 트랙만)...');
    const r = await remoteDisk.readDisk({ full, onProgress: (p) => progress(p.done || 0, p.total || 0) });
    fs.mkdirSync(REMOTE_DIR, { recursive: true });
    fs.writeFileSync(REMOTE_DSK, r.image);
    remoteState.lastSync = {
      at: new Date().toISOString(),
      ms: r.ms,
      volume: r.volume,
      dos: r.dos,
      tracksRead: 35 - r.skipped.length,
      unreadable: r.unreadable
    };
    return `완료: ${35 - r.skipped.length}트랙, ${(r.ms / 1000).toFixed(1)}초, 읽지 못한 섹터 ${r.unreadable.length}개`;
  });
});

// ---- 메모리 덤프: Apple 메모리의 한 구간을 PC 파일로 (remote/dumps/*.bin) ----
const DUMP_DIR = path.join(REMOTE_DIR, 'dumps');
const MAP_LABEL = {
  normal: '현재 매핑',
  rom: 'ROM ($D000-$FFFF는 ROM)',
  lc1: 'Language Card RAM bank 1',
  lc2: 'Language Card RAM bank 2',
  intcx: '//e 내부 $C100-$CFFF ROM'
};

function parseAddr(v) {
  const s = String(v == null ? '' : v).trim().replace(/^\$|^0x/i, '');
  if (!/^[0-9a-f]{1,4}$/i.test(s)) return NaN;
  return parseInt(s, 16);
}

const hex4s = (n) => n.toString(16).toUpperCase().padStart(4, '0');

// body: { start: "D000", end: "FFFF", map: "rom", name?: "IIE_ROM" }  (end 포함)
app.post('/api/remote/memdump', (req, res) => {
  const b = req.body || {};
  const start = parseAddr(b.start);
  const end = parseAddr(b.end);
  const map = String(b.map || 'normal');
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return res.status(400).json({ error: '시작/끝 주소를 16진수로 입력하세요 (예: D000, FFFF).' });
  }
  if (!MAP_LABEL[map]) return res.status(400).json({ error: `알 수 없는 메모리 맵: ${map}` });
  const name = String(b.name || '').toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 32);
  const len = end - start + 1;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '_');
  const file = `${name ? name + '_' : ''}${hex4s(start)}-${hex4s(end)}_${map}_${stamp}.bin`;

  runRemoteJob(res, 'memdump', `$${hex4s(start)}-$${hex4s(end)} 덤프를 시작했습니다.`, async (progress) => {
    remoteLog(`메모리 $${hex4s(start)}-$${hex4s(end)} (${len}바이트, ${MAP_LABEL[map]}) 읽는 중...`);
    const data = await remoteDisk.readMemory(start, len, map, (p) => progress(p.done, p.total));
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    fs.writeFileSync(path.join(DUMP_DIR, file), data);
    remoteState.lastDump = { file, start, end, map, size: len, crc32: crc32(data).toString(16).toUpperCase().padStart(8, '0') };
    return `덤프 완료: ${file} (${len}바이트, CRC32 ${remoteState.lastDump.crc32})`;
  });
});

app.get('/api/remote/dumps', (req, res) => {
  if (!fs.existsSync(DUMP_DIR)) return res.json({ dumps: [] });
  const dumps = fs.readdirSync(DUMP_DIR).filter((f) => f.endsWith('.bin')).map((f) => {
    const st = fs.statSync(path.join(DUMP_DIR, f));
    const m = f.match(/([0-9A-F]{4})-([0-9A-F]{4})_([a-z0-9]+)_/);
    return { file: f, size: st.size, mtime: st.mtime, start: m ? m[1] : null, end: m ? m[2] : null, map: m ? m[3] : null };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json({ dumps });
});

app.get('/api/remote/dumps/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const p = path.join(DUMP_DIR, file);
  if (!file.endsWith('.bin') || !fs.existsSync(p)) return res.status(404).json({ error: '덤프 파일이 없습니다.' });
  if (req.query.format === 'hex') {
    return res.json({ file, size: fs.statSync(p).size, hex: fs.readFileSync(p).toString('hex') });
  }
  res.download(p, file);
});

// ---- 진단: 기종 확인, 주 메모리/Language Card RAM 검사, ROM CRC32 ----
// body: { lc: true, rom: true }   RAM 내용은 검사 후 그대로 복원됨
app.post('/api/remote/diag', (req, res) => {
  const opts = { lc: !(req.body && req.body.lc === false), rom: !(req.body && req.body.rom === false) };
  runRemoteJob(res, 'diag', '메모리 진단을 시작했습니다.', async (progress) => {
    let step = 0;
    const report = await remoteDisk.diagnostics(opts, (msg) => {
      step++;
      progress(step, 0);
      remoteState.message = msg;
    });
    if (report.romImage) {
      fs.mkdirSync(DUMP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '_');
      report.rom.file = `DIAG_ROM_D000-FFFF_rom_${stamp}.bin`;
      fs.writeFileSync(path.join(DUMP_DIR, report.rom.file), report.romImage);
      delete report.romImage;
    }
    remoteState.diag = report;
    const parts = [`기종: ${report.machine.name}`, `주 메모리 ${report.main.ok ? 'OK' : '오류 ' + report.main.errors + '개'}`];
    if (report.lc) parts.push(report.lc.present ? `LC ${report.lc.bank1.ok && report.lc.bank2.ok ? 'OK' : '오류'}` : 'LC 없음');
    if (report.rom) parts.push(`ROM CRC32 ${report.rom.crc32}`);
    return `진단 완료: ${parts.join(', ')}`;
  });
});

app.get('/api/remote/diag', (req, res) => {
  res.json({ report: remoteState.diag || null });
});

// 웹에서 입력한 명령을 SSC로 Apple 키보드처럼 입력 (화면 결과는 돌려받지 않음)
// body: { text: "CATALOG", enter: true }  — 여러 줄이면 줄마다 RETURN
//       { key: "ctrl-c" | "return" | "esc" | "ctrl-x" }
app.post('/api/remote/type', async (req, res) => {
  if (!requireRemote(res)) return;
  const body = req.body || {};
  const keys = { 'ctrl-c': '\x03', return: '\r', esc: '\x1b', 'ctrl-x': '\x18', 'ctrl-s': '\x13' };
  let text;
  let enter = body.enter !== false;
  if (body.key) {
    text = keys[String(body.key).toLowerCase()];
    if (text === undefined) return res.status(400).json({ error: `알 수 없는 키: ${body.key}` });
    enter = false;
  } else {
    text = String(body.text || '');
    if (!text && !enter) return res.status(400).json({ error: '입력할 내용이 없습니다.' });
    if (text.length > 4000) return res.status(400).json({ error: '한 번에 4000자까지 보낼 수 있습니다.' });
    // Apple 쪽에는 7비트 ASCII만
    text = text.replace(/[^\x00-\x7f]/g, '');
  }
  try {
    // 서버 재시작 직후엔 A2SRV가 아직 떠 있는지 모름: 한 번만 확인
    if (remoteDisk.serverRunning === null) await remoteDisk.ping();
    if (remoteDisk.serverRunning) {
      await remoteDisk.quit(); // A2SRV가 SSC를 쥐고 있으면 먼저 BASIC으로
    }
    await remoteDisk.type(text, { enter });
    typedHistory.push({ at: new Date().toISOString(), text: body.key ? `<${body.key}>` : text });
    if (typedHistory.length > 50) typedHistory.shift();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A2SRV가 떠 있으면 끝내고 BASIC 프롬프트로
app.post('/api/remote/quit', async (req, res) => {
  if (!requireRemote(res)) return;
  try {
    await remoteDisk.quit();
    remoteLog('A2SRV 종료');
    res.json({ success: true, message: 'A2SRV를 종료했습니다.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 실기 부팅용 A2REMOTE.DSK 다운로드 (없으면 build_remote_dsk.py로 만듦)
app.get('/api/download/a2remote', (req, res) => {
  const send = () => res.download(REMOTE_BOOT_DSK, 'A2REMOTE.DSK');
  if (fs.existsSync(REMOTE_BOOT_DSK)) return send();
  execFile(PYTHON_CMD, [path.join(__dirname, 'build_remote_dsk.py'), REMOTE_BOOT_DSK], (err, stdout, stderr) => {
    if (err) return res.status(500).send(stderr || err.message);
    send();
  });
});

// 10. STM32 에뮬레이터 SD 카드로 A2WEB.DSK 실시간 업로드 (SWD)
app.post('/api/upload/stm32', (req, res) => {
  const uploadScript = path.join(__dirname, '..', 'STM32CubeIDE', 'STM32F769I-DISCO', 'tools', 'sd-upload.ps1');
  if (!fs.existsSync(uploadScript)) {
    return res.status(404).json({ error: 'sd-upload.ps1 스크립트를 찾을 수 없습니다.' });
  }

  exec(`pwsh -File "${uploadScript}" "${DSK_PATH}" -Name A2WEB.DSK`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    notifyAppleII('NEW DSK UPLOADED TO SD CARD (A2WEB.DSK).');
    res.json({ success: true, message: 'STM32 SD 카드로 A2WEB.DSK 업로드 완료', output: stdout });
  });
});

// 서버 구동
server.listen(HTTP_PORT, () => {
  console.log('===============================================================');
  console.log(` Apple II DOS 3.3 Disk File Manager`);
  console.log(` Web Server: http://localhost:${HTTP_PORT}`);
  console.log(` Target DSK: ${DSK_PATH}`);
  console.log('===============================================================');
});

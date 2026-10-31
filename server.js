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
const { exec } = require('child_process');
const SerialBridge = require('./bridge');

const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const DSK_PATH = path.join(__dirname, 'apple2-web.dsk');
const BACKUP_DIR = path.join(__dirname, 'backups');
const AC_TOOL = path.join(__dirname, 'ac_tool.py');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Optional SSC Serial Bridge for AppleWin / Real Hardware live notification
let bridge = null;
try {
  bridge = new SerialBridge({ mode: 'tcp-client', tcpHost: '127.0.0.1', tcpPort: 1977 });
  bridge.start();
  bridge.on('connected', () => console.log('[Bridge] Apple II SSC Connected on port 1977'));
  bridge.on('error', () => {}); // silence if AppleWin is not running
} catch (e) {
  // Bridge optional
}

function notifyAppleII(msg) {
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
  if (!fs.existsSync(DSK_PATH)) {
    return res.status(404).json({ error: 'apple2-web.dsk 파일이 없습니다.' });
  }

  exec(`python "${AC_TOOL}" json "${DSK_PATH}"`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    try {
      const files = JSON.parse(stdout.trim());
      res.json({ success: true, disk: 'apple2-web.dsk', count: files.length, files });
    } catch (e) {
      res.status(500).json({ error: '파일 목록 파싱 실패: ' + e.message });
    }
  });
});

// 2. 파일 내용 조회/추출 (BASIC은 텍스트, 바이너리는 Raw Hex)
app.get('/api/files/:filename', (req, res) => {
  const filename = req.params.filename.toUpperCase();
  const fileType = (req.query.type || '').toUpperCase();

  if (fileType === 'B') {
    const tempBin = path.join(__dirname, `_temp_${Date.now()}.bin`);
    exec(`python "${AC_TOOL}" get "${DSK_PATH}" "${filename}" "${tempBin}"`, (err, stdout, stderr) => {
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
    exec(`python "${AC_TOOL}" export "${DSK_PATH}" "${filename}"`, (err, stdout, stderr) => {
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

        exec(`python "${AC_TOOL}" put "${DSK_PATH}" "${filename}" B 0x0801 "${tempFile}"`, (err, stdout, stderr) => {
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

        exec(`python "${AC_TOOL}" put-basic "${DSK_PATH}" "${filename}" "${tempFile}"`, (err, stdout, stderr) => {
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
  const filename = req.params.filename.toUpperCase();

  withDiskLock(() => {
    return new Promise((resolve, reject) => {
      const backupInfo = createBackupSnapshot(`before_delete_${filename}`);
      exec(`python "${AC_TOOL}" delete "${DSK_PATH}" "${filename}"`, (err, stdout, stderr) => {
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
  if (fs.existsSync(DSK_PATH)) {
    res.download(DSK_PATH, 'apple2-web.dsk');
  } else {
    res.status(404).send('DSK 파일이 존재하지 않습니다.');
  }
});

// 서버 구동
server.listen(HTTP_PORT, () => {
  console.log('===============================================================');
  console.log(` Apple II DOS 3.3 Disk File Manager`);
  console.log(` Web Server: http://localhost:${HTTP_PORT}`);
  console.log(` Target DSK: ${DSK_PATH}`);
  console.log('===============================================================');
});

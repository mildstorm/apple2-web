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

const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const DSK_PATH = path.join(__dirname, 'apple2-web.dsk');
const AC_TOOL = path.join(__dirname, 'ac_tool.py');

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

// 3. 새 파일 추가 / 수정 (BASIC 텍스트 또는 바이너리 Hex 저장)
app.post('/api/files', (req, res) => {
  let { filename, content, type, hex } = req.body;
  if (!filename) {
    return res.status(400).json({ error: '파일명이 필요합니다.' });
  }
  filename = filename.trim().toUpperCase().replace(/[^A-Z0-9_\-\.]/g, '');
  type = (type || 'A').toUpperCase();

  if (type === 'B' && hex) {
    // 바이너리 데이터 저장
    const tempFile = path.join(__dirname, `_temp_${Date.now()}.bin`);
    const buf = Buffer.from(hex, 'hex');
    fs.writeFileSync(tempFile, buf);

    exec(`python "${AC_TOOL}" put "${DSK_PATH}" "${filename}" B 0x0801 "${tempFile}"`, (err, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      if (err) {
        return res.status(500).json({ error: stderr || err.message });
      }
      res.json({ success: true, message: `바이너리 파일 '${filename}' (${buf.length} bytes) 저장 완료` });
    });
  } else {
    // BASIC 프로그램 저장
    content = content || '';
    const tempFile = path.join(__dirname, `_temp_${Date.now()}.bas`);
    fs.writeFileSync(tempFile, content, 'utf8');

    exec(`python "${AC_TOOL}" put-basic "${DSK_PATH}" "${filename}" "${tempFile}"`, (err, stdout, stderr) => {
      try { fs.unlinkSync(tempFile); } catch (e) {}
      if (err) {
        return res.status(500).json({ error: stderr || err.message });
      }
      res.json({ success: true, message: `Applesoft BASIC 파일 '${filename}' 저장 완료` });
    });
  }
});

// 4. 파일 삭제
app.delete('/api/files/:filename', (req, res) => {
  const filename = req.params.filename.toUpperCase();
  exec(`python "${AC_TOOL}" delete "${DSK_PATH}" "${filename}"`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, message: `파일 '${filename}' 삭제 완료` });
  });
});

// 5. 디스크 이미지 (.dsk) 통째로 다운로드
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

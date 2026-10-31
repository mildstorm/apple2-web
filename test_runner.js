/**
 * test_runner.js - Automated integration test for Apple2-Web bridge & server
 */

const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

console.log('[Test] Starting Apple2-Web Automated Verification...');

// 1. Mock AppleWin SSC listener on port 1977
let mockServer;
let serverProc;

function cleanup() {
  if (mockServer) {
    try { mockServer.close(); } catch(e) {}
  }
  if (serverProc) {
    try { serverProc.kill(); } catch(e) {}
  }
}

mockServer = net.createServer((sock) => {
  console.log('[Mock AppleWin] SSC TCP Connection Accepted on 1977!');

  sock.on('data', (buf) => {
    const text = buf.toString('ascii');
    if (text.includes('APPLE //e NODE.JS WEB BRIDGE')) {
      console.log('[PASS 1] Welcome banner received from bridge.');
      // Send HTTP GET request
      sock.write('GET /api/time HTTP/1.0\r\n\r\n');
    } else if (text.includes('SERVER TIME:')) {
      console.log('[PASS 2] HTTP GET /api/time response received.');
      // Send PING command
      sock.write('PING\r\n');
    } else if (text.includes('PONG!')) {
      console.log('[PASS 3] Interactive PING/PONG verified.');

      // Check Express HTTP server on 3000
      http.get('http://127.0.0.1:3000/api/status', (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const json = JSON.parse(body);
          if (json.status === 'online' && json.bridge.connected === true) {
            console.log('[PASS 4] HTTP /api/status verified. Bridge is connected.');
            console.log('\n=============================================');
            console.log(' ALL INTEGRATION TESTS PASSED (100% OK)     ');
            console.log('=============================================\n');
            cleanup();
            process.exit(0);
          } else {
            console.error('[FAIL] Unexpected status response:', body);
            cleanup();
            process.exit(1);
          }
        });
      }).on('error', (err) => {
        console.error('[FAIL] HTTP GET error:', err.message);
        cleanup();
        process.exit(1);
      });
    }
  });
});

mockServer.listen(1977, () => {
  console.log('[Mock AppleWin] Port 1977 listening. Spawning server.js...');
  serverProc = spawn('node', ['server.js'], { stdio: 'inherit' });

  serverProc.on('error', (err) => {
    console.error('[FAIL] Failed to spawn server.js:', err);
    cleanup();
    process.exit(1);
  });
});

setTimeout(() => {
  console.error('[TIMEOUT] Tests timed out after 10s.');
  cleanup();
  process.exit(1);
}, 10000);

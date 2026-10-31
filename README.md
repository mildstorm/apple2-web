# Apple II Super Serial Card to Node.js HTTP Server & Serial-to-TCP/IP Bridge

Apple II의 **Super Serial Card (SSC, Slot 2)**를 통해 Windows **Node.js HTTP 웹 서버**와 시리얼-TCP/IP 브릿지로 연동하여 실시간 양방향 통신 및 REST API 요청/응답을 수행하는 완전한 솔루션입니다.

---

## 1. 아키텍처 구성도 (Architecture)

```
+--------------------------+                         +-----------------------------------+
|      Apple II / AppleWin |                         |        Windows Node.js Server     |
|                          |                         |                                   |
|  +--------------------+  |                         |  +-----------------------------+  |
|  |   WEBCLIENT.BAS    |  |                         |  |   Serial-to-TCP Bridge      |  |
|  |  (Applesoft BASIC) |  |                         |  |   (bridge.js)               |  |
|  +---------+----------+  |                         |  +--------------+--------------+  |
|            |             |                         |                 |                 |
|  +---------v----------+  |   TCP Socket (1977)     |                 |                 |
|  | Super Serial Card  |  | <---------------------> |                 |                 |
|  | Slot 2 (ACIA 6551) |  |   (or Real COM Port)    |                 |                 |
|  +--------------------+  |                         |  +--------------v--------------+  |
+--------------------------+                         |  | Express HTTP & WebSocket    |  |
                                                     |  | Server (port 3000)          |  |
                                                     |  +--------------+--------------+  |
                                                     +-----------------|-----------------+
                                                                       |
                                                     +-----------------v-----------------+
                                                     | Modern Web Browser Dashboard      |
                                                     | (http://localhost:3000)           |
                                                     | - Live Chat / Serial Monitor      |
                                                     | - REST API Tester & Hardware Stats|
                                                     +-----------------------------------+
```

- **Apple II 클라이언트**: Super Serial Card(SSC)의 ACIA 6551 레지스터(`$C0A8..$C0AB`)를 직접 제어하여 논블로킹(Non-blocking)으로 키보드 입력과 시리얼 송수신을 동시에 처리합니다.
- **Node.js 서버 & 브릿지**:
  - **Serial-to-TCP 브릿지 (`bridge.js`)**: AppleWin 에뮬레이터의 SSC TCP 리스너(기본 포트 1977)에 자동 연결하며, 접속 끊김 시 자동 재연결(Auto-reconnect)을 지원합니다. 실제 하드웨어 COM 포트(`--serial COM1`) 연동도 지원합니다.
  - **Express HTTP 서버 (`server.js`)**: 포트 3000에서 웹 대시보드와 REST API(`/api/status`, `/api/time`, `/api/quote`, `/api/weather`, `/api/send`)를 호스팅합니다.
  - **WebSocket 서버**: 브라우저와 Apple II 간의 채팅 및 패킷 송수신을 실시간 스트리밍합니다.
- **부팅 가능한 디스크 (`apple2-web.dsk`)**: DOS 3.3 기반으로 부팅 시 `HELLO` 프로그램이 자동으로 `WEBCLIENT.BAS`를 로드하여 즉시 사용할 수 있습니다.

---

## 2. 주요 기능 (Features)

1. **실시간 양방향 채팅 (Live Terminal & Chat)**:
   - 웹 브라우저에서 텍스트를 입력하면 즉시 Apple II 화면에 표시됩니다.
   - Apple II에서 타이핑한 텍스트가 웹 브라우저 대시보드에 실시간으로 출력됩니다.
2. **Apple II에서 HTTP REST API 호출**:
   - `GET /api/time`: 서버의 현재 시각 동기화
   - `GET /api/quote`: 레트로 컴퓨터 명언 수신
   - `GET /api/weather`: 날씨 정보 수신
   - `GET /api/status`: 서버 가동 시간 및 브릿지 패킷 통계 조회
   - 커스텀 HTTP 요청 지원 (`GET <경로> HTTP/1.0`)
3. **AppleWin 완벽 호환**:
   - AppleWin의 내장 SSC TCP 포트(1977)와 즉시 연동됩니다.
4. **독립 실행형 통합 테스트 (`npm test`)**:
   - AppleWin을 켜지 않고도 모의 Apple II SSC 소켓을 띄워 브릿지와 HTTP 서버 통신을 자동으로 100% 검증합니다.

---

## 3. 설치 및 실행 방법 (Quick Start)

### 3.1 사전 요구사항
- **Node.js** (v16 이상 권장)
- **AppleWin** (Apple II 에뮬레이터)
- **Java** (DSK 이미지 빌드 시 AppleCommander 실행용, JRE/JDK 8 이상)

### 3.2 의존성 설치
```bash
npm install
```

### 3.3 통합 테스트 실행
Node.js 브릿지와 HTTP 서버의 동작을 사전에 검증합니다:
```bash
npm test
```

### 3.4 서버 시작
```bash
npm start
```
실행 시 기본적으로 다음과 같이 시작됩니다:
- **HTTP 웹 대시보드**: `http://localhost:3000`
- **TCP 브릿지 대상**: `127.0.0.1:1977` (AppleWin 기본 포트)

옵션 매개변수:
```bash
# 다른 HTTP 포트 또는 TCP 포트 지정
node server.js --http-port 8080 --tcp-port 1977

# 실제 물리/가상 시리얼 포트(COM3) 연결 모드
node server.js --mode serial --serial COM3 --baud 9600

# 외부 에뮬레이터나 클라이언트가 서버로 접속하도록 TCP 서버 모드로 실행
node server.js --mode tcp-server --tcp-port 1978
```

---

## 4. AppleWin 에뮬레이터 설정

1. **AppleWin**을 실행합니다.
2. 우측 메뉴의 **설정(Configuration / F2 또는 Alt+F4)** 아이콘을 클릭합니다.
3. **Slots** 또는 **Serial** 설정으로 이동합니다:
   - **Slot 2**: `Super Serial Card`로 선택
   - **Serial Port Name**: `TCP` (기본값 포트 1977로 수신 대기)
4. Drive 1에 `apple2-web.dsk` 디스크 이미지를 넣고 AppleWin을 재부팅(Reset / F2)합니다.
5. 화면에 부팅 배너가 출력되고 `WEBCLIENT.BAS` 메인 메뉴가 자동으로 실행됩니다!

---

## 5. Apple II 클라이언트 메뉴 가이드

`WEBCLIENT.BAS`가 시작되면 다음 메뉴가 표시됩니다:

```text
   APPLE //e WEB CLIENT & SERIAL BRIDGE
   ------------------------------------
    1. LIVE TERMINAL & CHAT
    2. GET SERVER TIME   (/api/time)
    3. GET RETRO QUOTE   (/api/quote)
    4. GET WEATHER       (/api/weather)
    5. GET SERVER STATUS (/api/status)
    6. CUSTOM HTTP REQUEST
    7. PING TEST
    8. EXIT TO BASIC

   SELECT OPTION (1-8):
```

- **1. LIVE TERMINAL & CHAT**: 웹 브라우저 대시보드와 실시간 양방향 채팅을 진행합니다. 종료하려면 `[ESC]` 키를 누릅니다.
- **2. GET SERVER TIME**: 서버로 `GET /api/time HTTP/1.0`을 전송하고 수신된 응답을 화면에 표시합니다.
- **3. GET RETRO QUOTE**: 레트로 명언을 수신합니다.
- **4. GET WEATHER**: 날씨 정보를 수신합니다.
- **5. GET SERVER STATUS**: 서버 및 브릿지의 가동 시간과 패킷 카운터를 확인합니다.
- **6. CUSTOM HTTP REQUEST**: 사용자가 직접 경로를 입력하여 원하는 엔드포인트로 HTTP 요청을 보냅니다.
- **7. PING TEST**: 브릿지와의 통신 지연시간 및 정상 연결 상태를 확인합니다.

---

## 6. REST API 명세

| Method | Endpoint | 설명 | 반환 예시 |
|--------|----------|------|-----------|
| `GET` | `/api/status` | 서버 및 브릿지 연결 상태, 패킷 통계 | `{"status":"online","bridge":{"connected":true...}}` |
| `GET` | `/api/time` | 현재 서버 시간 | `SERVER TIME: 2026. 10. 31. 오후 8:49:39` |
| `GET` | `/api/quote` | 레트로 컴퓨팅 명언 | `"Never trust a computer you can't throw out a window."` |
| `GET` | `/api/weather` | 날씨 정보 | `LOCATION: Cupertino, CA | TEMP: 21C / 70F...` |
| `POST` | `/api/send` | 브라우저/외부에서 Apple II로 텍스트 전송 | `{"message": "Hello Apple II!"}` |
| `GET` | `/api/history` | 최근 통신 로그 내역 조회 | `{"history": [...]}` |

---

## 7. DSK 이미지 재빌드

코드를 수정했거나 새로운 BASIC 코드를 디스크에 다시 패키징하려면:
```bash
npm run build:dsk
# 또는
python build_dsk.py
```
- `ac_tool.py`가 프로젝트 내 `tools/AppleCommander.jar` 또는 시스템 환경 설정을 자동으로 감지하여 `apple2-web.dsk`를 생성합니다.
- 개인 환경 경로가 전혀 하드코딩되어 있지 않으므로 어떤 환경에서도 즉시 빌드됩니다.

---

## 8. 디렉토리 구조

```
~/apple2-web/
├── server.js              # Express 웹 서버 & WebSocket 실시간 통신 서버
├── bridge.js              # Super Serial Card Serial-to-TCP/IP 브릿지 엔진
├── test_runner.js         # 자동화된 통합 테스트 스크립트 (npm test)
├── build_dsk.py           # Apple II DOS 3.3 부팅 디스크 생성 스크립트
├── ac_tool.py             # 범용 AppleCommander 디스크 관리 유틸리티
├── apple2-web.dsk         # 부팅 가능한 Apple II 디스크 이미지
├── package.json           # Node.js 프로젝트 설정 및 의존성
├── public/
│   └── index.html         # 웹 대시보드 (반응형 레트로 터미널 & REST API 테스터)
├── apple2/
│   ├── HELLO.BAS          # 부팅 시 자동 실행되는 Applesoft BASIC 코드
│   ├── WEBCLIENT.BAS      # 대화형 Apple II 웹 클라이언트 Applesoft BASIC 코드
│   └── webclient.s        # 6502 어셈블리 고속 터미널 클라이언트 소스
└── tools/
    ├── AppleCommander.jar # 디스크 조작용 AppleCommander JAR
    └── dos33_template.dsk # DOS 3.3 표준 템플릿 디스크
```

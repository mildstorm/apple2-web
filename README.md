# Apple II Web - DOS 3.3 Disk File Manager, Hex Editor & 6502 Disassembler

[![Platform](https://img.shields.io/badge/Platform-Apple%20II%20%2F%20%2F%2Fe-brightgreen)](https://github.com/mildstorm/apple2-web)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**apple2-web**은 모던 웹 브라우저(`http://localhost:3000`)에서 Apple II DOS 3.3 디스크 이미지(`.dsk`) 내의 파일들을 실시간으로 열람, 편집, 주입, 삭제할 수 있는 **Apple II 전용 웹 파일 매니저, 인터랙티브 3단 Hex 에디터 및 6502/65C02 디스어셈블러**입니다. 또한 AppleWin 에뮬레이터(또는 실기)와의 Super Serial Card (SSC) 통신 브릿지도 함께 제공합니다.

---

## 📸 주요 기능 (Key Features)

### 1. 📁 Apple II DOS 3.3 디스크 파일 매니저
* `apple2-web.dsk` 디스크 이미지를 실시간으로 분석하여 디스크 내의 모든 파일 목록을 조회합니다.
* **파일 형식 지원**:
  * `[A]` **Applesoft BASIC**: 텍스트 코드를 Apple II 내부 토큰 바이트 및 메모리 링크드 리스트 포인터(`$0801`)로 자동 컴파일/토큰화하여 디스크에 저장
  * `[B]` **Binary**: 6502 기계어 실행 파일, 폰트, 메모리 덤프 바이너리 데이터 직접 조작
  * `[I]` **Integer BASIC**: 정수 베이직 프로그램 조회 지원
* **디스크 조작**: 신규 파일 추가, 기존 파일 수정, 파일 삭제, 디스크 이미지(`.dsk`) 원클릭 다운로드 지원

### 2. 📊 인터랙티브 3단 Hex Editor
* **3단 분리 레이아웃**:
  * **Offset Column**: `$000000`, `$000010` 등 16바이트 단위 오프셋
  * **Hex Data Column**: 16바이트 16진수 셀 (8바이트 간격 구분 분리)
  * **Decoded Text Column**: 우측 대응 ASCII 문자 (비출력 제어문자는 `.` 표시)
* **실시간 양방향 동기화**:
  * Hex 셀을 클릭하고 키보드로 16진수(`0-9`, `A-F`)를 타이핑하면 상위/하위 니블이 즉시 반영되며, **우측 문자(ASCII)도 실시간으로 동시 변경**됩니다.
  * 2자리 Hex 입력 완료 시 **자동으로 다음 바이트로 커서 이동**.
  * **방향키(`←`, `→`, `↑`, `↓`)**로 바이트 간 자유로운 탐색 지원.
* **디스크에 직접 저장**: 수정된 바이너리 데이터를 `apple2-web.dsk`의 지정 번지(`$0801` 등)에 바이너리 파일(`[B]`)로 즉시 기록.

### 3. ⚙️ 고속 6502 / 65C02 CPU Disassembler
* 별도의 무거운 에뮬레이터 C++ 코드에 의존하지 않는 독립형 고속 순수 자바스크립트 6502/65C02 역어셈블러 내장.
* **4단 디스어셈블리 테이블**:
  * **Address**: 기준 메모리 주소 (기본 `$0800`, 원하는 번지로 변경 가능)
  * **Hex Bytes**: 명령어 기계어 바이트 (`20 58 FC`, `A9 41` 등)
  * **Instruction**: 6502/65C02 니모닉 및 피연산자 (`JSR $FC58`, `LDA #$41`, `BNE $0820` 등)
  * **Comments / ROM Symbols**: **Apple II 모니터 롬 심볼 자동 주석**
    * 예: `$FC58` → `; HOME (화면 지우기 & 커서 좌상단)`
    * 예: `$FDED` → `; COUT (Acc 문자를 화면에 출력)`
    * 예: `$FD0C` → `; RDKEY (커서 깜빡이며 키 입력 대기)`
    * 예: `$C000` / `$C030` → `; KBD (키보드 래치)` / `; SPKR (스피커 클릭)`
    * 분기 명령어(`BNE`, `BEQ` 등)의 분기 대상 목표 주소 자동 계산
* **Hex Editor와의 유기적 연동**:
  * 디스어셈블리 목록의 특정 행을 클릭하면 **자동으로 Hex Editor 탭으로 전환되며 해당 바이트 오프셋으로 즉시 포커스 이동**.
  * 상단 주소 검색창(`$FDED` 등)으로 특정 주소 즉시 탐색 지원.

### 4. 🛡️ 실기 및 에뮬레이터 데이터 손상 방지 안전 장치 (Safety & Reliability)
* **자동 스냅샷 백업 & 원클릭 롤백**:
  * 파일 저장/수정/삭제 시 직전 디스크 상태를 `backups/` 폴더에 타임스탬프 스냅샷으로 자동 보존합니다 (최신 15개 보관).
  * 웹 UI의 **`[🛡️ 스냅샷 & 복원]`** 메뉴에서 언제든지 원하는 과거 시점으로 원클릭 롤백할 수 있습니다.
* **디스크 뮤텍스 동시성 락 (Concurrency Mutex)**:
  * 웹 요청이 동시에 들어와 디스크 VTOC(섹터 할당 테이블)가 꼬이는 문제를 방지하기 위해 순차 대기 큐(Queue) 처리.
* **Applesoft BASIC 파일 I/O 안전 검사 (CLOSE 누락 방지)**:
  * BASIC 소스 내 `OPEN` 명령 사용 시 `CLOSE`가 누락되었는지 자동 검사하여, 실기에서 파일 미닫힘으로 인한 디스크 오염을 방지하도록 경고 표시.
* **실시간 Apple II 갱신 알림 브로드캐스트**:
  * SSC 브릿지를 통해 디스크 갱신 시 Apple II 콘솔에 알림을 전송하여 즉각적인 `CATALOG` 또는 리셋을 유도.

### 5. 🔌 Apple //e Super Serial Card (SSC) 브릿지
* AppleWin의 SSC TCP 소켓(기본 포트 1977) 또는 실제 물리 시리얼 COM 포트와 연결.
* Apple II 콘솔과 웹 브라우저 간의 실시간 양방향 채팅 및 HTTP REST API 통신 지원.

---

## 🏛️ 시스템 아키텍처 (Architecture)

```
+-----------------------------------+             +----------------------------------+
|    Apple II / AppleWin Emulator   |             |       Node.js Backend Server     |
|                                   |             |                                  |
|   +---------------------------+   |             |   +--------------------------+   |
|   | apple2-web.dsk            |   |             |   | Express Server (3000)    |   |
|   | - HELLO (Boot Welcome)    |   |             |   | - REST API /api/files    |   |
|   | - WEBCLIENT (Terminal)    |   |             |   | - Static Web Dashboard   |   |
|   | - FPBASIC, INTBASIC...    |   |             |   +------------+-------------+   |
|   +-------------+-------------+   |                          |                     |
|                 |                 |             +------------v-------------+       |
|   +-------------v-------------+   | Disk File   | Python AC-Tool &         |       |
|   | DOS 3.3 Disk Engine       | <-+-------------+ AppleCommander Engine    |       |
|   | (Real-time File Access)   |   |             | (Tokenize & Put/Export)  |       |
|   +---------------------------+   |             +--------------------------+       |
+-----------------------------------+                                                |
                                                                                     |
                                                  +----------------------------------v---+
                                                  | Modern Web Client (Browser)          |
                                                  | (http://localhost:3000)              |
                                                  | ------------------------------------ |
                                                  | 📁 DOS 3.3 Catalog File List         |
                                                  | 📝 Applesoft BASIC Code Editor       |
                                                  | 📊 3-Column Interactive Hex Editor   |
                                                  | ⚙️ 6502/65C02 Real-time Disassembler |
                                                  +--------------------------------------+
```

---

## 🚀 빠른 시작 (Quick Start)

### 1. 사전 요구사항
* **Node.js** (v18 이상 권장)
* **Python 3.x**
* **Java (JRE/JDK 8 이상)**: AppleCommander를 통한 DSK 조작용
* **AppleWin** (Apple //e 에뮬레이터, 선택 사항)

### 2. 저장소 복제 및 의존성 설치
```bash
git clone https://github.com/mildstorm/apple2-web.git
cd apple2-web
npm install
```

### 3. 서버 실행
```bash
npm start
```
서버가 기동되면 웹 브라우저에서 아래 주소로 접속합니다:
👉 **http://localhost:3000**

---

## 💻 사용 가이드 (How to Use)

### 1. Applesoft BASIC 파일 편집 (`[A]`)
1. 좌측 파일 목록에서 `HELLO`, `WEBCLIENT` 등 `[A]` 태그 파일을 클릭합니다.
2. 우측 텍스트 에디터에 BASIC 소스 코드가 나타납니다.
3. 원하는 위치에 엔터를 누르고 줄 번호와 함께 코드를 추가합니다:
   ```basic
   10 TEXT : HOME
   20 PRINT "HELLO WORLD FROM APPLE //e!"
   25 PRINT "NEW LINE ADDED FROM WEB!"
   30 END
   ```
4. **`[💾 디스크에 저장]`**을 클릭하면, 파이썬 토크나이저가 키워드 토큰화 및 메모리 주소 링크를 생성하여 `apple2-web.dsk`에 직접 저장합니다.

### 2. 바이너리 파일 편집 & 6502 역어셈블러 (`[B]`)
1. 좌측 파일 목록에서 `FPBASIC`, `INTBASIC`, `BOOT13` 등 `[B]` 태그 파일을 클릭합니다.
2. **Hex Editor**:
   * 마우스로 변경하고자 하는 바이트 셀을 클릭합니다.
   * 키보드로 `0-9`, `A-F`를 타이핑하면 즉시 바이트와 우측 ASCII 문자가 변경됩니다.
   * 방향키로 인접 바이트를 이동할 수 있습니다.
3. **6502 Disassembly**:
   * 우측 상단의 **`[ ⚙️ 6502 Disassembly ]`** 탭을 클릭합니다.
   * 6502 기계어가 디스어셈블되어 명령어 및 Apple II ROM 심볼 주석(`COUT`, `HOME`, `RDKEY` 등)과 함께 나타납니다.
   * 특정 명령어를 클릭하면 Hex Editor의 해당 바이트 위치로 즉시 점프합니다.
   * 시작 번지(`$0800` 등)를 변경하면 주소 및 분기점 계산이 실시간 재계산됩니다.
4. **`[💾 디스크에 저장]`**을 클릭하면 수정된 바이너리가 디스크에 즉시 반영됩니다.

### 3. AppleWin 에뮬레이터에서 결과 확인
1. AppleWin 에뮬레이터 드라이브 1에 `apple2-web.dsk`를 마운트합니다.
2. AppleWin에서 **`F2`** (또는 `Ctrl + F2`)를 눌러 부팅합니다.
3. 프롬프트(`]`)에서 **`CATALOG`**를 입력하면 웹에서 추가/수정한 파일들이 모두 나타납니다.
4. `RUN 파일명` 또는 `BRUN 파일명`으로 에뮬레이터에서 즉시 실행해 볼 수 있습니다.

---

## 📡 REST API 명세 (API Endpoints)

| 메소드 | 엔드포인트 | 설명 |
| :--- | :--- | :--- |
| `GET` | `/api/files` | `apple2-web.dsk` 디스크 내의 전체 파일 목록 조회 (JSON) |
| `GET` | `/api/files/:filename` | 특정 BASIC 파일의 텍스트 소스 코드 추출 |
| `GET` | `/api/files/:filename?type=B` | 특정 바이너리 파일의 Raw Hex 데이터 추출 |
| `POST` | `/api/files` | BASIC 소스 토큰화 저장 또는 바이너리 Hex 저장 (뮤텍스 & 자동 백업) |
| `DELETE` | `/api/files/:filename` | 디스크에서 특정 파일 삭제 (자동 백업) |
| `GET` | `/api/backups` | 디스크 스냅샷 백업 목록 조회 (최신 15개) |
| `POST` | `/api/backups/rollback` | 특정 스냅샷 시점으로 디스크 안전 롤백(복원) |
| `POST` | `/api/backups/create` | 수동 디스크 체크포인트 스냅샷 생성 |
| `GET` | `/api/download/dsk` | 수정된 `apple2-web.dsk` 디스크 이미지 파일 다운로드 |

---

## 🔌 Apple II 실기 하드웨어 연결 가이드 (Real Hardware Setup)

Apple II 실기의 **Super Serial Card (Slot 2)**와 PC를 통신 브릿지로 연결할 때는 다음 두 가지 방법 중 하나를 선택할 수 있습니다.

### 방법 1. 유선 연결 (USB to RS-232 시리얼 + 널 모뎀 케이블)
```
[Apple II 실기 SSC (DB-25)] ──> [DB25/DB9 널 모뎀(Null Modem) 케이블] ──> [USB-RS232 컨버터(FTDI)] ──> [PC USB 포트]
```
1. **필요 부품**:
   * FTDI 칩셋 기반 USB to RS-232 시리얼 변환 케이블
   * DB9 to DB25 **널 모뎀(Null Modem / TX-RX 교차) 케이블** (또는 크로스 젠더)
2. **SSC 카드 점퍼 설정**:
   * SSC 카드 가운데 점퍼 블록의 화살표를 **`TERMINAL`** 방향으로 꽂고 널 모뎀 케이블을 연결합니다.
3. **서버 실행 명령**:
   ```bash
   node server.js --mode serial --serial COM3 --baud 9600
   ```

### 방법 2. 무선 연결 (레트로 Wi-Fi 모뎀)
```
[Apple II 실기 SSC (DB-25)] ──> [RetroWiFiModem / WiModem232 (ESP8266)] ──> 📶 [가정용 Wi-Fi] ──> [PC Node.js 서버]
```
1. Apple II 뒷면 DB-25 포트에 **RetroWiFiModem** 또는 **WiModem232** 동글을 직접 꽂습니다.
2. 모뎀 설정에서 홈 Wi-Fi에 연결한 후, PC의 Node.js `bridge.js`에서 모뎀의 IP와 포트로 TCP 소켓을 연결하면 케이블 없이 무선으로 실기와 PC가 실시간 연동됩니다.

---

## 📂 프로젝트 구조 (Directory Structure)

```
apple2-web/
├── backups/               # 디스크 자동 스냅샷 백업 저장소 (롤백용 타임스탬프 .dsk)
├── apple2/
│   ├── HELLO.BAS          # DOS 3.3 기본 부팅 환영 프로그램 소스
│   └── WEBCLIENT.BAS      # Apple II SSC 웹 클라이언트 & 브릿지 소스
├── public/
│   └── index.html         # 레트로 CRT 테마 웹 대시보드, Hex Editor & 6502 Disassembler
├── tools/
│   ├── AppleCommander.jar # AppleCommander DOS 3.3 디스크 처리 엔진
│   └── dos33_template.dsk # 초기 DOS 3.3 기본 디스크 템플릿
├── ac_tool.py             # AppleCommander CLI 래퍼 (json, get, put, put-basic, delete)
├── build_dsk.py           # Applesoft BASIC 토크나이저 및 DSK 이미지 빌더
├── bridge.js              # Apple II SSC <-> TCP/시리얼 브릿지 모듈
├── server.js              # Express HTTP 서버, DOS 3.3 파일 관리, 디스크 뮤텍스 & 롤백 API
├── apple2-web.dsk         # 부팅 가능한 실시간 Apple II DOS 3.3 디스크 이미지
├── package.json           # Node.js 프로젝트 설정 및 의존성
└── README.md              # 프로젝트 안내 문서
```

---

## 📄 라이선스 (License)

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

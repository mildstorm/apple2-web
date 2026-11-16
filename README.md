# Apple II Web - DOS 3.3 디스크 관리 · 원격 키보드 · 메모리 진단

[![Platform](https://img.shields.io/badge/Platform-Apple%20II%2B%20%2F%20%2F%2Fe-brightgreen)](https://github.com/mildstorm/apple2-web)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**apple2-web**은 웹 브라우저(`http://localhost:3000`)에서 Apple II를 다루는 도구입니다. 두 가지 일을 합니다.

1. **PC의 디스크 이미지 작업**: DOS 3.3 디스크 이미지(`.dsk`)의 파일을 보고, 고치고, 넣고, 지웁니다. Applesoft BASIC 편집기, 3단 Hex Editor, 6502/65C02 디스어셈블러가 들어 있습니다.
2. **Super Serial Card(SSC)로 Apple II 원격 제어**: 실기(키보드가 고장 난 기계 포함)나 STM32 Apple //e 에뮬레이터를 SSC로 연결해 다음을 합니다.
   * 웹에서 명령을 **타이핑**합니다.
   * 드라이브의 **디스켓 내용을 읽어** 봅니다.
   * **메모리/ROM을 덤프**해 PC 파일로 받습니다.
   * **RAM·ROM 상태를 진단**합니다.

---

## 🧭 한눈에 보기 (What it does)

| 분류 | 기능 | 대상 |
| :--- | :--- | :--- |
| 📁 디스크 이미지 | DOS 3.3 카탈로그, 파일 추가·수정·삭제, `.dsk` 다운로드 | PC의 `apple2-web.dsk` |
| 📝 편집 | Applesoft BASIC 텍스트 ↔ 토큰 자동 변환, `OPEN`/`CLOSE` 누락 검사 | 로컬 디스크 |
| 📊 분석 | 3단 Hex Editor, 6502/65C02 디스어셈블러(ROM 심볼 주석, 분기 계산) | 파일·디스크·메모리 덤프 |
| 🛡️ 안전 | 저장 전 자동 스냅샷(15개) + 원클릭 롤백, 디스크 작업 순차 처리 | 로컬 디스크 |
| ⌨️ 원격 키보드 | 웹 입력을 SSC로 Apple에 타이핑 (`CATALOG`, `RUN`, BASIC 줄, `SAVE` …), Ctrl-C/RETURN/ESC, 여러 줄 붙여넣기 | 실기 / STM32 / AppleWin |
| 📡 디스켓 보기 | Apple 드라이브 1을 SSC로 읽어 파일 목록·BASIC·Hex·디스어셈블리로 보기 (DOS 없이 니블 단위로 읽음) | 실기 / STM32 |
| 🧪 메모리 덤프 | 주소 범위의 RAM·ROM·Language Card·//e 내부 ROM을 `.bin` 파일로 | 실기 / STM32 |
| 🩺 진단 | 기종 판별, 주 메모리·LC RAM 검사(내용 보존), ROM CRC32(칩 단위) | 실기 / STM32 |
| 💽 디스켓 갱신 | 디스켓의 A2SRV를 최신으로 (실기 자신의 DOS로 `BSAVE`, 디스켓 기록 장치 불필요) | 실기 / STM32 |
| 🔒 보안 | 기본 127.0.0.1 전용, DNS rebinding·CSRF 차단 | 서버 |

---

## 📸 주요 기능 (Key Features)

### A. PC의 디스크 이미지 작업

#### 1. 📁 Apple II DOS 3.3 디스크 파일 매니저
* `apple2-web.dsk` 디스크 이미지를 분석해 파일 목록을 보여 줍니다. 공백·제어문자가 들어간 DOS 이름(`GUN SOUND.OBJ`, `I^ANIT` 등)도 그대로 다룹니다.
* **파일 형식**:
  * `[A]` **Applesoft BASIC**: 텍스트 소스를 Apple II 토큰과 줄 연결 포인터(`$0801`)로 변환해 저장
  * `[B]` **Binary**: 6502 기계어, 폰트, 메모리 덤프 등 바이너리를 직접 편집
  * `[I]` **Integer BASIC**: 조회
* **디스크 조작**: 새 파일 추가, 수정, 삭제, `.dsk` 원클릭 다운로드

#### 2. 📊 인터랙티브 3단 Hex Editor
* **Offset / Hex / ASCII** 3단 배치(16바이트씩, 8바이트마다 구분).
* Hex 셀을 클릭하고 `0-9`, `A-F` 를 치면 바로 바뀌고 ASCII도 같이 바뀝니다. 두 자리를 치면 다음 바이트로, 방향키로 이동합니다.
* 수정한 바이너리를 디스크에 `[B]` 파일로 저장합니다.

#### 3. ⚙️ 6502 / 65C02 Disassembler
* 순수 JavaScript로 된 6502/65C02 역어셈블러입니다.
* **Address / Hex Bytes / Instruction / Comments** 4단 표시. 기준 주소를 바꿀 수 있습니다(기본 `$0800`, 메모리 덤프는 덤프 시작 주소).
* **Apple II ROM 심볼 자동 주석**: `$FC58` HOME, `$FDED` COUT, `$FD0C` RDKEY, `$C000` KBD, `$C030` SPKR 등. 분기 명령의 목표 주소도 계산해 줍니다.
* 줄을 누르면 Hex Editor의 해당 바이트로 이동하고, 주소 검색(`$FDED` 등)으로 바로 찾아갑니다.

#### 4. 🛡️ 데이터 손상 방지
* **자동 스냅샷 & 롤백**: 저장·삭제 직전 상태를 `backups/` 에 보존(최신 15개)하고, `[🛡️ 스냅샷 & 복원]` 에서 원하는 시점으로 되돌립니다.
* **디스크 작업 순차 처리**: 동시에 들어온 요청이 VTOC(섹터 할당표)를 망가뜨리지 않게 줄 세워 처리합니다.
* **BASIC 파일 I/O 검사**: `OPEN` 후 `CLOSE` 가 없으면 경고합니다(실기에서 파일이 안 닫혀 디스크가 상하는 것 방지).

### B. Super Serial Card로 Apple II 원격 제어

키보드가 고장 난 실기를 위해 만든 기능입니다. 실기를 **`A2REMOTE.DSK`** 로 부팅하면 HELLO가 `IN#2` 를 실행해 SSC(슬롯 2)가 키보드가 됩니다. 이후 모든 일은 SSC 하나로 합니다. STM32 Apple //e 에뮬레이터에서도 같은 디스크로 똑같이 동작합니다.

#### 5. ⌨️ 원격 키보드
* 웹 상단 `⌨️ Apple 키보드` 칸에 입력하고 Enter를 누르면 SSC로 Apple에 그대로 타이핑됩니다. 예: `CATALOG`, `RUN SHOOTING`, `10 PRINT "HI"`, `SAVE MYPROG`, `PR#6`(재부팅).
* `Ctrl-C` / `RETURN` / `ESC` 버튼, `여러 줄…` 붙여넣기(BASIC 프로그램 입력), 대문자 자동 변환, 최근 입력 기록.
* Apple 화면 결과는 돌려받지 않습니다. 결과는 디스켓 읽기로 확인합니다(예: `SAVE` 후 목록 갱신).

#### 6. 📡 Apple 디스켓 보기
* `[📡 Apple에서 읽기]`: 서버가 `BRUN A2SRV` 를 입력해 Apple 안의 작은 6502 섹터 서버(A2SRV)를 띄우고, 드라이브 1을 읽어 `remote/drive1.dsk` 로 저장합니다. 끝나면 A2SRV를 내려 `]` 프롬프트로 돌려 놓습니다.
* 디스크 선택을 `Apple II 드라이브 1` 로 바꾸면 PC 디스크와 똑같이 파일 목록·BASIC 소스·Hex·디스어셈블리로 봅니다(읽기 전용).
* A2SRV는 DOS를 거치지 않고 Disk II를 **니블 단위로 직접** 읽습니다. 그래서 DOS가 없는 디스크도 읽힙니다. PC가 4&4/6&2 디코딩과 체크섬 검사를 합니다.
* 기본으로 **VTOC에서 사용 중인 트랙만** 읽습니다. A2REMOTE.DSK는 6트랙으로, 실기 9600bps 약 40초, STM32 약 7초입니다. `35트랙 전체` 옵션도 있습니다.
* 디스켓을 바꿔 넣고 다시 읽으면 그 디스켓이 보입니다. A2SRV가 없는 디스켓이면 SSC로 A2SRV를 보내 실행합니다.
* 끝나면 헤드를 DOS가 기억하는 위치(`$047E`)로 되돌려 놓습니다. 그래서 읽은 뒤에도 DOS를 그대로 쓸 수 있습니다.

#### 7. 🧪 메모리 / ROM 덤프 → PC 파일
* `[🧪 메모리/진단]` 창에서 주소 범위와 맵을 고르면 Apple 메모리를 `remote/dumps/*.bin` 으로 받습니다. 맵: ROM / 현재 매핑 / Language Card RAM bank 1·2 / //e 내부 `$C100-$CFFF` ROM.
* 빠른 선택: ROM `$D000-$FFFF`, 모니터 ROM `$F800-$FFFF`, //e CX ROM, 슬롯 6 ROM, RAM 48K.
* 받은 덤프는 `보기` 로 Hex Editor·디스어셈블러에서 바로 엽니다.
* 체크섬으로 전송을 검증합니다. `$C000-$C0FF`(I/O)는 읽으면 장치가 반응하므로 읽지 않습니다.

#### 8. 🩺 메모리 진단 (Diagnostics)
* **기종 판별**: ROM ID 바이트로 ][ / ][+ / //e / //e Enhanced / //c 를 구분합니다.
* **RAM 검사**: 주 메모리 `$0200-$BFFF` 와 Language Card RAM을 4KB씩 백업 → 패턴 4가지 쓰기/확인 → 복원합니다. **메모리 내용이 보존**되므로 진단 후에도 DOS와 BASIC 프로그램이 그대로 남습니다. 고정 비트와 주소선 고장을 찾아 **주소, 불량 데이터 비트, 16KB 뱅크**를 알려 줍니다(불량 RAM 칩 찾기).
* **ROM 검사**: `$D000-$FFFF` CRC32를 전체, 2KB 칩 단위(][/][+), 8KB 단위(//e)로 보여 주고 덤프 파일도 남깁니다. 정상 ROM과 비교해 ROM 칩 불량을 찾습니다.

#### 9. 💽 디스켓의 A2SRV 최신화
* 디스켓 기록 장치 없이, 실기 자신의 DOS로 디스켓의 A2SRV를 최신 버전으로 덮어씁니다(`UNLOCK` → `BSAVE` → `LOCK`).
* 그다음 다시 읽어 바이트 단위로 확인합니다. 다른 DOS 3.3 디스켓에 A2SRV를 넣을 때도 씁니다.

#### 10. 🔌 연결 방식
| 대상 | 연결 | 실행 |
| :--- | :--- | :--- |
| Apple II 실기 | SSC ─ 널 모뎀 케이블 ─ USB-RS232 ─ PC COM 포트 (Python 릴레이) | `node server.js --serial COM12 --baud 9600` |
| STM32F769I-DISCO Apple //e 에뮬레이터 | RJ45 직결, 보드 TCP 6502 = SSC | `npm run start:stm32` |
| AppleWin | SSC TCP 소켓 1977 | `npm start` |

### C. 🔒 보안
* 서버는 기본으로 **이 PC(127.0.0.1)에서만** 열립니다. 로그인이 없고 원격 키보드는 Apple에 무엇이든 입력할 수 있기 때문입니다. 다른 기기에서 쓰려면 `--listen 0.0.0.0` 을 명시합니다.
* Host 헤더가 localhost가 아닌 요청(DNS rebinding)과 다른 웹사이트에서 온 POST/DELETE(CSRF)를 거절합니다.
* 오류 응답에 스택 트레이스나 PC 경로를 내보내지 않습니다.

### ⚠️ 알려진 제약
* **Ctrl-C**: Applesoft는 실행 중인 프로그램을 멈출 때 키보드 하드웨어(`$C000`)를 직접 봅니다. 그래서 원격 Ctrl-C는 프로그램이 입력을 기다릴 때만 통합니다. Control-Reset은 시리얼로 보낼 수 없습니다.
* **화면 미반환**: Apple 화면을 웹으로 돌려받지 않습니다. `CATALOG` 가 한 화면을 넘어 키를 기다리면 `RETURN` 을 눌러 줍니다.
* **첫 디스켓 만들기**: 키보드가 안 되면 ADTPro처럼 Apple 쪽에서 명령을 쳐야 하는 도구는 못 씁니다. Floppy Emu 같은 디스크 에뮬레이터나 PC용 플로피 기록 장치(Greaseweazle, Applesauce)로 `a2remote.dsk` 를 처음 한 번 준비해야 합니다.
* **검사 범위**: //e 보조 64KB(80컬럼 카드)는 진단하지 않습니다. RAM 검사는 4KB 블록 단위라 블록끼리 겹치는 주소선 고장은 못 찾습니다.
* **//c 미지원**: SSC 슬롯이 없는 //c(내장 시리얼 포트)는 시험하지 않았습니다.
* **실기 미시험**: STM32 에뮬레이터에서 모두 확인했지만 실기에서는 아직 시험 전입니다. 글자가 빠지면 `remote_disk.js` 의 입력 간격(실기: 글자 2ms, 줄 400ms)을 늘리세요.

---

## 🏛️ 시스템 아키텍처 (Architecture)

```
 브라우저 (http://localhost:3000)
 ┌──────────────────────────────────────────────────────────────┐
 │ 📁 파일 목록  📝 BASIC  📊 Hex  ⚙️ 6502 Disasm                │
 │ 💽 디스크 선택(로컬 / Apple 드라이브 1)  ⌨️ 원격 키보드        │
 │ 🧪 메모리 덤프 · 진단 · 디스켓 A2SRV 갱신                      │
 └───────────────────────────┬──────────────────────────────────┘
                             │ REST (127.0.0.1)
 Node.js server.js ──────────┴───────────────────────────────────────────┐
 │  /api/files ── ac_tool.py ── AppleCommander ── apple2-web.dsk (로컬)    │
 │                                            └── remote/drive1.dsk (사본) │
 │  /api/remote/* ── remote_disk.js (타이핑, A2SRV 실행, 4&4/6&2 디코딩,   │
 │                   메모리 덤프, RAM 검사)                                │
 │                       │ bridge.js (TCP 바이트 스트림)                   │
 └───────────────────────┼─────────────────────────────────────────────────┘
          ┌──────────────┼──────────────────────┬─────────────────────┐
          ▼              ▼                      ▼                     ▼
  tools/com_relay.py  STM32 보드 TCP 6502   AppleWin TCP 1977     (Wi-Fi 모뎀 등)
  (pyserial) ─ COMx      │                      │
          │              ▼                      ▼
          ▼        에뮬레이터 //e SSC      AppleWin SSC
   실기 Apple II SSC (슬롯 2)
          │  A2REMOTE.DSK 부팅: HELLO → IN#2 (SSC = 키보드)
          │  A2SRV ($6000): Disk II 니블 읽기 / 메모리 덤프 / RAM 검사
          ▼
   Disk II (슬롯 6, 드라이브 1)
```

---
## 🚀 빠른 시작 (Quick Start)

### 1. 사전 요구사항
* **Node.js** (v18 이상 권장)
* **Python 3.x**
* **Java (JRE/JDK 8 이상)**: AppleCommander를 통한 DSK 조작용
* **AppleWin** (Apple //e 에뮬레이터, 선택 사항)
* **pyserial** (실기를 COM 포트로 연결할 때만): `python -m pip install pyserial`
* **xa** 6502 어셈블러 (A2SRV를 고칠 때만, MSYS2 `pacman -S mingw-w64-ucrt-x86_64-xa`)

### 2. 저장소 복제 및 의존성 설치
```bash
git clone https://github.com/mildstorm/apple2-web.git
cd apple2-web
npm install
```

### 3. 서버 실행
연결할 Apple에 따라 실행 방법을 고릅니다.

| 대상 | 실행 명령 | SSC 연결 |
| :--- | :--- | :--- |
| AppleWin (기본) | `npm start` | `127.0.0.1:1977` |
| STM32 에뮬레이터 | `npm run start:stm32` | 보드 `169.254.246.139:6502` (RJ45 직결) |
| Apple II 실기 | `node server.js --serial COM12 --baud 9600` | USB-RS232 + 널 모뎀 → SSC 슬롯 2 |

서버가 기동되면 웹 브라우저에서 아래 주소로 접속합니다:
👉 **http://localhost:3000**

> 🔒 **보안**: 이 서버에는 로그인이 없고, 웹 키보드는 Apple에 무엇이든 입력할 수 있습니다 (`INIT`, `DELETE` 등). 그래서 기본으로 **이 PC(127.0.0.1)에서만** 열립니다.
> * 다른 기기(같은 집 네트워크, Tailscale 등)에서 접속하려면 `--listen 0.0.0.0` (또는 `--listen <그 인터페이스 주소>`)을 명시하세요. 이때는 신뢰하는 네트워크에서만 쓰고, PC가 공유기 없이 공인 IP를 직접 받는 환경이면 Windows 방화벽에서 Node.js의 **공용(Public)** 수신 허용을 꺼 두세요.
> * Host 헤더가 localhost가 아닌 요청(DNS rebinding)과, 다른 웹사이트에서 보낸 POST/DELETE(CSRF)는 거절합니다.

### 4. 키보드 없는 실기를 웹으로 쓰기 (요약)
1. `npm run build:remote-dsk` 로 만든 `a2remote.dsk` 를 디스켓에 기록해 실기에 넣고 부팅 → SSC가 키보드가 됩니다.
2. `node server.js --serial COMx --baud 9600` 실행 후 브라우저 접속.
3. `⌨️ Apple 키보드` 칸에 `CATALOG`, `RUN 이름`, BASIC 줄, `SAVE 이름` 등을 입력하고 Enter.
4. `[📡 Apple에서 읽기]` 로 실기 드라이브 1의 파일 목록을 갱신하고, 파일을 눌러 BASIC 소스·Hex·디스어셈블리로 확인.
5. `[🧪 메모리/진단]` 으로 ROM/메모리를 PC 파일로 덤프하거나, RAM·ROM 상태를 진단.

자세한 내용은 아래 [사용 가이드 4](#4-키보드-없는-apple-ii-실기를-웹으로-조작하고-디스크-보기-a2remotedsk)를 보세요.

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

### 4. 키보드 없는 Apple II 실기를 웹으로 조작하고 디스크 보기 (A2REMOTE.DSK)

#### ① 부팅 디스크 만들기
```bash
npm run build:remote-dsk
```
`a2remote.dsk` 가 생성됩니다 (웹의 `💾 A2REMOTE.DSK` 버튼으로도 받을 수 있음). 내용은 DOS 3.3 + 두 파일뿐입니다.

| 파일 | 역할 |
| :--- | :--- |
| `HELLO` | 부팅 시 실행. `PRINT CHR$(4);"IN#2"` 로 DOS 입력을 SSC(슬롯 2)로 돌림 → PC가 키보드 |
| `A2SRV` | `$6000` 섹터 서버. 서버가 `BRUN A2SRV` 로 실행해 디스크를 읽고, 끝나면 BASIC으로 RTS |

이 이미지를 실기에서 부팅할 수 있게 준비합니다. 키보드가 안 되는 기계에서는 ADTPro처럼 Apple 쪽에서 명령을 쳐야 하는 도구를 쓸 수 없으므로 다음 중 하나를 씁니다.

| 방법 | 설명 |
| :--- | :--- |
| 디스크 에뮬레이터 (Floppy Emu 등) | Disk II 자리에 꽂고 SD 카드의 `a2remote.dsk` 를 바로 부팅 (가장 간단) |
| PC용 플로피 기록 장치 (Greaseweazle, Applesauce, FluxEngine) | `.dsk` 를 실제 5.25" 디스켓에 기록 |
| 키보드가 되는 다른 Apple II | ADTPro로 디스켓 기록 |

한 번 만들어 두면 이후 A2SRV 갱신은 웹의 `💽 디스켓에 최신 A2SRV 저장` 으로 실기가 직접 합니다.

#### ② 실기 연결
```
[Apple II SSC 슬롯 2 (DB-25 또는 10핀→DB-25)] ── 널 모뎀 케이블 ── [USB-RS232 어댑터] ── [PC COMx]
```
* SSC 점퍼 블록은 **`TERMINAL`** 방향 (널 모뎀 케이블일 때 `MODEM`).
* SSC DIP 스위치 SW1으로 **9600 bps** (SW1-1~4 = ON ON ON OFF), SW2: 8 데이터 비트·1 정지 비트·패리티 없음.
* 6551은 CTS가 있어야 송신하고, SSC 펌웨어는 DSR/DCD를 봅니다. 릴레이는 PC 쪽 DTR·RTS를 켜 두므로 널 모뎀 케이블이 이것들을 교차 연결하면 됩니다.

#### ③ 서버 실행 (실기 모드)
```bash
python -m pip install pyserial
```
```bash
node server.js --serial COM12 --baud 9600
```
COM 포트 이름은 `python tools/com_relay.py --list` 로 확인합니다. 서버가 `tools/com_relay.py` 를 띄워 COM 포트를 `127.0.0.1:6502` 로 중계하고 그곳에 접속합니다 (하드웨어 흐름 제어가 필요하면 `--rtscts`).

> Node 26에서는 `serialport` 네이티브 모듈이 로드되지 않아 COM 포트를 Python(pyserial) 릴레이로 엽니다.

#### ④ 사용
1. 실기에 A2REMOTE 디스켓을 넣고 전원을 켭니다. 화면에 `APPLE2-WEB REMOTE DISK ... KEYBOARD INPUT: SUPER SERIAL CARD SLOT 2` 가 나오고 `]` 에서 SSC 입력을 기다립니다.
2. 브라우저 `http://localhost:3000` 의 `⌨️ Apple 키보드` 칸에 명령을 입력하고 Enter.
   * `CATALOG` 가 한 화면을 넘으면 DOS가 키를 기다리므로 **`RETURN`** 버튼을 누릅니다.
   * BASIC 프로그램 중단은 **`Ctrl-C`**. (Control-Reset은 시리얼로 보낼 수 없습니다.)
   * 여러 줄(BASIC 프로그램)은 **`여러 줄…`** 에 붙여넣기 → 한 줄씩 RETURN과 함께 입력.
   * `대문자` 체크(기본)는 입력을 대문자로 바꿉니다 (DOS 3.3 명령은 대문자).
3. 명령이 끝난 뒤 **`[📡 Apple에서 읽기]`** 를 누르면 드라이브 1을 읽어 파일 목록이 갱신됩니다. 디스켓을 바꿔 넣고 읽으면 그 디스켓의 목록이 나옵니다. A2SRV가 없는 디스켓이면 `CALL-151` 후 모니터 헥스 줄로 A2SRV를 SSC로 보내 실행하고, 끝나면 `3D0G` 로 BASIC에 돌아갑니다.
4. `35트랙 전체` 를 체크하면 VTOC와 상관없이 전부 읽습니다 (DOS가 아닌 디스크는 자동으로 전체).

> 주의: 웹에서 입력한 글자는 그대로 Apple 키보드 입력입니다. 프로그램이 실행 중일 때 `[Apple에서 읽기]` 를 누르면 `BRUN A2SRV` 가 그 프로그램에 입력되니, `]` 프롬프트 상태에서 누르세요.

#### ⑤ 메모리 덤프와 진단 (`[🧪 메모리/진단]`)
Apple이 `]` 프롬프트에서 SSC 입력을 기다리는 상태에서 씁니다. 서버가 `BRUN A2SRV` 로 띄워 작업하고 BASIC으로 돌려 놓습니다.

**메모리 / ROM 덤프 → PC 파일**
1. 시작·끝 주소(16진수, 끝 포함)와 맵을 고르고 `⬇ 덤프`. 빠른 선택: ROM `$D000-$FFFF`, 모니터 ROM `$F800-$FFFF`, //e CX ROM `$C100-$CFFF`, 슬롯 6 ROM, RAM `$0000-$BFFF`.

   | 맵 | 읽는 것 |
   | :--- | :--- |
   | ROM | `$D000-$FFFF` 를 ROM으로 (`$C082`) |
   | 현재 매핑 | 지금 보이는 그대로 |
   | LC RAM bank 1 / 2 | Language Card RAM (`$C08B` / `$C083`) |
   | //e 내부 CX ROM | INTCXROM을 켜고 `$C100-$CFFF` 내부 ROM (끝나면 원래대로) |

2. 파일은 `remote/dumps/<이름>_<시작>-<끝>_<맵>_<시각>.bin` 으로 저장되고, 목록에서 `💾` 로 받거나 `보기` 로 Hex Editor / 6502 Disassembly(시작 주소 기준)로 엽니다.
3. `$C000-$C0FF`(I/O 소프트 스위치)는 읽기만 해도 디스크 모터·SSC 등이 반응하므로 읽지 않고 `$00` 으로 채웁니다. LC 맵을 쓴 뒤에는 `$D000-$FFFF` 가 ROM 읽기·쓰기 금지(`$C082`, DOS 3.3 + Applesoft ROM의 평소 상태)로 돌아갑니다.
4. 속도: 실기 9600bps에서 12KB ≈ 15초, STM32 ≈ 2초.

**메모리 진단**
* **기종**: 모니터 ROM의 ID 바이트(`$FBB3`, `$FBC0`, `$FB1E`)로 ][ / ][+ / //e / //e Enhanced / //c 를 판별합니다.
* **RAM 검사**: 주 메모리 `$0200-$BFFF` 와 (선택) Language Card RAM bank 1·2를 4KB씩 `$6600` 에 백업 → `하위주소 ^ 페이지 ^ K` (K = `$00 $FF $55 $AA`) 패턴을 쓰고 확인 → 복원합니다. 각 비트가 0과 1을 모두 겪고 블록 안의 모든 주소가 다른 값을 가지므로 **고정 비트**와 **블록 안 주소선 고장**을 찾습니다. 인터럽트를 끄고 ROM을 호출하지 않으므로 DOS·화면·메모리의 BASIC 프로그램은 그대로 남습니다.
* 검사하지 않는 곳: `$0000-$01FF`(제로페이지/스택), `$6000-$64FF`(A2SRV 코드), `$C000-$CFFF`(I/O), //e 보조 64KB(80컬럼 카드).
* 오류가 있으면 주소·기대값·읽은 값, **불량 데이터 비트(D0-D7)** 와 **16KB 뱅크**별 개수를 보여 줍니다. ][/][+ 는 16KB 뱅크마다 RAM 칩 8개(비트당 1개) 줄이므로 뱅크와 비트로 불량 칩을 좁힐 수 있습니다.
* **ROM**: `$D000-$FFFF` CRC32(전체, 2KB 칩 단위, //e 8KB 단위)를 보여 주고 덤프 파일도 남깁니다. 정상 ROM 덤프의 CRC32와 비교하면 ROM 칩 불량을 찾을 수 있습니다.
* 소요: STM32 약 15초, 실기 9600bps 약 1분(ROM CRC 포함).

> 디스켓의 A2SRV가 이 기능이 없는 구버전이면, 서버가 이를 알아채고 새 A2SRV를 모니터 헥스로 SSC를 통해 보내 실행합니다 (느림).

**디스켓의 A2SRV 최신화 (디스켓 기록 장치 없이)**
`[🧪 메모리/진단]` → `③ 💽 드라이브 1 디스켓에 최신 A2SRV 저장`. 서버가 최신 A2SRV를 SSC로 `$6000` 에 올리고 (`CALL-151`, 헥스 줄, `3D0G`), 웹 키보드로 `UNLOCK A2SRV` → `BSAVE A2SRV,A$6000,L…` → `LOCK A2SRV` 를 입력해 **실기 자신의 DOS로 디스켓에 덮어씁니다**. 그다음 디스크를 다시 읽어 디스켓의 A2SRV가 `apple2/a2srv.bin` 과 바이트 단위로 같은지 확인합니다. 디스켓에 쓰기 방지 탭이 없어야 하며, 이후로는 `BRUN A2SRV` 로 바로 실행되어 빨라집니다. A2SRV가 없는 다른 DOS 3.3 디스켓에도 같은 방법으로 넣을 수 있습니다.

#### STM32 에뮬레이터로 같은 동작 확인
```bash
npm run start:stm32
```
1. `a2remote.dsk` 를 보드 SD 카드에 올리고 드라이브 1에 넣습니다.
   ```bash
   pwsh -File ../STM32CubeIDE/STM32F769I-DISCO/tools/sd-upload.ps1 a2remote.dsk -Name A2REMOTE.DSK
   ```
   보드 CLI(텔넷 2323)에서 `disk next` 로 `A2REMOTE.DSK` 가 나올 때까지 넘깁니다.
2. 부팅: 에뮬레이터는 콜드 리셋 시 슬롯 7(SmartPort)을 먼저 부팅하므로, `]` 에서 `PR#6`, 모니터 `*` 에서 `C600G` 를 입력합니다. 이미 A2REMOTE로 부팅되어 있으면 웹 키보드로 `PR#6` 을 보내도 됩니다.
3. 이후는 실기와 같습니다.

명령줄 도구:
```bash
node remote_disk.js type CATALOG
```
```bash
node remote_disk.js dump remote/drive1.dsk
```
`--host/--port` 로 대상(기본 `169.254.246.139:6502`), `--baud 9600` 으로 실기 속도, `--full` 로 35트랙 전체를 지정합니다. PC에 169.254 대역 인터페이스가 여럿이면 `BRIDGE_LOCAL_ADDR` 환경 변수로 소스 주소를 고정합니다.

A2SRV를 고쳤다면 `npm run build:a2srv` (MSYS2 `xa` 어셈블러) 후 `npm run build:remote-dsk` 로 디스크를 다시 만듭니다.

**A2SRV 프로토콜** (PC → Apple: `$AA` 동기 바이트 + 명령)

| 명령 | 응답 |
| :--- | :--- |
| `$AA 'P'` | `A2SV2` (숫자는 버전) |
| `$AA 'T' <트랙>` | 읽은 섹터마다 `'S'` + 주소 니블 8 + 데이터 니블 343, 끝에 `'E' 0` (일부 못 읽으면 `'X' <남은 수>`) |
| `$AA 'Q'` | 헤드를 DOS 위치로 되돌리고 `'Q'`, 호출한 곳(BASIC/모니터)으로 RTS. SSC 입력은 그대로 |
| `$AA 'M' 주소(2) 길이(2) 맵` | `'M'` + 메모리 바이트 + 16비트 합(2). 맵 비트: 0 ROM, 1 LC bank 1, 2 LC bank 2, 3 //e INTCXROM |
| `$AA 'R' 페이지 개수(1-16) 맵` | RAM 블록 검사(내용 보존, 맵 비트 7 = 백업 생략). 오류마다 `'F'` 하위 상위 기대 실제(처음 32개), 끝에 `'D'` 오류 수(2) |

`'P'` 응답 `A2SV2` 의 숫자는 A2SRV 버전입니다 (2 = `M`/`R` 지원).

A2SRV는 트랙을 먼저 `$6600-$85FF`에 모두 읽은 뒤 한꺼번에 보냅니다 (보내는 동안 디스크가 돌아 섹터를 놓치지 않도록). 사용 메모리: 코드 `$6000-$64FF`, 버퍼(트랙 / RAM 검사 백업) `$6600-$85FF`, 제로페이지 `$06-$09 $CE-$CF $EB $FA-$FF`. 메모리에 있는 BASIC 프로그램이 매우 커서(문자열 포함) 이 영역을 쓰고 있으면 덮어쓸 수 있습니다.

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
| `GET` | `/api/remote/status` | SSC 연결(실기/STM32), A2SRV 실행 여부, 읽기 진행, 마지막 읽기 결과, 최근 입력 |
| `POST` | `/api/remote/type` | `{ "text": "CATALOG" }` 를 SSC로 Apple에 타이핑 (줄마다 RETURN). `{ "key": "ctrl-c" \| "return" \| "esc" }` |
| `POST` | `/api/remote/sync` | `BRUN A2SRV` → 드라이브 1 읽기 → `remote/drive1.dsk` 저장 → A2SRV 종료. `{ "full": true }` 면 35트랙 전체 (202, 진행은 status로) |
| `POST` | `/api/remote/quit` | 떠 있는 A2SRV 종료 (BASIC 프롬프트로) |
| `GET` | `/api/download/a2remote` | 실기 부팅용 `A2REMOTE.DSK` 다운로드 |
| `POST` | `/api/remote/memdump` | `{ "start": "D000", "end": "FFFF", "map": "rom", "name": "MYROM" }` 메모리 덤프 → `remote/dumps/*.bin` (202, 진행은 status로) |
| `GET` | `/api/remote/dumps` | 덤프 파일 목록 |
| `GET` | `/api/remote/dumps/:file` | 덤프 파일 다운로드 (`?format=hex` 면 JSON hex) |
| `POST` | `/api/remote/diag` | `{ "lc": true, "rom": true }` 메모리 진단 시작 (202) |
| `GET` | `/api/remote/diag` | 마지막 진단 결과 |
| `POST` | `/api/remote/update-a2srv` | 드라이브 1 디스켓에 최신 A2SRV를 BSAVE하고 다시 읽어 확인 (202) |

파일 조회 API(`/api/files`, `/api/files/:filename`, `/api/download/dsk`)에 **`?disk=remote`** 를 붙이면 Apple에서 읽어 온 디스크를 대상으로 합니다 (쓰기 API는 403).

> SSC가 Apple의 키보드이므로, 파일 저장 시 Apple로 보내던 `*** [WEB NOTICE] ***` 알림은 기본으로 꺼져 있습니다 (`--notify` 로 켬).

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
3. **서버 실행 명령** (pyserial 필요: `python -m pip install pyserial`):
   ```bash
   node server.js --serial COM3 --baud 9600
   ```
   자세한 사용법은 위의 [사용 가이드 4. A2REMOTE.DSK](#4-키보드-없는-apple-ii-실기를-웹으로-조작하고-디스크-보기-a2remotedsk) 참고.

### 방법 2. 무선 연결 (레트로 Wi-Fi 모뎀)
```
[Apple II 실기 SSC (DB-25)] ──> [RetroWiFiModem / WiModem232 (ESP8266)] ──> 📶 [가정용 Wi-Fi] ──> [PC Node.js 서버]
```
1. Apple II 뒷면 DB-25 포트에 **RetroWiFiModem** 또는 **WiModem232** 동글을 직접 꽂습니다.
2. 모뎀을 홈 Wi-Fi에 연결하고, 모뎀이 TCP 서버(수신 대기) 모드로 SSC의 바이트를 그대로 넘기도록 설정한 뒤 `node server.js --host <모뎀 IP> --port <포트>` 로 접속합니다. (이 방식은 아직 시험하지 않았습니다. 모뎀이 AT 명령/텔넷 협상을 끼워 넣지 않는 투명 모드여야 A2SRV 통신이 됩니다.)

---

## 📂 프로젝트 구조 (Directory Structure)

```
apple2-web/
├── backups/               # 디스크 자동 스냅샷 백업 저장소 (롤백용 타임스탬프 .dsk)
├── apple2/
│   ├── HELLO.BAS          # DOS 3.3 기본 부팅 환영 프로그램 소스
│   ├── WEBCLIENT.BAS      # Apple II SSC 웹 클라이언트 & 브릿지 소스
│   ├── REMOTE_HELLO.BAS   # A2REMOTE.DSK의 HELLO (IN#2: SSC를 키보드로)
│   ├── a2srv.s            # A2SRV: Disk II 섹터·메모리 덤프·RAM 검사를 SSC로 하는 6502 서버 (xa 문법)
│   └── a2srv.bin          # 어셈블된 A2SRV ($6000)
├── remote/                # (git 제외) SSC로 읽어 온 Apple 데이터
│   ├── drive1.dsk         #   드라이브 1 디스켓 사본
│   └── dumps/             #   메모리/ROM 덤프 *.bin
├── public/
│   └── index.html         # 웹 UI: 파일 목록, BASIC, Hex, 디스어셈블러, 원격 키보드, 메모리/진단
├── tools/
│   ├── AppleCommander.jar # AppleCommander DOS 3.3 디스크 처리 엔진
│   ├── com_relay.py       # 실기 COM 포트 ↔ TCP 중계 (pyserial)
│   └── dos33_template.dsk # 초기 DOS 3.3 기본 디스크 템플릿
├── ac_tool.py             # AppleCommander CLI 래퍼 (json, get, put, put-basic, delete)
├── build_dsk.py           # Applesoft BASIC 토크나이저 및 DSK 이미지 빌더
├── build_remote_dsk.py    # 실기 부팅용 a2remote.dsk 빌더 (HELLO + A2SRV)
├── a2remote.dsk           # 실기 부팅용 원격 키보드 디스크
├── bridge.js              # Apple II SSC <-> TCP/시리얼 브릿지 모듈
├── remote_disk.js         # SSC 원격 타이핑, A2SRV 실행, 4&4/6&2 디코딩, 메모리 덤프, RAM 진단 (CLI 겸용)
├── server.js              # Express 서버: DOS 3.3 파일 API, 백업/롤백, 원격(/api/remote/*), 접근 제한
├── apple2-web.dsk         # 부팅 가능한 실시간 Apple II DOS 3.3 디스크 이미지
├── package.json           # Node.js 프로젝트 설정 및 의존성
└── README.md              # 프로젝트 안내 문서
```

---

## 📄 라이선스 (License)

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# Apple II Web - DOS 3.3 Disk Manager · Remote Keyboard · Memory Diagnostics

[한국어](README.md) | **English**

[![Platform](https://img.shields.io/badge/Platform-Apple%20II%2B%20%2F%20%2F%2Fe-brightgreen)](https://github.com/mildstorm/apple2-web)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-blue)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**apple2-web** works with an Apple II from a web browser (`http://localhost:3000`). It does two things:

1. **Disk images on the PC**: view, edit, add and delete files in DOS 3.3 disk images (`.dsk`), with an Applesoft BASIC editor, a three-column hex editor and a 6502/65C02 disassembler.
2. **Remote control of an Apple II**: connect a real machine (including one with a broken keyboard) or the STM32 Apple //e emulator, and
   * **type** commands from the web page, over the Super Serial Card (SSC) or as **sound into the cassette input**,
   * **read the floppy** in the drive and browse it,
   * **dump memory/ROM** to files on the PC,
   * **diagnose RAM and ROM**.

---

## 🧭 What it does

| Area | Feature | Works on |
| :--- | :--- | :--- |
| 📁 Disk image | DOS 3.3 catalog, add/edit/delete files, `.dsk` download | `apple2-web.dsk` on the PC |
| 📝 Editing | Applesoft BASIC text ↔ tokens, missing `OPEN`/`CLOSE` check | Local disk |
| 📊 Analysis | Three-column hex editor, 6502/65C02 disassembler (ROM symbol comments, branch targets) | Files, disks, memory dumps |
| 🛡️ Safety | Automatic snapshot before every save (15 kept) + one-click rollback, disk operations serialized | Local disk |
| ⌨️ Remote keyboard | Type on the Apple from the web (`CATALOG`, `RUN`, BASIC lines, `SAVE` …), Ctrl-C/RETURN/ESC, multi-line paste — over the **SSC** or as **🔊 audio (cassette IN)** | Real machine / STM32 / AppleWin |
| 📡 Floppy view | Read drive 1 over the SSC and browse it as files, BASIC, hex, disassembly (read at the nibble level, no DOS needed) | Real machine / STM32 |
| 🧪 Memory dump | RAM, ROM, Language Card, //e internal ROM over an address range, to `.bin` files | Real machine / STM32 |
| 🩺 Diagnostics | Model detection, main memory and LC RAM test (contents kept), ROM CRC32 per chip | Real machine / STM32 |
| 💽 Floppy update | Bring A2SRV on the floppy up to date (the Apple's own DOS does `BSAVE`; no disk writer needed) | Real machine / STM32 |
| 🔒 Security | 127.0.0.1 only by default, DNS rebinding and CSRF refused | Server |

---

## 📸 Key Features

### A. Disk images on the PC

#### 1. 📁 Apple II DOS 3.3 disk file manager
* Reads the `apple2-web.dsk` image and lists its files. DOS names with spaces or control characters (`GUN SOUND.OBJ`, `I^ANIT`, …) are handled as they are.
* **File types**:
  * `[A]` **Applesoft BASIC**: text source is turned into Apple II tokens and line links (`$0801`) and saved
  * `[B]` **Binary**: 6502 machine code, fonts, memory dumps — edited byte by byte
  * `[I]` **Integer BASIC**: viewing
* **Disk operations**: add, edit and delete files, one-click `.dsk` download

#### 2. 📊 Interactive three-column hex editor
* **Offset / Hex / ASCII** columns (16 bytes a row, split every 8).
* Click a hex cell and type `0-9`, `A-F`: the byte and its ASCII change at once; two digits move to the next byte; arrow keys move around.
* Saves the edited binary to the disk as a `[B]` file.

#### 3. ⚙️ 6502 / 65C02 disassembler
* A 6502/65C02 disassembler in plain JavaScript.
* **Address / Hex Bytes / Instruction / Comments** columns. The base address can be changed (default `$0800`; for a memory dump, the dump's start address).
* **Apple II ROM symbols as comments**: `$FC58` HOME, `$FDED` COUT, `$FD0C` RDKEY, `$C000` KBD, `$C030` SPKR and more, plus branch targets.
* Clicking a line jumps to that byte in the hex editor; an address search (`$FDED`, …) jumps straight there.

#### 4. 🛡️ Protection against damage
* **Automatic snapshots & rollback**: the disk is kept in `backups/` right before every save or delete (latest 15), and `[🛡️ Snapshots & restore]` rolls back to any of them.
* **Serialized disk operations**: requests arriving together are queued so they cannot corrupt the VTOC (sector allocation map).
* **BASIC file I/O check**: warns about an `OPEN` without a `CLOSE` (an unclosed file on a real machine can damage the disk).

### B. Remote control of an Apple II (SSC and cassette input)

Built for a real machine with a broken keyboard. Boot it from **`A2REMOTE.DSK`** and its HELLO starts the input driver **A2KBDA**; from then on the Apple takes keys from **the keyboard, the SSC (slot 2) and the cassette input (sound from the PC)** alike. Floppy reading, dumps and diagnostics go over the SSC. The STM32 Apple //e emulator runs the same disk the same way.

#### 5. ⌨️ Remote keyboard
* Type into `⌨️ Apple keyboard` at the top of the page and press Enter; it is typed on the Apple. For example `CATALOG`, `RUN SHOOTING`, `10 PRINT "HI"`, `SAVE MYPROG`, `PR#6` (reboot).
* **Choose how it is sent** (`send: SSC / 🔊 audio`):
  * **SSC**: over the serial cable.
  * **🔊 audio**: no SSC needed — just an audio cable from the **PC's headphone/line out to the Apple's cassette IN jack**. The PC plays the command as a sound packet and A2KBDA decodes it from the cassette input (`$C060`). A packet carries several lines (up to 255 characters) that wait in a buffer on the Apple, so later lines are not lost while the first one runs. A packet with a bad checksum is dropped with a beep.
  * `🔊 WAV` saves that sound as a file to play from another device, such as a phone.
* `Ctrl-C` / `RETURN` / `ESC` buttons, `Multi-line…` paste (for BASIC programs), automatic upper case, recent input history.
* The Apple's screen does not come back to the page. Check results by reading the floppy (for example, refresh the list after `SAVE`).

#### 6. 📡 Floppy view
* `[📡 Read from Apple]`: the server types `BRUN A2SRV` to start a small 6502 sector server (A2SRV) inside the Apple, reads drive 1 into `remote/drive1.dsk`, and stops A2SRV again, leaving the `]` prompt.
* Switch the disk selector to `Apple II drive 1` to browse it like a PC disk: file list, BASIC source, hex, disassembly (read only).
* A2SRV reads the Disk II **at the nibble level**, not through DOS, so disks without DOS can be read too. The PC does the 4&4/6&2 decoding and checks the checksums.
* By default only **the tracks the VTOC marks as used** are read: 6 tracks for A2REMOTE.DSK, about 40 s on a real machine at 9600 bps and about 7 s on the STM32. A `all 35 tracks` option is there too.
* Swap the floppy and read again to see the new one. If that floppy has no A2SRV, it is sent over the SSC and run.
* Afterwards the head goes back to where DOS remembers it (`$047E`), so DOS carries on normally.

#### 7. 🧪 Memory / ROM dump → file on the PC
* In the `[🧪 Memory/Diagnostics]` window, pick an address range and a map; the Apple's memory arrives in `remote/dumps/*.bin`. Maps: ROM / current mapping / Language Card RAM bank 1·2 / //e internal `$C100-$CFFF` ROM.
* Presets: ROM `$D000-$FFFF`, monitor ROM `$F800-$FFFF`, //e CX ROM, slot 6 ROM, 48K RAM.
* `View` opens a dump straight in the hex editor and disassembler.
* The transfer is checksum-verified. `$C000-$C0FF` (I/O) is never read, because reading it makes devices act.

#### 8. 🩺 Memory diagnostics
* **Model**: told apart by ROM ID bytes: ][ / ][+ / //e / //e Enhanced / //c.
* **RAM test**: main memory `$0200-$BFFF` and the Language Card RAM, 4 KB at a time: back up → write and check four patterns → restore. **Memory contents are kept**, so DOS and a BASIC program are still there afterwards. Stuck bits and address-line faults are reported with **the address, the bad data bits and the 16 KB bank** (to find a bad RAM chip).
* **ROM check**: CRC32 of `$D000-$FFFF` as a whole, per 2 KB chip (][/][+) and per 8 KB (//e), with a dump file. Compare with a good ROM to find a bad ROM chip.

#### 9. 💽 Bringing A2SRV on the floppy up to date
* With no disk writer: the Apple's own DOS overwrites A2SRV on the floppy with the latest version (`UNLOCK` → `BSAVE` → `LOCK`).
* The disk is then read back and checked byte for byte. It also puts A2SRV onto other DOS 3.3 floppies.

#### 10. 🔌 Connections
| Target | Connection | Run |
| :--- | :--- | :--- |
| Real Apple II | SSC ─ null modem cable ─ USB-RS232 ─ PC COM port (Python relay) | `node server.js --serial COM12 --baud 9600` |
| Real Apple II, audio keys | PC headphone/line out ─ 3.5 mm cable ─ cassette IN | (any mode; send: `🔊 audio`) |
| STM32F769I-DISCO Apple //e emulator | Direct RJ45, board TCP 6502 = SSC, TCP 6503 = cassette input | `npm run start:stm32` |
| AppleWin | SSC TCP socket 1977 | `npm start` |

### C. 🔒 Security
* The server listens **on this PC only (127.0.0.1)** by default: there is no login, and the remote keyboard can type anything on the Apple. Use `--listen 0.0.0.0` to open it to other devices.
* Requests whose Host header is not localhost (DNS rebinding) and POST/DELETE from other web sites (CSRF) are refused.
* Error responses carry no stack traces or PC paths.

### ⚠️ Known limitations
* **Ctrl-C**: Applesoft checks the keyboard hardware (`$C000`) directly to stop a running program, so a remote Ctrl-C only works while the program is waiting for input. Control-Reset cannot be sent over a serial line.
* **No screen**: the Apple's screen does not come back. When `CATALOG` fills the screen and waits for a key, press `RETURN`.
* **The first floppy**: with no keyboard, tools that need commands typed on the Apple (such as ADTPro) cannot be used. Prepare `a2remote.dsk` once with a disk emulator such as Floppy Emu, or a PC floppy writer (Greaseweazle, Applesauce).
* **Test coverage**: the //e auxiliary 64 KB (80-column card) is not tested. The RAM test works in 4 KB blocks, so address faults that alias between blocks are not found.
* **No //c**: the //c (no SSC slot, a built-in serial port) has not been tried. It has no cassette jack either, so audio keys cannot work on it.
* **Audio is one way**: audio carries keys (PC → Apple) only. Floppy reading, dumps and diagnostics (Apple → PC) need the SSC. Audio has no acknowledgement: a packet received wrongly is dropped with a beep (send it again), and sound that arrives while the Apple is busy running a command, not waiting for a key, is lost.
* **What audio has been checked on**: A2KBDA's decoding was checked ① in the py65 6502 simulator (the real WAV fed cycle by cycle, `npm run test:audio`) and ② on the STM32 board's cassette input (TCP 6503, the real A2KBDA on a cycle-accurate 6502): a 7-packet, 1.5 KB program arrived without a single wrong character and a damaged packet was dropped. The **analog part** — PC sound card → cable → the real machine's cassette circuit — still has to be tried on a real machine.
* **Not yet tried on real hardware**: everything was verified on the STM32 emulator, not yet on a real machine. If characters go missing, increase the typing delays in `remote_disk.js` (real machine: 2 ms per character, 400 ms per line).

---

## 🏛️ Architecture

```
 Browser (http://localhost:3000)
 ┌──────────────────────────────────────────────────────────────┐
 │ 📁 Files  📝 BASIC  📊 Hex  ⚙️ 6502 Disasm                     │
 │ 💽 Disk select (local / Apple drive 1)  ⌨️ Remote keyboard     │
 │ 🧪 Memory dump · diagnostics · floppy A2SRV update             │
 └───────────────────────────┬──────────────────────────────────┘
                             │ REST (127.0.0.1)
 Node.js server.js ──────────┴───────────────────────────────────────────┐
 │  /api/files ── ac_tool.py ── AppleCommander ── apple2-web.dsk (local)   │
 │                                            └── remote/drive1.dsk (copy) │
 │  /api/remote/* ── remote_disk.js (typing, A2SRV, 4&4/6&2 decoding,      │
 │                   memory dump, RAM test)                                │
 │                 └ audio_keys.js (keys as cassette packets)              │
 │                       │ bridge.js (TCP byte stream)                     │
 └───────────────────────┼─────────────────────────────────────────────────┘
          ┌──────────────┼──────────────────────┬─────────────────────┐
          ▼              ▼                      ▼                     ▼
  tools/com_relay.py  STM32 board TCP 6502  AppleWin TCP 1977     (Wi-Fi modem, …)
  (pyserial) ─ COMx      │  (+ TCP 6503 cassette input)
          │              ▼                      ▼
          ▼        emulated //e SSC       AppleWin SSC
   Real Apple II SSC (slot 2)        audio_keys.js ─ PC sound out ─┐
          │                                                         ▼
          │                                   real cassette IN ($C060)
          │  A2REMOTE.DSK boot: HELLO → (IN#2 if SSC) → BRUN A2KBDA
          │  A2KBDA ($9300): keyboard · SSC · cassette input → DOS/BASIC keys
          │  A2SRV ($6000): Disk II nibble reads / memory dump / RAM test
          ▼
   Disk II (slot 6, drive 1)
```

---

## 🚀 Quick Start

### 1. Requirements
* **Node.js** (v18 or later)
* **Python 3.x**
* **Java (JRE/JDK 8 or later)**: for disk work through AppleCommander
* **AppleWin** (Apple //e emulator, optional)
* **pyserial** (only for a real machine on a COM port): `python -m pip install pyserial`
* **py65** (only for the audio simulation test `npm run test:audio`): `python -m pip install py65`
* **xa** 6502 assembler (only to change A2SRV/A2KBDA; MSYS2 `pacman -S mingw-w64-ucrt-x86_64-xa`)

### 2. Clone and install
```bash
git clone https://github.com/mildstorm/apple2-web.git
cd apple2-web
npm install
```

### 3. Start the server
Pick the command for the Apple you connect to.

| Target | Command | SSC connection |
| :--- | :--- | :--- |
| AppleWin (default) | `npm start` | `127.0.0.1:1977` |
| STM32 emulator | `npm run start:stm32` | board `169.254.246.139:6502` (direct RJ45) |
| Real Apple II | `node server.js --serial COM12 --baud 9600` | USB-RS232 + null modem → SSC slot 2 |

Then open:
👉 **http://localhost:3000**

> 🔒 **Security**: the server has no login, and the web keyboard can type anything on the Apple (`INIT`, `DELETE`, …). That is why it listens **on this PC only (127.0.0.1)** by default.
> * To use it from other devices (your home network, Tailscale, …) pass `--listen 0.0.0.0` (or `--listen <that interface's address>`). Only do so on a network you trust; if the PC gets a public IP directly with no router, turn off Node.js's **Public** inbound rule in the Windows firewall.
> * Requests whose Host header is not localhost (DNS rebinding) and POST/DELETE sent from other web sites (CSRF) are refused.

### 4. Using a keyboardless real machine from the web (summary)
1. Write the `a2remote.dsk` made by `npm run build:remote-dsk` to a floppy and boot the real machine from it → the SSC and the cassette input become its keyboard.
2. Run `node server.js --serial COMx --baud 9600` and open the browser.
3. Type `CATALOG`, `RUN name`, BASIC lines, `SAVE name` … into `⌨️ Apple keyboard` and press Enter (send: SSC or 🔊 audio).
4. `[📡 Read from Apple]` refreshes the file list of drive 1; click a file for its BASIC source, hex and disassembly.
5. `[🧪 Memory/Diagnostics]` dumps ROM/memory to files on the PC or checks RAM and ROM.

Details are in [How to Use 4](#4-a-keyboardless-real-apple-ii-from-the-web-and-viewing-its-disk-a2remotedsk) below.

---

## 💻 How to Use

### 1. Editing an Applesoft BASIC file (`[A]`)
1. Click an `[A]` file such as `HELLO` or `WEBCLIENT` in the file list on the left.
2. Its BASIC source appears in the editor on the right.
3. Add lines with line numbers where you like:
   ```basic
   10 TEXT : HOME
   20 PRINT "HELLO WORLD FROM APPLE //e!"
   25 PRINT "NEW LINE ADDED FROM WEB!"
   30 END
   ```
4. **`[💾 Save to disk]`** tokenizes it with the Python tokenizer, builds the line links, and writes it straight into `apple2-web.dsk`.

### 2. Editing a binary file & the 6502 disassembler (`[B]`)
1. Click a `[B]` file such as `FPBASIC`, `INTBASIC` or `BOOT13` in the file list.
2. **Hex editor**:
   * Click the byte to change.
   * Type `0-9`, `A-F`: the byte and its ASCII change at once.
   * Arrow keys move to neighbouring bytes.
3. **6502 disassembly**:
   * Click the **`[ ⚙️ 6502 Disassembly ]`** tab at the top right.
   * The machine code appears as instructions with Apple II ROM symbol comments (`COUT`, `HOME`, `RDKEY`, …).
   * Click an instruction to jump to its byte in the hex editor.
   * Change the start address (`$0800`, …) and the addresses and branch targets are recalculated.
4. **`[💾 Save to disk]`** writes the edited binary to the disk.

### 3. Checking the result in AppleWin
1. Mount `apple2-web.dsk` in AppleWin's drive 1.
2. Press **`F2`** (or `Ctrl + F2`) to boot.
3. Type **`CATALOG`** at the `]` prompt: the files added or changed on the web are there.
4. `RUN name` or `BRUN name` runs them in the emulator.

### 4. A keyboardless real Apple II from the web, and viewing its disk (A2REMOTE.DSK)

#### ① Make the boot disk
```bash
npm run build:remote-dsk
```
This makes `a2remote.dsk` (also downloadable with the page's `💾 A2REMOTE.DSK` button): DOS 3.3 and three files.

| File | Role |
| :--- | :--- |
| `HELLO` | Runs at boot: `HIMEM: 37632`; if an SSC is in slot 2 (ROM ID `$C205=$38`, `$C207=$18`) `IN#2` to set it up; then `BRUN A2KBDA` |
| `A2KBDA` | `$9300` input driver: takes keys from the keyboard, the SSC and the cassette input and hands them to DOS/BASIC (`apple2/a2kbda.s`) |
| `A2SRV` | `$6000` sector server: the server runs it with `BRUN A2SRV` to read the disk; it returns to BASIC with RTS |

Get the image to where the real machine can boot it. A machine with no keyboard cannot use tools that need commands typed on the Apple (such as ADTPro), so use one of these:

| Way | How |
| :--- | :--- |
| Disk emulator (Floppy Emu, …) | Plug it in place of the Disk II and boot `a2remote.dsk` from its SD card (simplest) |
| PC floppy writer (Greaseweazle, Applesauce, FluxEngine) | Write the `.dsk` to a real 5.25" floppy |
| Another Apple II with a working keyboard | Write the floppy with ADTPro |

Once that floppy exists, later A2SRV updates are done by the machine itself from the page (`💽 Save the latest A2SRV to the floppy`).

#### ② Connect the real machine
```
[Apple II SSC slot 2 (DB-25 or 10-pin→DB-25)] ── null modem cable ── [USB-RS232 adapter] ── [PC COMx]
```
* The SSC's jumper block points to **`TERMINAL`** (`MODEM` when the cable is a null modem).
* SSC DIP switch SW1 for **9600 bps** (SW1-1..4 = ON ON ON OFF); SW2: 8 data bits, 1 stop bit, no parity.
* The 6551 needs CTS to transmit and the SSC firmware looks at DSR/DCD. The relay keeps the PC's DTR and RTS on, so a null modem cable that crosses them is all that is needed.

#### ③ Start the server (real machine)
```bash
python -m pip install pyserial
```
```bash
node server.js --serial COM12 --baud 9600
```
`python tools/com_relay.py --list` shows the COM port names. The server starts `tools/com_relay.py`, which relays the COM port to `127.0.0.1:6502`, and connects there (`--rtscts` for hardware flow control).

> On Node 26 the `serialport` native module does not load, so COM ports are opened by a Python (pyserial) relay.

#### ③-1 Sending keys as audio (without an SSC, or alongside one)
```
[PC headphone/line out] ── 3.5 mm audio cable ── [Apple cassette IN jack]
```
* Use the **cassette IN** (input) jack on the back of a ][+ / //e, not OUT. Set the PC volume **near maximum** and turn off sound effects such as loudness equalization.
* Switch `send` on the page to `🔊 audio` and type a command. The PC plays about 0.3 s of sound (for a short command). On Windows it is played with Python's built-in `winsound`, so nothing needs installing.
* To play the sound from another device, save it with `🔊 WAV` or `GET /api/remote/audio.wav?text=CATALOG`. On the command line: `node audio_keys.js play "CATALOG"` / `node audio_keys.js wav "CATALOG" out.wav`.
* With audio only, the server can run with no SSC at all: `node server.js --no-bridge` (floppy reading, dumps and diagnostics need the SSC).
* **On the STM32 board the signal goes in directly, not as sound**: with `--stm32`, `🔊 audio` does not play on the PC speaker; the same half-cycle lengths go to the board's **cassette input port, TCP 6503**, and the firmware turns them into `$C060` bit 7 on the emulated CPU's cycles (STM32 project, `applem-core/src/core/input/cassette_input.hpp`). That tests A2KBDA's audio reception on the board without a cable. Add `--audio-pc` to use the speaker even then. On the command line: `node audio_keys.js board "CATALOG"`.

**Audio packet format** (square-wave half cycles; A2KBDA measures them in 14-cycle loop counts)

| Part | Content |
| :--- | :--- |
| Leader | 200 half cycles of 833 µs (600 Hz); A2KBDA accepts 64 or more |
| Sync | 150 µs, then 250 µs |
| Bytes | MSB first. 0 = 2 × 250 µs, 1 = 2 × 500 µs |
| Layout | `LEN` (1-255), `LEN` data bytes (7-bit ASCII, lines end with RETURN), `CHK = $A5 ^ LEN ^ data` |

A change of level only counts as an edge if the new level is still there about 80 µs later (debounce), which filters out chatter from noise. `npm run test:audio` runs A2KBDA in the py65 6502 simulator with the real WAV on `$C060` cycle by cycle: multi-line input, every printable character, 3 packets, CPU clock ±3%, ±40 µs jitter, an inverted signal, and a damaged packet (beeped and dropped).

#### ④ Use it
1. Put the A2REMOTE floppy in the real machine and switch on. The screen shows `APPLE2-WEB REMOTE DISK` and `KEYS FROM: KEYBOARD, CASSETTE IN, SSC SLOT 2` (without the SSC part when there is none) and waits at `]`.
2. Type a command into `⌨️ Apple keyboard` at `http://localhost:3000` and press Enter. Choose SSC or 🔊 audio under `send`.
   * When `CATALOG` fills the screen, DOS waits for a key: press the **`RETURN`** button.
   * **`Ctrl-C`** stops a BASIC program (Control-Reset cannot be sent over a serial line).
   * Paste several lines (a BASIC program) into **`Multi-line…`**; each line is typed with RETURN.
   * `Upper case` (on by default) turns input to upper case (DOS 3.3 commands are upper case).
3. When the command has finished, **`[📡 Read from Apple]`** reads drive 1 and refreshes the file list. Swap floppies and read again to see the new one. For a floppy without A2SRV, A2SRV is sent over the SSC as monitor hex lines after `CALL-151` and run, and `3D0G` returns to BASIC afterwards.
4. Tick `all 35 tracks` to read every track regardless of the VTOC (disks without DOS are always read whole).

> Note: what you type on the page is the Apple's keyboard input. Pressing `[Read from Apple]` while a program is running types `BRUN A2SRV` into that program, so press it at the `]` prompt.

#### ⑤ Memory dumps and diagnostics (`[🧪 Memory/Diagnostics]`)
Use them while the Apple waits at the `]` prompt for SSC input. The server starts A2SRV with `BRUN A2SRV`, does the work, and returns to BASIC.

**Memory / ROM dump → file on the PC**
1. Enter start and end addresses (hex, end included), pick a map, and press `⬇ Dump`. Presets: ROM `$D000-$FFFF`, monitor ROM `$F800-$FFFF`, //e CX ROM `$C100-$CFFF`, slot 6 ROM, RAM `$0000-$BFFF`.

   | Map | Reads |
   | :--- | :--- |
   | ROM | `$D000-$FFFF` as ROM (`$C082`) |
   | Current mapping | whatever is mapped now |
   | LC RAM bank 1 / 2 | Language Card RAM (`$C08B` / `$C083`) |
   | //e internal CX ROM | INTCXROM on, the internal `$C100-$CFFF` ROM (switched back afterwards) |

2. The file is saved as `remote/dumps/<name>_<start>-<end>_<map>_<time>.bin`; download it with `💾` in the list or open it with `View` in the hex editor / 6502 disassembly (at its start address).
3. `$C000-$C0FF` (I/O soft switches) is not read — just reading it can start the disk motor or take a byte from the SSC — and comes back as `$00`. After an LC map, `$D000-$FFFF` is left as ROM read, write protected (`$C082`, how DOS 3.3 with Applesoft in ROM normally runs).
4. Speed: 12 KB in about 15 s on a real machine at 9600 bps, about 2 s on the STM32.

**Memory diagnostics**
* **Model**: from the monitor ROM's ID bytes (`$FBB3`, `$FBC0`, `$FB1E`): ][ / ][+ / //e / //e Enhanced / //c.
* **RAM test**: main memory `$0200-$BFFF` and (optionally) Language Card RAM banks 1 and 2, 4 KB at a time: back up to `$6600` → write and check `low address ^ page ^ K` (K = `$00 $FF $55 $AA`) → restore. Every bit is both 0 and 1 at each address and every address in a block holds a different value, so **stuck bits** and **address faults within a block** show up. Interrupts are off and no ROM is called, so DOS, the screen and a BASIC program in memory survive.
* Not tested: `$0000-$01FF` (zero page/stack), `$6000-$64FF` (A2SRV's code), `$C000-$CFFF` (I/O), the //e's auxiliary 64 KB (80-column card).
* Errors are shown with address, expected and actual values, plus counts per **bad data bit (D0-D7)** and **16 KB bank**. On a ][/][+ each 16 KB bank is a row of 8 RAM chips, one per bit, so bank and bit narrow it down to a chip.
* **ROM**: CRC32 of `$D000-$FFFF` (whole, per 2 KB chip, per //e 8 KB) and a dump file. Compare with the CRC32 of a good ROM dump to find a bad ROM chip.
* Time: about 15 s on the STM32, about 1 minute on a real machine at 9600 bps (with the ROM CRC).

> If the floppy's A2SRV is an older version without these commands, the server notices and sends the new A2SRV over the SSC as monitor hex (slow).

**Bringing A2SRV on the floppy up to date (no disk writer needed)**
`[🧪 Memory/Diagnostics]` → `③ 💽 Save the latest A2SRV to the drive 1 floppy`. The server puts the latest A2SRV at `$6000` over the SSC (`CALL-151`, hex lines, `3D0G`), then types `UNLOCK A2SRV` → `BSAVE A2SRV,A$6000,L…` → `LOCK A2SRV` on the web keyboard, so **the machine's own DOS writes it to the floppy**. The disk is then read back and its A2SRV compared with `apple2/a2srv.bin` byte for byte. The floppy must not be write protected; afterwards `BRUN A2SRV` starts it directly and quickly. It works for other DOS 3.3 floppies too.

#### The same on the STM32 emulator
```bash
npm run start:stm32
```
1. Put `a2remote.dsk` on the board's SD card and in drive 1:
   ```bash
   pwsh -File ../STM32CubeIDE/STM32F769I-DISCO/tools/sd-upload.ps1 a2remote.dsk -Name A2REMOTE.DSK
   ```
   On the board's CLI (telnet 2323) step with `disk next` until `A2REMOTE.DSK` comes up.
2. Boot: on a cold reset the emulator boots slot 7 (SmartPort) first, so type `PR#6` at `]` or `C600G` at the monitor's `*`. If A2REMOTE is already booted, send `PR#6` from the web keyboard.
3. From there it is the same as on a real machine.

Command-line tools:
```bash
node remote_disk.js type CATALOG
```
```bash
node remote_disk.js dump remote/drive1.dsk
```
`--host/--port` choose the target (default `169.254.246.139:6502`), `--baud 9600` a real machine's speed, `--full` all 35 tracks. If the PC has several 169.254.x.x interfaces, set the source address with the `BRIDGE_LOCAL_ADDR` environment variable.

After changing A2SRV or A2KBDA, rebuild with `npm run build:a2srv` / `npm run build:a2kbda` (MSYS2 `xa` assembler) and then `npm run build:remote-dsk`.

**A2SRV protocol** (PC → Apple: `$AA` sync byte + command)

| Command | Reply |
| :--- | :--- |
| `$AA 'P'` | `A2SV2` (the digit is the version) |
| `$AA 'T' <track>` | `'S'` + 8 address nibbles + 343 data nibbles for each sector read, then `'E' 0` (`'X' <missing>` if some could not be read) |
| `$AA 'Q'` | Head back to DOS's position, `'Q'`, RTS to the caller (BASIC/monitor). SSC input stays |
| `$AA 'M' addr(2) len(2) map` | `'M'` + memory bytes + 16-bit sum (2). Map bits: 0 ROM, 1 LC bank 1, 2 LC bank 2, 3 //e INTCXROM |
| `$AA 'R' page count(1-16) map` | RAM test of a block (contents kept; map bit 7 = no backup). `'F'` lo hi expected actual per fault (first 32), then `'D'` error count (2) |

The digit in the `'P'` reply `A2SV2` is A2SRV's version (2 = supports `M`/`R`).

A2SRV reads a whole track into `$6600-$85FF` first and sends it afterwards (so no sector is missed while sending). Memory used: code `$6000-$64FF`, buffer (track / RAM test backup) `$6600-$85FF`, zero page `$06-$09 $CE-$CF $EB $FA-$FF`. A very large BASIC program (with its strings) using that area could be overwritten.

---

## 📡 REST API

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/files` | All files on `apple2-web.dsk` (JSON) |
| `GET` | `/api/files/:filename` | A BASIC file's source text |
| `GET` | `/api/files/:filename?type=B` | A binary file's raw bytes as hex |
| `POST` | `/api/files` | Save BASIC source (tokenized) or binary hex (serialized, with automatic backup) |
| `DELETE` | `/api/files/:filename` | Delete a file from the disk (automatic backup) |
| `GET` | `/api/backups` | Disk snapshots (latest 15) |
| `POST` | `/api/backups/rollback` | Roll the disk back to a snapshot |
| `POST` | `/api/backups/create` | Make a snapshot now |
| `GET` | `/api/download/dsk` | Download `apple2-web.dsk` |
| `GET` | `/api/remote/status` | SSC connection (real/STM32), A2SRV running, progress, last read, recent input |
| `POST` | `/api/remote/type` | `{ "text": "CATALOG" }` typed on the Apple (RETURN after each line). `{ "key": "ctrl-c" \| "return" \| "esc" }`. `"via": "audio"` sends it as sound (default `"ssc"`); with `--stm32` that goes to the board's cassette input |
| `GET` | `/api/remote/audio.wav` | The audio-key WAV for `?text=CATALOG` (to play from another device) |
| `POST` | `/api/remote/sync` | `BRUN A2SRV` → read drive 1 → save `remote/drive1.dsk` → stop A2SRV. `{ "full": true }` for all 35 tracks (202; progress in status) |
| `POST` | `/api/remote/quit` | Stop a running A2SRV (back to the BASIC prompt) |
| `GET` | `/api/download/a2remote` | Download the boot disk `A2REMOTE.DSK` |
| `POST` | `/api/remote/memdump` | `{ "start": "D000", "end": "FFFF", "map": "rom", "name": "MYROM" }` memory dump → `remote/dumps/*.bin` (202; progress in status) |
| `GET` | `/api/remote/dumps` | List of dump files |
| `GET` | `/api/remote/dumps/:file` | Download a dump (`?format=hex` for JSON hex) |
| `POST` | `/api/remote/diag` | `{ "lc": true, "rom": true }` start diagnostics (202) |
| `GET` | `/api/remote/diag` | Last diagnostics result |
| `POST` | `/api/remote/update-a2srv` | BSAVE the latest A2SRV to the drive 1 floppy and read it back to check (202) |

Add **`?disk=remote`** to the file APIs (`/api/files`, `/api/files/:filename`, `/api/download/dsk`) to use the disk read from the Apple instead (write APIs return 403 for it).

> Because the SSC is the Apple's keyboard, the `*** [WEB NOTICE] ***` messages once sent to the Apple on every save are off by default (`--notify` turns them on).

---

## 🔌 Real Hardware Setup

To connect a real Apple II's **Super Serial Card (slot 2)** to the PC, choose one of these.

### Option 1. Wired (USB to RS-232 + null modem cable)
```
[Apple II SSC (DB-25)] ──> [DB25/DB9 null modem cable] ──> [USB-RS232 adapter (FTDI)] ──> [PC USB port]
```
1. **Parts**:
   * A USB to RS-232 serial cable (FTDI chipset)
   * A DB9 to DB25 **null modem (TX/RX crossed) cable** (or a crossover adapter)
2. **SSC jumper**:
   * Point the arrow of the jumper block in the middle of the SSC to **`TERMINAL`** and connect the null modem cable.
3. **Start the server** (needs pyserial: `python -m pip install pyserial`):
   ```bash
   node server.js --serial COM3 --baud 9600
   ```
   See [How to Use 4. A2REMOTE.DSK](#4-a-keyboardless-real-apple-ii-from-the-web-and-viewing-its-disk-a2remotedsk) above for the rest.

### Option 2. Wireless (retro Wi-Fi modem)
```
[Apple II SSC (DB-25)] ──> [RetroWiFiModem / WiModem232 (ESP8266)] ──> 📶 [home Wi-Fi] ──> [PC Node.js server]
```
1. Plug a **RetroWiFiModem** or **WiModem232** dongle straight into the DB-25 port on the back of the Apple II.
2. Join the modem to your Wi-Fi, set it to pass the SSC's bytes through as a TCP server (listening), then connect with `node server.js --host <modem IP> --port <port>`. (Not tried yet. The modem must be in a transparent mode that adds no AT commands or telnet negotiation, or A2SRV's traffic will not get through.)

---

## 📂 Directory Structure

```
apple2-web/
├── backups/               # automatic disk snapshots (timestamped .dsk, for rollback)
├── apple2/
│   ├── HELLO.BAS          # DOS 3.3 boot greeting program source
│   ├── WEBCLIENT.BAS      # Apple II SSC web client & bridge source
│   ├── REMOTE_HELLO.BAS   # A2REMOTE.DSK's HELLO (IN#2 if there is an SSC, then BRUN A2KBDA)
│   ├── a2kbda.s / .bin    # A2KBDA: input driver taking keys from keyboard, SSC, cassette input ($9300)
│   ├── a2srv.s            # A2SRV: 6502 server for Disk II sectors, memory dumps, RAM tests over the SSC (xa syntax)
│   └── a2srv.bin          # assembled A2SRV ($6000)
├── remote/                # (not in git) data read from the Apple
│   ├── drive1.dsk         #   copy of the drive 1 floppy
│   └── dumps/             #   memory/ROM dumps *.bin
├── public/
│   └── index.html         # web UI: files, BASIC, hex, disassembler, remote keyboard, memory/diagnostics
├── tools/
│   ├── AppleCommander.jar # AppleCommander DOS 3.3 disk engine
│   ├── com_relay.py       # real machine's COM port ↔ TCP relay (pyserial)
│   ├── test_a2kbda.py     # A2KBDA audio reception checked in the py65 6502 simulator (npm run test:audio)
│   └── dos33_template.dsk # DOS 3.3 template disk
├── ac_tool.py             # AppleCommander CLI wrapper (json, get, put, put-basic, delete)
├── build_dsk.py           # Applesoft BASIC tokenizer and DSK image builder
├── build_remote_dsk.py    # builds a2remote.dsk for the real machine (HELLO + A2SRV + A2KBDA)
├── a2remote.dsk           # boot disk for the real machine (remote keyboard)
├── bridge.js              # Apple II SSC <-> TCP/serial bridge module
├── remote_disk.js         # SSC typing, A2SRV, 4&4/6&2 decoding, memory dumps, RAM tests (also a CLI)
├── audio_keys.js          # audio keys: text → cassette packets as WAV, PC playback or STM32 TCP 6503 (also a CLI)
├── server.js              # Express server: DOS 3.3 file API, backup/rollback, remote (/api/remote/*), access limits
├── apple2-web.dsk         # bootable Apple II DOS 3.3 disk image
├── package.json           # Node.js project settings and dependencies
├── README.md              # documentation (Korean)
└── README.en.md           # documentation (English)
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

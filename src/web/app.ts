/**
 * app.ts - Browser UI of the Apple II DOS 3.3 Web File Manager
 *
 * Compiled to dist/web/app.js and loaded by public/index.html at the end of
 * <body> as a classic script. It has no imports/exports on purpose: its
 * top-level functions are globals, called from the HTML's onclick="..."
 * attributes.
 */

// ---- API shapes (see src/server/server.ts) ----------------------------------

interface CatalogFile {
  name: string;
  type: string;
}

interface Instruction {
  offset: number;
  addr: number;
  bytes: number[];
  mnemonic: string;
  operand: string;
  comment: string;
}

interface RemoteStatus {
  available: boolean;
  link: 'serial' | 'stm32' | 'tcp';
  target: string;
  sscConnected: boolean;
  serverRunning: boolean;
  busy: boolean;
  phase: 'idle' | 'loading' | 'reading' | 'done' | 'error';
  message: string;
  done: number;
  total: number;
  typed?: { at: string; via: string; text: string }[];
  job: string | null;
  lastSync: { tracksRead: number; unreadable?: unknown[] } | null;
  snapshot: { path: string; mtime: string } | null;
}

interface DumpEntry {
  file: string;
  size: number;
  start: string | null;
  end: string | null;
  map: string | null;
}

interface RamSummary {
  label: string;
  bytesTested: number;
  errors: number;
  ok: boolean;
  badBits: { bit: number; count: number }[];
  badBanks: Record<string, number>;
  faults: { addr: string; expected: string; actual: string; bits: number[] }[];
}

interface DiagReport {
  at: string;
  machine: { name: string; id: { FBB3: string; FBC0: string; FB1E: string } };
  main: RamSummary;
  lc?: { present: false; note: string } | { present: true; bank2: RamSummary; bank1: RamSummary };
  rom?: {
    crc32: string;
    file?: string;
    chips2k: { range: string; crc32: string }[];
    halves8k: { range: string; crc32: string }[];
  };
}

/** The element with this id (the page always has it). */
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const fileTable = byId('file-table');
const fileCount = byId('file-count');
const editorTitle = byId('editor-title');
const editorTypeTag = byId('editor-type-tag');
const targetFilename = byId<HTMLInputElement>('target-filename');
const editorSizeInfo = byId('editor-size-info');
const basicEditor = byId<HTMLTextAreaElement>('basic-editor');
const hexEditorWrapper = byId('hex-editor-wrapper');
const hexTbody = byId('hex-tbody');
const hexCursorPos = byId('hex-cursor-pos');
const hexCursorVal = byId('hex-cursor-val');
const hexModifiedCount = byId('hex-modified-count');
const hexPageInfo = byId('hex-page-info');
const saveHint = byId('save-hint');
const toast = byId('toast');

// 상태 관리
let currentFileType = 'A'; // 'A' or 'B'
let currentRawBytes: number[] = [];  // Array of integers 0-255
let modifiedIndices = new Set<number>();
let selectedByteIndex = 0;
let hexPageIndex = 0;
const BYTES_PER_PAGE = 512; // 32 rows per page (빠른 렌더링)

// 6502 디스어셈블러 상태 & DOM
const binViewTabs = byId('bin-view-tabs');
const tabHex = byId('tab-hex');
const tabDisasm = byId('tab-disasm');
const disasmEditorWrapper = byId('disasm-editor-wrapper');
const disasmTbody = byId('disasm-tbody');
const disasmBaseAddrInput = byId<HTMLInputElement>('disasm-base-addr');
const disasmTotalInst = byId('disasm-total-inst');
const disasmPageInfo = byId('disasm-page-info');
const disasmGotoInput = byId<HTMLInputElement>('disasm-goto-input');

let currentBinView = 'hex'; // 'hex' or 'disasm'
let disasmBaseAddr = 0x0800;
let disasmInstructions: Instruction[] = [];
let disasmPageIndex = 0;
const DISASM_PER_PAGE = 80;

const APPLE2_SYMBOLS: Record<number, string> = {
  0xC000: 'KBD (키보드 입력 래치)',
  0xC010: 'KBDSTRB (키보드 스트로브 클리어)',
  0xC030: 'SPKR (스피커 토글 클릭)',
  0xC050: 'TXTCLR (그래픽 모드 전환)',
  0xC051: 'TXTSET (텍스트 모드 전환)',
  0xC052: 'MIXCLR (전체 화면 그래픽)',
  0xC053: 'MIXSET (혼합 그래픽 + 4행 텍스트)',
  0xC054: 'TXTPAGE1 (비디오 1페이지)',
  0xC055: 'TXTPAGE2 (비디오 2페이지)',
  0xC056: 'LORES (저해상도 그래픽)',
  0xC057: 'HIRES (고해상도 그래픽)',
  0xF800: 'PLOT (저해상도 점 찍기)',
  0xF819: 'HLIN (저해상도 수평선 긋기)',
  0xF828: 'VLIN (저해상도 수직선 긋기)',
  0xF836: 'GR (저해상도 그래픽 초기화)',
  0xFB60: 'TEXT (40컬럼 텍스트 모드 복귀)',
  0xFC58: 'HOME (화면 지우기 & 커서 좌상단)',
  0xFD0C: 'RDKEY (커서 깜빡이며 키 입력 대기)',
  0xFD1B: 'KEYIN (키보드 문자 1개 입력)',
  0xFD8E: 'CROUT (줄바꿈 CR 출력)',
  0xFDDA: 'PRHEX (Acc 값을 2자리 Hex로 출력)',
  0xFDE3: 'PRHEXZ (하위 4비트를 1자리 Hex 출력)',
  0xFDED: 'COUT (Acc 문자를 화면에 출력)',
  0xF3E2: 'HGR (고해상도 1페이지 켜고 화면 지우기)',
  0xF3D8: 'HGR2 (고해상도 2페이지 켜고 화면 지우기)',
  0xFF3A: 'BELL (비프 경고음 재생)',
  0xFF58: 'IORST (I/O 초기화)',
  0xFF65: 'MON (Apple II 모니터 * 프롬프트 진입)'
};

type AddrMode = 'IMP' | 'ACC' | 'IMM' | 'ZP' | 'ZPX' | 'ZPY' | 'ABS' | 'ABX' | 'ABY' | 'IND' | 'IAX' | 'IZX' | 'IZY' | 'INZ' | 'REL';

const OPCODES_6502: Record<number, [string, AddrMode, number]> = {
  0x00: ["BRK", "IMP", 1], 0x01: ["ORA", "IZX", 2], 0x04: ["TSB", "ZP", 2], 0x05: ["ORA", "ZP", 2], 0x06: ["ASL", "ZP", 2], 0x08: ["PHP", "IMP", 1], 0x09: ["ORA", "IMM", 2], 0x0A: ["ASL", "ACC", 1], 0x0C: ["TSB", "ABS", 3], 0x0D: ["ORA", "ABS", 3], 0x0E: ["ASL", "ABS", 3],
  0x10: ["BPL", "REL", 2], 0x11: ["ORA", "IZY", 2], 0x12: ["ORA", "INZ", 2], 0x14: ["TRB", "ZP", 2], 0x15: ["ORA", "ZPX", 2], 0x16: ["ASL", "ZPX", 2], 0x18: ["CLC", "IMP", 1], 0x19: ["ORA", "ABY", 3], 0x1A: ["INC", "ACC", 1], 0x1C: ["TRB", "ABS", 3], 0x1D: ["ORA", "ABX", 3], 0x1E: ["ASL", "ABX", 3],
  0x20: ["JSR", "ABS", 3], 0x21: ["AND", "IZX", 2], 0x24: ["BIT", "ZP", 2], 0x25: ["AND", "ZP", 2], 0x26: ["ROL", "ZP", 2], 0x28: ["PLP", "IMP", 1], 0x29: ["AND", "IMM", 2], 0x2A: ["ROL", "ACC", 1], 0x2C: ["BIT", "ABS", 3], 0x2D: ["AND", "ABS", 3], 0x2E: ["ROL", "ABS", 3],
  0x30: ["BMI", "REL", 2], 0x31: ["AND", "IZY", 2], 0x32: ["AND", "INZ", 2], 0x34: ["BIT", "ZPX", 2], 0x35: ["AND", "ZPX", 2], 0x36: ["ROL", "ZPX", 2], 0x38: ["SEC", "IMP", 1], 0x39: ["AND", "ABY", 3], 0x3A: ["DEC", "ACC", 1], 0x3C: ["BIT", "ABX", 3], 0x3D: ["AND", "ABX", 3], 0x3E: ["ROL", "ABX", 3],
  0x40: ["RTI", "IMP", 1], 0x41: ["EOR", "IZX", 2], 0x45: ["EOR", "ZP", 2], 0x46: ["LSR", "ZP", 2], 0x48: ["PHA", "IMP", 1], 0x49: ["EOR", "IMM", 2], 0x4A: ["LSR", "ACC", 1], 0x4C: ["JMP", "ABS", 3], 0x4D: ["EOR", "ABS", 3], 0x4E: ["LSR", "ABS", 3],
  0x50: ["BVC", "REL", 2], 0x51: ["EOR", "IZY", 2], 0x52: ["EOR", "INZ", 2], 0x55: ["EOR", "ZPX", 2], 0x56: ["LSR", "ZPX", 2], 0x58: ["CLI", "IMP", 1], 0x59: ["EOR", "ABY", 3], 0x5A: ["PHY", "IMP", 1], 0x5D: ["EOR", "ABX", 3], 0x5E: ["LSR", "ABX", 3],
  0x60: ["RTS", "IMP", 1], 0x61: ["ADC", "IZX", 2], 0x64: ["STZ", "ZP", 2], 0x65: ["ADC", "ZP", 2], 0x66: ["ROR", "ZP", 2], 0x68: ["PLA", "IMP", 1], 0x69: ["ADC", "IMM", 2], 0x6A: ["ROR", "ACC", 1], 0x6C: ["JMP", "IND", 3], 0x6D: ["ADC", "ABS", 3], 0x6E: ["ROR", "ABS", 3],
  0x70: ["BVS", "REL", 2], 0x71: ["ADC", "IZY", 2], 0x72: ["ADC", "INZ", 2], 0x74: ["STZ", "ZPX", 2], 0x75: ["ADC", "ZPX", 2], 0x76: ["ROR", "ZPX", 2], 0x78: ["SEI", "IMP", 1], 0x79: ["ADC", "ABY", 3], 0x7A: ["PLY", "IMP", 1], 0x7C: ["JMP", "IAX", 3], 0x7D: ["ADC", "ABX", 3], 0x7E: ["ROR", "ABX", 3],
  0x80: ["BRA", "REL", 2], 0x81: ["STA", "IZX", 2], 0x84: ["STY", "ZP", 2], 0x85: ["STA", "ZP", 2], 0x86: ["STX", "ZP", 2], 0x88: ["DEY", "IMP", 1], 0x89: ["BIT", "IMM", 2], 0x8A: ["TXA", "IMP", 1], 0x8C: ["STY", "ABS", 3], 0x8D: ["STA", "ABS", 3], 0x8E: ["STX", "ABS", 3],
  0x90: ["BCC", "REL", 2], 0x91: ["STA", "IZY", 2], 0x92: ["STA", "INZ", 2], 0x94: ["STY", "ZPX", 2], 0x95: ["STA", "ZPX", 2], 0x96: ["STX", "ZPY", 2], 0x98: ["TYA", "IMP", 1], 0x99: ["STA", "ABY", 3], 0x9A: ["TXS", "IMP", 1], 0x9C: ["STZ", "ABS", 3], 0x9D: ["STA", "ABX", 3], 0x9E: ["STZ", "ABX", 3],
  0xA0: ["LDY", "IMM", 2], 0xA1: ["LDA", "IZX", 2], 0xA2: ["LDX", "IMM", 2], 0xA4: ["LDY", "ZP", 2], 0xA5: ["LDA", "ZP", 2], 0xA6: ["LDX", "ZP", 2], 0xA8: ["TAY", "IMP", 1], 0xA9: ["LDA", "IMM", 2], 0xAA: ["TAX", "IMP", 1], 0xAC: ["LDY", "ABS", 3], 0xAD: ["LDA", "ABS", 3], 0xAE: ["LDX", "ABS", 3],
  0xB0: ["BCS", "REL", 2], 0xB1: ["LDA", "IZY", 2], 0xB2: ["LDA", "INZ", 2], 0xB4: ["LDY", "ZPX", 2], 0xB5: ["LDA", "ZPX", 2], 0xB6: ["LDX", "ZPY", 2], 0xB8: ["CLV", "IMP", 1], 0xB9: ["LDA", "ABY", 3], 0xBA: ["TSX", "IMP", 1], 0xBC: ["LDY", "ABX", 3], 0xBD: ["LDA", "ABX", 3], 0xBE: ["LDX", "ABY", 3],
  0xC0: ["CPY", "IMM", 2], 0xC1: ["CMP", "IZX", 2], 0xC4: ["CPY", "ZP", 2], 0xC5: ["CMP", "ZP", 2], 0xC6: ["DEC", "ZP", 2], 0xC8: ["INY", "IMP", 1], 0xC9: ["CMP", "IMM", 2], 0xCA: ["DEX", "IMP", 1], 0xCC: ["CPY", "ABS", 3], 0xCD: ["CMP", "ABS", 3], 0xCE: ["DEC", "ABS", 3],
  0xD0: ["BNE", "REL", 2], 0xD1: ["CMP", "IZY", 2], 0xD2: ["CMP", "INZ", 2], 0xD5: ["CMP", "ZPX", 2], 0xD6: ["DEC", "ZPX", 2], 0xD8: ["CLD", "IMP", 1], 0xD9: ["CMP", "ABY", 3], 0xDA: ["PHX", "IMP", 1], 0xDD: ["CMP", "ABX", 3], 0xDE: ["DEC", "ABX", 3],
  0xE0: ["CPX", "IMM", 2], 0xE1: ["SBC", "IZX", 2], 0xE4: ["CPX", "ZP", 2], 0xE5: ["SBC", "ZP", 2], 0xE6: ["INC", "ZP", 2], 0xE8: ["INX", "IMP", 1], 0xE9: ["SBC", "IMM", 2], 0xEA: ["NOP", "IMP", 1], 0xEC: ["CPX", "ABS", 3], 0xED: ["SBC", "ABS", 3], 0xEE: ["INC", "ABS", 3],
  0xF0: ["BEQ", "REL", 2], 0xF1: ["SBC", "IZY", 2], 0xF2: ["SBC", "INZ", 2], 0xF5: ["SBC", "ZPX", 2], 0xF6: ["INC", "ZPX", 2], 0xF8: ["SED", "IMP", 1], 0xF9: ["SBC", "ABY", 3], 0xFA: ["PLX", "IMP", 1], 0xFD: ["SBC", "ABX", 3], 0xFE: ["INC", "ABX", 3]
};

function showToast(msg: string): void {
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// 파일 목록 조회
async function loadFiles(): Promise<void> {
  try {
    const res = await fetch(`/api/files?${diskQS()}`);
    const data: { error?: string; files?: CatalogFile[] } = await res.json();
    if (data.error) {
      fileCount.textContent = '0';
      fileTable.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--amber); padding:24px;">${escapeHtml(data.error)}</td></tr>`;
      return;
    }
    if (!data.files || data.files.length === 0) {
      fileCount.textContent = '0';
      fileTable.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-dim); padding:24px;">DOS 3.3 카탈로그에 파일이 없습니다${currentDisk === 'remote' ? ' (DOS 3.3 디스크가 아니거나 빈 디스크일 수 있습니다)' : ''}.</td></tr>`;
      return;
    }
    if (data.files && data.files.length > 0) {
      fileCount.textContent = String(data.files.length);
      fileTable.innerHTML = '';
      data.files.forEach(f => {
        const tr = document.createElement('tr');
        tr.id = `row-${f.name}`;

        let tagClass = 'tag-a';
        if (f.type === 'B') tagClass = 'tag-b';
        else if (f.type === 'I') tagClass = 'tag-i';

        // Names can hold spaces or control characters (e.g. U4's "I^ANIT"),
        // so they are shown visibly and passed to handlers as data, not
        // spliced into onclick strings.
        const shown = f.name.replace(/[\x00-\x1f]/g, (c) => '^' + String.fromCharCode(c.charCodeAt(0) + 64));
        tr.innerHTML = `
          <td><span class="tag ${tagClass}">[${escapeHtml(f.type)}]</span></td>
          <td class="file-name" style="font-weight: bold; color: #d6ffd6; font-size: 14px;">${escapeHtml(shown)}</td>
          <td style="text-align: right;">
            <button class="btn btn-danger write-only" style="padding: 2px 7px; font-size: 11px;">삭제</button>
          </td>
        `;
        tr.querySelector('.file-name')!.addEventListener('click', () => openFile(f.name, f.type));
        tr.querySelector('.btn-danger')!.addEventListener('click', () => deleteFile(f.name));
        fileTable.appendChild(tr);
      });
    }
  } catch (e) {
    fileTable.innerHTML = `<tr><td colspan="3" style="color:var(--red);">오류: ${(e as Error).message}</td></tr>`;
  }
}

// 파일 열기 (BASIC vs BINARY 자동 분기)
async function openFile(filename: string, type: string): Promise<void> {
  currentFileType = type || 'A';
  targetFilename.value = filename;
  editorTitle.textContent = `📝 파일 편집: ${filename}`;

  // 활성 행 스타일 표시
  document.querySelectorAll('#file-table tr').forEach(r => r.classList.remove('active-file'));
  const activeRow = document.getElementById(`row-${filename}`);
  if (activeRow) activeRow.classList.add('active-file');

  if (currentFileType === 'B') {
    // --- BINARY FILE -> HEX & 6502 DISASSEMBLY ---
    editorTypeTag.className = 'tag tag-b';
    editorTypeTag.textContent = '[B] Binary File';
    binViewTabs.style.display = 'flex';
    basicEditor.style.display = 'none';
    setBinViewMode('hex');

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}?type=B&${diskQS()}`);
      const data: { hex?: string } = await res.json();
      if (data.hex) {
        // Hex 문자열을 바이트 배열로 변환
        currentRawBytes = [];
        for (let i = 0; i < data.hex.length; i += 2) {
          currentRawBytes.push(parseInt(data.hex.substr(i, 2), 16));
        }
        modifiedIndices.clear();
        selectedByteIndex = 0;
        hexPageIndex = 0;
        disasmPageIndex = 0;
        editorSizeInfo.textContent = `크기: ${currentRawBytes.length.toLocaleString()} 바이트`;
        renderHexPage();
        updateDisassembly();
        showToast(`'${filename}' 바이너리 로드 완료 (${currentRawBytes.length} bytes)`);
      }
    } catch (e) {
      alert('바이너리 로드 실패: ' + (e as Error).message);
    }
  } else {
    // --- BASIC / TEXT FILE -> TEXT EDITOR ---
    editorTypeTag.className = 'tag tag-a';
    editorTypeTag.textContent = '[A] Applesoft BASIC';
    binViewTabs.style.display = 'none';
    hexEditorWrapper.style.display = 'none';
    disasmEditorWrapper.style.display = 'none';
    basicEditor.style.display = 'block';
    saveHint.textContent = 'BASIC 코드를 수정한 뒤 [디스크에 저장]을 누르세요.';

    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}?${diskQS()}`);
      const data: { content?: string } = await res.json();
      basicEditor.value = data.content || '';
      editorSizeInfo.textContent = `텍스트 모드`;
      showToast(`'${filename}' BASIC 소스 로드 완료`);
    } catch (e) {
      basicEditor.value = '로드 오류: ' + (e as Error).message;
    }
  }
}

// =========================================================
// HEX EDITOR INTERACTIVE RENDER & KEYBOARD HANDLING
// =========================================================
function renderHexPage(): void {
  hexTbody.innerHTML = '';
  const totalBytes = currentRawBytes.length;
  const totalPages = Math.max(1, Math.ceil(totalBytes / BYTES_PER_PAGE));
  hexPageInfo.textContent = `${hexPageIndex + 1} / ${totalPages}`;
  hexModifiedCount.textContent = String(modifiedIndices.size);

  const startIdx = hexPageIndex * BYTES_PER_PAGE;
  const endIdx = Math.min(startIdx + BYTES_PER_PAGE, totalBytes);

  for (let offset = startIdx; offset < endIdx; offset += 16) {
    const tr = document.createElement('tr');

    // 1. Offset Column ($000000)
    const tdOffset = document.createElement('td');
    tdOffset.className = 'col-offset';
    tdOffset.textContent = '$' + offset.toString(16).toUpperCase().padStart(6, '0');
    tr.appendChild(tdOffset);

    // 2. Hex Bytes Column (16 bytes)
    const tdHex = document.createElement('td');
    const hexGroup = document.createElement('div');
    hexGroup.className = 'col-hex-group';

    // 3. ASCII Column
    const tdAscii = document.createElement('td');
    tdAscii.className = 'col-ascii-group';

    for (let i = 0; i < 16; i++) {
      const byteIdx = offset + i;
      if (i === 8) {
        // 8바이트 구분 공간
        const sep = document.createElement('span');
        sep.className = 'hex-sep';
        hexGroup.appendChild(sep);
      }

      if (byteIdx < totalBytes) {
        const b = currentRawBytes[byteIdx];
        const hexStr = b.toString(16).toUpperCase().padStart(2, '0');

        // Hex 셀
        const spanByte = document.createElement('span');
        spanByte.className = 'hex-byte';
        spanByte.id = `byte-${byteIdx}`;
        spanByte.textContent = hexStr;
        if (modifiedIndices.has(byteIdx)) spanByte.classList.add('modified');
        if (byteIdx === selectedByteIndex) spanByte.classList.add('active');

        // 클릭 포커스
        spanByte.onclick = () => selectByte(byteIdx);

        hexGroup.appendChild(spanByte);

        // ASCII 셀
        const spanChar = document.createElement('span');
        spanChar.className = 'ascii-char';
        spanChar.id = `ascii-${byteIdx}`;
        const isPrintable = (b >= 32 && b <= 126);
        spanChar.textContent = isPrintable ? String.fromCharCode(b) : '.';
        if (!isPrintable) spanChar.classList.add('non-printable');
        if (modifiedIndices.has(byteIdx)) spanChar.classList.add('modified');
        if (byteIdx === selectedByteIndex) spanChar.classList.add('active');

        spanChar.onclick = () => selectByte(byteIdx);

        tdAscii.appendChild(spanChar);
      }
    }

    tdHex.appendChild(hexGroup);
    tr.appendChild(tdHex);
    tr.appendChild(tdAscii);
    hexTbody.appendChild(tr);
  }

  updateCursorInfo();
}

function selectByte(idx: number): void {
  if (idx < 0 || idx >= currentRawBytes.length) return;
  selectedByteIndex = idx;

  // 이전 활성 상태 해제
  document.querySelectorAll('.hex-byte.active, .ascii-char.active').forEach(el => el.classList.remove('active'));

  // 새 활성 셀 표시
  const byteEl = document.getElementById(`byte-${idx}`);
  const asciiEl = document.getElementById(`ascii-${idx}`);
  if (byteEl) byteEl.classList.add('active');
  if (asciiEl) asciiEl.classList.add('active');

  updateCursorInfo();
}

function updateCursorInfo(): void {
  if (currentRawBytes.length === 0) return;
  hexCursorPos.textContent = '$' + selectedByteIndex.toString(16).toUpperCase().padStart(6, '0');
  const val = currentRawBytes[selectedByteIndex];
  const hexStr = val.toString(16).toUpperCase().padStart(2, '0');
  const charStr = (val >= 32 && val <= 126) ? `'${String.fromCharCode(val)}'` : '(비출력)';
  hexCursorVal.textContent = `${hexStr} (${charStr})`;
}

// 키보드로 실시간 HEX 편집 (0-9, A-F)
let hexNibbleInput = false;
let firstNibble = 0;

window.addEventListener('keydown', (e) => {
  if (currentFileType !== 'B') return;
  if (document.activeElement === targetFilename) return;

  const key = e.key.toUpperCase();

  // 방향키 이동
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    hexNibbleInput = false;
    selectByteNext(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    hexNibbleInput = false;
    selectByteNext(-1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    hexNibbleInput = false;
    selectByteNext(16);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    hexNibbleInput = false;
    selectByteNext(-16);
  }
  // 16진수 입력 (0-9, A-F)
  else if (/^[0-9A-F]$/.test(key)) {
    e.preventDefault();
    const nibbleVal = parseInt(key, 16);

    if (!hexNibbleInput) {
      // 상위 니블(첫 번째 자리) 입력
      firstNibble = nibbleVal;
      hexNibbleInput = true;
      const byteEl = document.getElementById(`byte-${selectedByteIndex}`);
      if (byteEl) byteEl.textContent = key + '_';
    } else {
      // 하위 니블(두 번째 자리) 입력 완료 -> 바이트 확정!
      const newByte = (firstNibble << 4) | nibbleVal;
      hexNibbleInput = false;

      // 실제 데이터 수정
      currentRawBytes[selectedByteIndex] = newByte;
      modifiedIndices.add(selectedByteIndex);

      // UI 실시간 동기화 (Hex + ASCII)
      updateByteDom(selectedByteIndex, newByte);

      // 자동으로 다음 바이트로 이동!
      selectByteNext(1);
    }
  }
});

function selectByteNext(step: number): void {
  const nextIdx = selectedByteIndex + step;
  if (nextIdx >= 0 && nextIdx < currentRawBytes.length) {
    // 페이지 범위 벗어나면 페이지 자동 이동
    const targetPage = Math.floor(nextIdx / BYTES_PER_PAGE);
    if (targetPage !== hexPageIndex) {
      hexPageIndex = targetPage;
      renderHexPage();
    }
    selectByte(nextIdx);
  }
}

function updateByteDom(idx: number, val: number): void {
  const hexStr = val.toString(16).toUpperCase().padStart(2, '0');
  const isPrintable = (val >= 32 && val <= 126);
  const charStr = isPrintable ? String.fromCharCode(val) : '.';

  const byteEl = document.getElementById(`byte-${idx}`);
  const asciiEl = document.getElementById(`ascii-${idx}`);

  if (byteEl) {
    byteEl.textContent = hexStr;
    byteEl.classList.add('modified');
  }
  if (asciiEl) {
    asciiEl.textContent = charStr;
    asciiEl.classList.add('modified');
    if (!isPrintable) asciiEl.classList.add('non-printable');
    else asciiEl.classList.remove('non-printable');
  }

  hexModifiedCount.textContent = String(modifiedIndices.size);
  updateCursorInfo();
}

function prevHexPage(): void {
  if (hexPageIndex > 0) {
    hexPageIndex--;
    renderHexPage();
  }
}

function nextHexPage(): void {
  const totalPages = Math.ceil(currentRawBytes.length / BYTES_PER_PAGE);
  if (hexPageIndex < totalPages - 1) {
    hexPageIndex++;
    renderHexPage();
  }
}

// =========================================================
// 6502 DISASSEMBLER LOGIC & RENDER
// =========================================================
function setBinViewMode(mode: 'hex' | 'disasm'): void {
  currentBinView = mode;
  if (mode === 'hex') {
    tabHex.classList.add('active');
    tabDisasm.classList.remove('active');
    hexEditorWrapper.style.display = 'flex';
    disasmEditorWrapper.style.display = 'none';
    saveHint.textContent = 'Hex 코드를 클릭하고 원하는 16진수(0-9, A-F)를 입력하면 즉시 수정됩니다.';
    renderHexPage();
  } else {
    tabHex.classList.remove('active');
    tabDisasm.classList.add('active');
    hexEditorWrapper.style.display = 'none';
    disasmEditorWrapper.style.display = 'flex';
    saveHint.textContent = '명령어 행을 클릭하면 Hex Editor의 해당 바이트 위치로 바로 이동합니다.';
    updateDisassembly();
  }
}

function onDisasmBaseChange(): void {
  let val = disasmBaseAddrInput.value.trim().replace(/^\$/, '');
  let parsed = parseInt(val, 16);
  if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xFFFF) {
    disasmBaseAddr = parsed;
    disasmBaseAddrInput.value = '$' + disasmBaseAddr.toString(16).padStart(4, '0').toUpperCase();
    updateDisassembly();
  } else {
    alert('올바른 16진수 주소(0000~FFFF)를 입력하세요.');
    disasmBaseAddrInput.value = '$' + disasmBaseAddr.toString(16).padStart(4, '0').toUpperCase();
  }
}

function disassembleBuffer(bytes: number[], baseAddr: number): Instruction[] {
  const instructions: Instruction[] = [];
  let offset = 0;
  const len = bytes.length;

  while (offset < len) {
    const addr = (baseAddr + offset) & 0xFFFF;
    const op = bytes[offset];
    const info = OPCODES_6502[op];

    if (!info) {
      instructions.push({
        offset,
        addr,
        bytes: [op],
        mnemonic: '.BYTE',
        operand: '$' + op.toString(16).padStart(2, '0').toUpperCase(),
        comment: ''
      });
      offset += 1;
      continue;
    }

    const [mnemonic, mode, size] = info;
    const instBytes: number[] = [];
    for (let i = 0; i < size; i++) {
      if (offset + i < len) {
        instBytes.push(bytes[offset + i]);
      } else {
        instBytes.push(0);
      }
    }

    const b1 = instBytes[1] !== undefined ? instBytes[1] : 0;
    const b2 = instBytes[2] !== undefined ? instBytes[2] : 0;
    let operand = '';
    let comment = '';
    let target: number | null = null;

    switch (mode) {
      case 'IMP': operand = ''; break;
      case 'ACC': operand = 'A'; break;
      case 'IMM': operand = '#$' + b1.toString(16).padStart(2, '0').toUpperCase(); break;
      case 'ZP':
        operand = '$' + b1.toString(16).padStart(2, '0').toUpperCase();
        target = b1;
        break;
      case 'ZPX': operand = '$' + b1.toString(16).padStart(2, '0').toUpperCase() + ',X'; break;
      case 'ZPY': operand = '$' + b1.toString(16).padStart(2, '0').toUpperCase() + ',Y'; break;
      case 'ABS':
        target = b1 | (b2 << 8);
        operand = '$' + target.toString(16).padStart(4, '0').toUpperCase();
        break;
      case 'ABX':
        target = b1 | (b2 << 8);
        operand = '$' + target.toString(16).padStart(4, '0').toUpperCase() + ',X';
        break;
      case 'ABY':
        target = b1 | (b2 << 8);
        operand = '$' + target.toString(16).padStart(4, '0').toUpperCase() + ',Y';
        break;
      case 'IND':
        target = b1 | (b2 << 8);
        operand = '($' + target.toString(16).padStart(4, '0').toUpperCase() + ')';
        break;
      case 'IAX':
        target = b1 | (b2 << 8);
        operand = '($' + target.toString(16).padStart(4, '0').toUpperCase() + ',X)';
        break;
      case 'IZX': operand = '($' + b1.toString(16).padStart(2, '0').toUpperCase() + ',X)'; break;
      case 'IZY': operand = '($' + b1.toString(16).padStart(2, '0').toUpperCase() + '),Y'; break;
      case 'INZ': operand = '($' + b1.toString(16).padStart(2, '0').toUpperCase() + ')'; break;
      case 'REL': {
        const rel = (b1 >= 128) ? (b1 - 256) : b1;
        target = (addr + 2 + rel) & 0xFFFF;
        operand = '$' + target.toString(16).padStart(4, '0').toUpperCase();
        comment = `분기 -> $${target.toString(16).padStart(4, '0').toUpperCase()}`;
        break;
      }
    }

    if (target !== null && APPLE2_SYMBOLS[target]) {
      comment = (comment ? comment + ' | ' : '') + APPLE2_SYMBOLS[target];
    }

    instructions.push({
      offset,
      addr,
      bytes: instBytes,
      mnemonic,
      operand,
      comment
    });

    offset += size;
  }

  return instructions;
}

function updateDisassembly(): void {
  disasmInstructions = disassembleBuffer(currentRawBytes, disasmBaseAddr);
  disasmTotalInst.textContent = disasmInstructions.length.toLocaleString();
  renderDisasmPage();
}

function renderDisasmPage(): void {
  disasmTbody.innerHTML = '';
  const totalInst = disasmInstructions.length;
  const totalPages = Math.max(1, Math.ceil(totalInst / DISASM_PER_PAGE));
  if (disasmPageIndex >= totalPages) disasmPageIndex = totalPages - 1;
  if (disasmPageIndex < 0) disasmPageIndex = 0;

  disasmPageInfo.textContent = `${disasmPageIndex + 1} / ${totalPages}`;

  const startIdx = disasmPageIndex * DISASM_PER_PAGE;
  const endIdx = Math.min(startIdx + DISASM_PER_PAGE, totalInst);

  for (let i = startIdx; i < endIdx; i++) {
    const item = disasmInstructions[i];
    const tr = document.createElement('tr');
    tr.onclick = () => jumpFromDisasmToHex(item.offset);
    tr.title = `오프셋 $${item.offset.toString(16).toUpperCase().padStart(6, '0')} 클릭 시 Hex 에디터로 이동`;

    const hexStr = item.bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    tr.innerHTML = `
      <td class="col-disasm-addr">$${item.addr.toString(16).padStart(4, '0').toUpperCase()}</td>
      <td class="col-disasm-bytes">${hexStr}</td>
      <td class="col-disasm-inst">
        <span class="disasm-mnemonic">${item.mnemonic}</span>
        <span class="disasm-operand">${escapeHtml(item.operand)}</span>
      </td>
      <td class="col-disasm-comment">${item.comment ? '; ' + escapeHtml(item.comment) : ''}</td>
    `;
    disasmTbody.appendChild(tr);
  }
}

function prevDisasmPage(): void {
  if (disasmPageIndex > 0) {
    disasmPageIndex--;
    renderDisasmPage();
  }
}

function nextDisasmPage(): void {
  const totalPages = Math.ceil(disasmInstructions.length / DISASM_PER_PAGE);
  if (disasmPageIndex < totalPages - 1) {
    disasmPageIndex++;
    renderDisasmPage();
  }
}

function gotoDisasmAddr(): void {
  const val = disasmGotoInput.value.trim().replace(/^\$/, '');
  if (!val) return;
  const targetAddr = parseInt(val, 16);
  if (isNaN(targetAddr)) {
    alert('올바른 16진수 주소를 입력하세요 (예: 0820 또는 $FDED).');
    return;
  }

  let foundIdx = -1;
  for (let i = 0; i < disasmInstructions.length; i++) {
    if (disasmInstructions[i].addr >= targetAddr) {
      foundIdx = i;
      break;
    }
  }

  if (foundIdx === -1 && disasmInstructions.length > 0) {
    foundIdx = disasmInstructions.length - 1;
  }

  if (foundIdx !== -1) {
    disasmPageIndex = Math.floor(foundIdx / DISASM_PER_PAGE);
    renderDisasmPage();
    showToast(`주소 $${targetAddr.toString(16).padStart(4, '0').toUpperCase()} 이동 완료`);
  }
}

function jumpFromDisasmToHex(byteOffset: number): void {
  setBinViewMode('hex');
  hexPageIndex = Math.floor(byteOffset / BYTES_PER_PAGE);
  renderHexPage();
  selectByte(byteOffset);
  showToast(`Hex 오프셋 $${byteOffset.toString(16).padStart(6, '0').toUpperCase()} 로 이동`);
}

// 새 BASIC 파일 작성
function startNewBasicFile(): void {
  currentFileType = 'A';
  targetFilename.value = '';
  editorTitle.textContent = '📝 새 BASIC 파일 작성';
  editorTypeTag.className = 'tag tag-a';
  editorTypeTag.textContent = '[A] Applesoft BASIC';
  binViewTabs.style.display = 'none';
  hexEditorWrapper.style.display = 'none';
  disasmEditorWrapper.style.display = 'none';
  basicEditor.style.display = 'block';
  linterWarningBox.style.display = 'none';
  basicEditor.value = '10 TEXT : HOME\n20 PRINT "HELLO FROM APPLE //e!"\n30 PRINT "WEB FILE MANAGER"\n40 END';
  editorSizeInfo.textContent = '새 파일';
  targetFilename.focus();
}

// 파일 저장 (BASIC vs BINARY 실시간 변환 저장 & 디스크 락 & Linter)
async function saveCurrentFile(): Promise<void> {
  const filename = targetFilename.value.trim().toUpperCase();
  if (!filename) {
    alert('파일명을 입력해주세요.');
    targetFilename.focus();
    return;
  }

  linterWarningBox.style.display = 'none';
  const saveBtn = document.querySelector<HTMLButtonElement>('.editor-footer button');
  const origText = saveBtn ? saveBtn.textContent : '';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '🔒 디스크 안전 동기화 중...';
  }

  try {
    if (currentFileType === 'B') {
      // 바이너리 Hex 저장
      const hexData = currentRawBytes.map(b => b.toString(16).padStart(2, '0')).join('');
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, type: 'B', hex: hexData })
      });
      const d: { success?: boolean; error?: string } = await res.json();
      if (d.success) {
        modifiedIndices.clear();
        renderHexPage();
        showToast(`💾 바이너리 '${filename}' (${currentRawBytes.length}B) 저장 완료! (스냅샷 백업 생성) Apple II에서 CATALOG 또는 F2를 누르세요.`);
        loadFiles();
      } else {
        alert('저장 실패: ' + d.error);
      }
    } else {
      // BASIC 텍스트 저장
      const content = basicEditor.value;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, type: 'A', content })
      });
      const d: { success?: boolean; error?: string; warnings?: string[] } = await res.json();
      if (d.success) {
        if (d.warnings && d.warnings.length > 0) {
          linterWarningBox.style.display = 'block';
          linterWarningText.textContent = d.warnings.join(' ');
          showToast('⚠️ [경고] OPEN 파일 미닫힘 감지! 안전 알림을 확인하세요.');
        } else {
          showToast(`💾 BASIC '${filename}' 저장 완료! (스냅샷 백업 생성) Apple II에서 CATALOG 또는 F2를 누르세요.`);
        }
        loadFiles();
      } else {
        alert('저장 실패: ' + d.error);
      }
    }
  } catch (e) {
    alert('저장 통신 오류: ' + (e as Error).message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = origText;
    }
  }
}

// 파일 삭제
async function deleteFile(filename: string): Promise<void> {
  if (!confirm(`'${filename}' 파일을 디스크에서 삭제하시겠습니까?\n(삭제 직전의 상태가 스냅샷으로 자동 백업됩니다.)`)) return;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const d: { success?: boolean } = await res.json();
    if (d.success) {
      showToast(`🗑️ '${filename}' 삭제 완료 (스냅샷 백업 생성됨)`);
      if (targetFilename.value === filename) startNewBasicFile();
      loadFiles();
    }
  } catch (e) {
    alert('삭제 오류: ' + (e as Error).message);
  }
}

// 디스크 스냅샷 백업 & 롤백 기능
const linterWarningBox = byId('linter-warning-box');
const linterWarningText = byId('linter-warning-text');
const snapshotModal = byId('snapshot-modal');
const snapshotTbody = byId('snapshot-tbody');

async function openSnapshotModal(): Promise<void> {
  snapshotModal.style.display = 'flex';
  await loadSnapshots();
}

function closeSnapshotModal(): void {
  snapshotModal.style.display = 'none';
}

async function loadSnapshots(): Promise<void> {
  try {
    const res = await fetch('/api/backups');
    const data: { backups?: { filename: string; size: number; mtime: string }[] } = await res.json();
    if (data.backups && data.backups.length > 0) {
      snapshotTbody.innerHTML = '';
      data.backups.forEach(b => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #142214';
        tr.innerHTML = `
          <td style="padding: 7px 10px; color: #a3d9a3; font-family: monospace;">${escapeHtml(b.filename)}</td>
          <td style="padding: 7px 10px; color: var(--text-dim);">${escapeHtml(b.mtime)}</td>
          <td style="padding: 7px 10px; text-align: right;">
            <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px; color: var(--amber);" onclick="rollbackSnapshot('${escapeHtml(b.filename)}')">🔄 이 시점으로 복원</button>
          </td>
        `;
        snapshotTbody.appendChild(tr);
      });
    } else {
      snapshotTbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 15px; color: var(--text-dim);">저장된 스냅샷이 없습니다.</td></tr>';
    }
  } catch (e) {
    snapshotTbody.innerHTML = `<tr><td colspan="3" style="color:var(--red); padding:10px;">오류: ${(e as Error).message}</td></tr>`;
  }
}

async function createManualSnapshot(): Promise<void> {
  try {
    const res = await fetch('/api/backups/create', { method: 'POST' });
    const d: { success?: boolean; error?: string } = await res.json();
    if (d.success) {
      showToast('📸 새 디스크 스냅샷 백업 생성 완료');
      loadSnapshots();
    } else {
      alert('스냅샷 생성 실패: ' + d.error);
    }
  } catch (e) {
    alert('통신 오류: ' + (e as Error).message);
  }
}

async function rollbackSnapshot(filename: string): Promise<void> {
  if (!confirm(`'${filename}' 시점으로 디스크를 롤백하시겠습니까?\n(현재 디스크 상태도 자동 백업됩니다.)`)) return;
  try {
    const res = await fetch('/api/backups/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    const d: { success?: boolean; message: string; error?: string } = await res.json();
    if (d.success) {
      showToast(d.message);
      closeSnapshotModal();
      loadFiles();
      startNewBasicFile();
    } else {
      alert('복원 실패: ' + d.error);
    }
  } catch (e) {
    alert('통신 오류: ' + (e as Error).message);
  }
}

function escapeHtml(s: unknown): string {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =========================================================
// 디스크 소스: 로컬 DSK / STM32 에뮬레이터 드라이브 1 (SSC)
// =========================================================
let currentDisk = 'local';
let remotePollTimer: number | undefined;
const diskSourceSel = byId<HTMLSelectElement>('disk-source');
const remoteSyncBtn = byId<HTMLButtonElement>('remote-sync-btn');
const remoteQuitBtn = byId('remote-quit-btn');
const sscDot = byId('ssc-dot');
const sscLabel = byId('ssc-label');
const remoteProgress = byId('remote-progress');
const remoteMsg = byId('remote-msg');

function diskQS(): string {
  return `disk=${encodeURIComponent(currentDisk)}`;
}

function setDiskSource(src: string): void {
  currentDisk = (src === 'remote' || src === 'stm32') ? 'remote' : 'local';
  diskSourceSel.value = currentDisk;
  try { localStorage.setItem('a2web.disk', currentDisk); } catch (e) {}
  document.body.classList.toggle('read-only', currentDisk === 'remote');
  byId<HTMLAnchorElement>('download-link').href = `/api/download/dsk?${diskQS()}`;
  document.querySelector('.subtitle')!.textContent = currentDisk === 'remote'
    ? '디스크: Apple II 드라이브 1 (SSC로 읽은 사본, 읽기 전용)'
    : '디스크 이미지: apple2-web.dsk • BASIC 소스 & 바이너리 실시간 편집기';
  startNewBasicFile();
  loadFiles();
}

function renderRemoteStatus(s: RemoteStatus): void {
  const busy = s.busy;
  const linkName = s.link === 'serial' ? '실기' : s.link === 'stm32' ? 'STM32' : 'SSC';
  sscDot.className = 'dot ' + (s.phase === 'error' ? 'err' : busy ? 'busy' : s.sscConnected ? 'on' : '');
  sscLabel.textContent = !s.available ? 'SSC 브릿지 꺼짐'
    : s.sscConnected ? `${linkName} ${s.target}${s.serverRunning ? ' · A2SRV 실행 중' : ''}`
    : `${linkName} ${s.target} 연결 안 됨`;
  remoteSyncBtn.disabled = busy || !s.sscConnected;
  remoteQuitBtn.style.display = s.serverRunning && !busy ? '' : 'none';
  remoteProgress.style.display = busy ? 'block' : 'none';
  (remoteProgress.firstElementChild as HTMLElement).style.width = `${s.total ? Math.round(100 * s.done / s.total) : 3}%`;
  let msg = s.message || '';
  if (s.phase === 'reading' && s.total) msg = `트랙 ${s.done}/${s.total} 읽는 중...`;
  else if (!busy && s.snapshot && s.phase !== 'error') {
    msg = `마지막 읽기: ${new Date(s.snapshot.mtime).toLocaleString()}`;
    if (s.lastSync) {
      msg += ` · ${s.lastSync.tracksRead}트랙`;
      if (s.lastSync.unreadable && s.lastSync.unreadable.length) msg += ` · 읽지 못한 섹터 ${s.lastSync.unreadable.length}개`;
    }
  }
  remoteMsg.textContent = msg;
  remoteMsg.style.color = s.phase === 'error' ? 'var(--red)' : '';
  const hist = byId('remote-cmd-history');
  if (s.typed) {
    const uniq = [...new Set(s.typed.map((t) => t.text).filter((t) => t && !t.startsWith('<')).reverse())];
    hist.innerHTML = uniq.map((t) => `<option value="${escapeHtml(t).replace(/"/g, '&quot;')}">`).join('');
  }
}

// ---- 원격 키보드 (웹 → SSC → Apple) ----
const remoteCmd = byId<HTMLInputElement>('remote-cmd');
const remoteTypeMsg = byId('remote-type-msg');

// 키 전송 경로: SSC 또는 오디오(PC 소리 → Apple 카세트 IN)
let remoteVia = 'ssc';
function setRemoteVia(v: string): void {
  remoteVia = v === 'audio' ? 'audio' : 'ssc';
  byId<HTMLSelectElement>('remote-via').value = remoteVia;
  byId('remote-wav-link').style.display = remoteVia === 'audio' ? '' : 'none';
  try { localStorage.setItem('a2web.via', remoteVia); } catch (e) {}
}
try { setRemoteVia(localStorage.getItem('a2web.via') || 'ssc'); } catch (e) { setRemoteVia('ssc'); }

function downloadRemoteWav(): boolean {
  const text = prepText(remoteCmd.value);
  window.location.href = `/api/remote/audio.wav?text=${encodeURIComponent(text)}`;
  return false;
}

async function postType(payload: { text?: string; enter?: boolean; key?: string }, label: string): Promise<boolean> {
  const body = Object.assign({ via: remoteVia }, payload);
  remoteTypeMsg.textContent = remoteVia === 'audio' ? `🔊 소리 재생 중: ${label}` : `보내는 중: ${label}`;
  try {
    const res = await fetch('/api/remote/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d: { error?: string; via?: string; seconds: number } = await res.json();
    if (!res.ok) {
      remoteTypeMsg.textContent = '';
      alert('입력 실패: ' + d.error);
      return false;
    }
    const how = d.via === 'audio' ? ` (🔊 ${d.seconds.toFixed(1)}초)` : '';
    remoteTypeMsg.textContent = `✔ ${new Date().toLocaleTimeString()} ${label}${how}`;
    pollRemoteStatus();
    return true;
  } catch (e) {
    remoteTypeMsg.textContent = '';
    alert('통신 오류: ' + (e as Error).message);
    return false;
  }
}

function prepText(t: string): string {
  return byId<HTMLInputElement>('remote-upper').checked ? t.toUpperCase() : t;
}

async function sendRemoteCommand(): Promise<void> {
  const text = prepText(remoteCmd.value);
  if (await postType({ text, enter: true }, text || '(RETURN)')) remoteCmd.value = '';
  remoteCmd.focus();
}

function sendRemoteKey(key: string): void {
  postType({ key }, key.toUpperCase());
}

function toggleMultiline(): void {
  const box = byId('multiline-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function sendRemoteMultiline(): Promise<void> {
  const ta = byId<HTMLTextAreaElement>('remote-multi');
  const text = prepText(ta.value.replace(/\r\n/g, '\n').replace(/\n+$/, ''));
  if (!text) return;
  const n = text.split('\n').length;
  if (await postType({ text, enter: true }, `${n}줄`)) ta.value = '';
}

async function pollRemoteStatus(): Promise<RemoteStatus | null> {
  try {
    const res = await fetch('/api/remote/status');
    const s: RemoteStatus = await res.json();
    renderRemoteStatus(s);
    return s;
  } catch (e) {
    sscLabel.textContent = '서버 응답 없음';
    return null;
  }
}

async function syncRemoteDisk(): Promise<void> {
  try {
    const res = await fetch('/api/remote/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full: byId<HTMLInputElement>('remote-full').checked })
    });
    const d: { error?: string } = await res.json();
    if (!res.ok) {
      alert('Apple 디스크 읽기 실패: ' + d.error);
      return;
    }
    showToast('📡 Apple 드라이브 1을 SSC로 읽는 중...');
    clearInterval(remotePollTimer);
    remotePollTimer = setInterval(async () => {
      const s = await pollRemoteStatus();
      if (!s || s.busy) return;
      clearInterval(remotePollTimer);
      if (s.phase === 'done') {
        showToast('✅ Apple 드라이브 1 읽기 완료');
        setDiskSource('remote');
      } else if (s.phase === 'error') {
        alert(s.message);
      }
    }, 700);
  } catch (e) {
    alert('통신 오류: ' + (e as Error).message);
  }
}

async function quitRemoteServer(): Promise<void> {
  try {
    const res = await fetch('/api/remote/quit', { method: 'POST' });
    const d: { success?: boolean; message?: string; error?: string } = await res.json();
    showToast(d.success ? d.message! : '종료 실패: ' + d.error);
  } catch (e) {
    alert('통신 오류: ' + (e as Error).message);
  }
  pollRemoteStatus();
}

// =========================================================
// 메모리 덤프 & 진단 (A2SRV 'M' / 'R')
// =========================================================
const memModal = byId('mem-modal');
const memJobMsg = byId('mem-job-msg');
let memJobTimer: number | undefined;

function openMemModal(): void {
  memModal.style.display = 'flex';
  loadDumpList();
  loadDiagReport();
}
function closeMemModal(): void { memModal.style.display = 'none'; }

function memPreset(s: string, e: string, map: string, name: string): void {
  byId<HTMLInputElement>('mem-start').value = s;
  byId<HTMLInputElement>('mem-end').value = e;
  byId<HTMLSelectElement>('mem-map').value = map;
  byId<HTMLInputElement>('mem-name').value = name;
}

// 서버 작업이 끝날 때까지 상태를 보여 주고 끝나면 onDone(status)
function watchJob(job: string, onDone: (s: RemoteStatus) => void): void {
  clearInterval(memJobTimer);
  memJobTimer = setInterval(async () => {
    const s = await pollRemoteStatus();
    if (!s) return;
    memJobMsg.textContent = s.message || s.phase;
    memJobMsg.style.color = s.phase === 'error' ? 'var(--red)' : 'var(--amber)';
    if (s.busy) return;
    clearInterval(memJobTimer);
    if (s.job === job) onDone(s);
  }, 700);
}

async function postJob(url: string, body: object): Promise<boolean> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d: { error?: string; message?: string } = await res.json();
  if (!res.ok) { alert(d.error); return false; }
  memJobMsg.textContent = d.message ?? null;
  return true;
}

async function startMemDump(): Promise<void> {
  const body = {
    start: byId<HTMLInputElement>('mem-start').value,
    end: byId<HTMLInputElement>('mem-end').value,
    map: byId<HTMLSelectElement>('mem-map').value,
    name: byId<HTMLInputElement>('mem-name').value
  };
  if (!(await postJob('/api/remote/memdump', body))) return;
  watchJob('memdump', (s) => {
    if (s.phase === 'done') showToast('⬇ ' + s.message);
    loadDumpList();
  });
}

async function loadDumpList(): Promise<void> {
  const tb = byId('mem-dump-list');
  try {
    const { dumps }: { dumps: DumpEntry[] } = await fetch('/api/remote/dumps').then((r) => r.json());
    if (!dumps.length) { tb.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);">아직 덤프가 없습니다.</td></tr>'; return; }
    tb.innerHTML = '';
    dumps.slice(0, 30).forEach((d) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:monospace; color:#a3d9a3; padding:3px 4px;">${escapeHtml(d.file)}</td>
        <td>${d.start ? '$' + d.start + '-$' + d.end : ''}</td>
        <td>${escapeHtml(d.map || '')}</td>
        <td style="text-align:right;">${d.size.toLocaleString()}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-secondary" style="padding:1px 6px; font-size:11px;">보기</button>
          <a class="btn btn-secondary" style="padding:1px 6px; font-size:11px;" href="/api/remote/dumps/${encodeURIComponent(d.file)}">💾</a>
        </td>`;
      tr.querySelector('button')!.addEventListener('click', () => viewDump(d));
      tb.appendChild(tr);
    });
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="5" style="color:var(--red);">${escapeHtml((e as Error).message)}</td></tr>`;
  }
}

// 덤프를 Hex Editor / 6502 Disassembler로 (시작 주소를 디스어셈블 기준 주소로)
async function viewDump(d: DumpEntry): Promise<void> {
  const data: { hex?: string; error?: string } = await fetch(`/api/remote/dumps/${encodeURIComponent(d.file)}?format=hex`).then((r) => r.json());
  if (!data.hex) { alert(data.error || '덤프를 읽을 수 없습니다.'); return; }
  closeMemModal();
  currentFileType = 'B';
  targetFilename.value = (d.file.split('_')[0] || 'DUMP').slice(0, 30);
  editorTitle.textContent = `🧪 메모리 덤프: ${d.file}`;
  editorTypeTag.className = 'tag tag-b';
  editorTypeTag.textContent = '[B] Memory Dump';
  binViewTabs.style.display = 'flex';
  basicEditor.style.display = 'none';
  currentRawBytes = [];
  for (let i = 0; i < data.hex.length; i += 2) currentRawBytes.push(parseInt(data.hex.substr(i, 2), 16));
  modifiedIndices.clear();
  selectedByteIndex = 0;
  hexPageIndex = 0;
  disasmPageIndex = 0;
  if (d.start) {
    disasmBaseAddr = parseInt(d.start, 16);
    disasmBaseAddrInput.value = '$' + d.start;
  }
  editorSizeInfo.textContent = `크기: ${currentRawBytes.length.toLocaleString()} 바이트, 시작 $${d.start || '0000'}`;
  setBinViewMode('disasm');
  renderHexPage();
  updateDisassembly();
  showToast(`'${d.file}' 덤프를 열었습니다 (Hex / 6502 Disassembly)`);
}

async function startDiag(): Promise<void> {
  const body = { lc: byId<HTMLInputElement>('diag-lc').checked, rom: byId<HTMLInputElement>('diag-rom').checked };
  byId('diag-result').innerHTML = '<span style="color:var(--amber);">진단 중... (실기 9600bps에서 약 1분)</span>';
  if (!(await postJob('/api/remote/diag', body))) return;
  watchJob('diag', () => { loadDiagReport(); loadDumpList(); });
}

async function updateFloppyA2srv(): Promise<void> {
  if (!confirm('드라이브 1의 디스켓에 최신 A2SRV를 BSAVE로 덮어씁니다. 계속할까요?')) return;
  const out = byId('update-result');
  out.textContent = '진행 중...';
  out.style.color = 'var(--amber)';
  if (!(await postJob('/api/remote/update-a2srv', {}))) { out.textContent = ''; return; }
  watchJob('update', (s) => {
    out.textContent = s.message;
    out.style.color = s.phase === 'done' ? 'var(--green)' : 'var(--red)';
    if (s.phase === 'done' && currentDisk === 'remote') loadFiles();
  });
}

function ramBlockHtml(title: string, r: RamSummary | undefined): string {
  if (!r) return '';
  const head = r.ok
    ? `<span style="color:var(--green);">✔ 정상</span>`
    : `<span style="color:var(--red);">✘ 오류 ${r.errors.toLocaleString()}개</span>`;
  let html = `<div style="margin:6px 0;"><b>${escapeHtml(title)}</b> ${escapeHtml(r.label)} — ${(r.bytesTested / 1024).toFixed(1)}KB 검사, ${head}`;
  if (!r.ok) {
    const bits = r.badBits.map((b) => `D${b.bit}(${b.count})`).join(', ');
    const banks = Object.entries(r.badBanks).map(([k, v]) => `${k}: ${v}`).join(', ');
    html += `<div style="color:var(--amber); margin-left:12px;">불량 데이터 비트: ${bits || '-'} · 16KB 뱅크별: ${banks || '-'}</div>`;
    html += `<div style="margin-left:12px; font-family:monospace;">` + r.faults.slice(0, 12).map((f) =>
      `${f.addr}: 기대 ${f.expected} 읽음 ${f.actual} (비트 ${f.bits.join(',')})`).join('<br>') + '</div>';
  }
  return html + '</div>';
}

async function loadDiagReport(): Promise<void> {
  const box = byId('diag-result');
  const { report }: { report: DiagReport | null } = await fetch('/api/remote/diag').then((r) => r.json());
  if (!report) { box.innerHTML = '<span style="color:var(--text-dim);">아직 진단 결과가 없습니다.</span>'; return; }
  let html = `<div style="color:var(--text-dim);">${new Date(report.at).toLocaleString()}</div>`;
  html += `<div style="margin:6px 0;"><b>기종</b> ${escapeHtml(report.machine.name)} <span style="color:var(--text-dim);">(ID $FBB3=${report.machine.id.FBB3}, $FBC0=${report.machine.id.FBC0}, $FB1E=${report.machine.id.FB1E})</span></div>`;
  html += ramBlockHtml('주 메모리', report.main);
  if (report.lc) {
    if (!report.lc.present) html += `<div style="margin:6px 0;"><b>Language Card</b> <span style="color:var(--amber);">${escapeHtml(report.lc.note)}</span></div>`;
    else html += ramBlockHtml('LC bank 2', report.lc.bank2) + ramBlockHtml('LC bank 1', report.lc.bank1);
  }
  if (report.rom) {
    html += `<div style="margin:6px 0;"><b>ROM $D000-$FFFF</b> CRC32 <code>${report.rom.crc32}</code>`;
    if (report.rom.file) html += ` · <a href="/api/remote/dumps/${encodeURIComponent(report.rom.file)}" style="color:var(--cyan);">덤프 파일</a>`;
    html += `<div style="margin-left:12px; font-family:monospace;">2KB 단위(II/II+ ROM 칩): ${report.rom.chips2k.map((c) => `${c.range}=${c.crc32}`).join(' · ')}</div>`;
    html += `<div style="margin-left:12px; font-family:monospace;">//e (CD/EF 칩): ${report.rom.halves8k.map((c) => `${c.range}=${c.crc32}`).join(' · ')}</div>`;
    html += `<div style="margin-left:12px; color:var(--text-dim);">정상 ROM 덤프의 CRC32와 비교하면 ROM 칩 불량을 찾을 수 있습니다.</div></div>`;
  }
  box.innerHTML = html;
}

// 초기 실행
let savedDisk = 'local';
try { savedDisk = localStorage.getItem('a2web.disk') || 'local'; } catch (e) {}
setDiskSource(savedDisk);
pollRemoteStatus();
setInterval(pollRemoteStatus, 5000);

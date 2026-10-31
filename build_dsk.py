#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_dsk.py - Build bootable Apple II DOS 3.3 Disk Image for apple2-web

Creates 'apple2-web.dsk' containing:
  - HELLO      : Boot autostart Applesoft BASIC program
  - WEBCLIENT  : Interactive Apple II Web Client & Serial Bridge (Applesoft BASIC)
"""

import os
import sys
import shutil
import subprocess
from ac_tool import find_applecommander, put_file, delete_file, list_dsk_files

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOOLS_DIR = os.path.join(SCRIPT_DIR, "tools")
TEMPLATE_DSK = os.path.join(TOOLS_DIR, "dos33_template.dsk")
OUTPUT_DSK = os.path.join(SCRIPT_DIR, "apple2-web.dsk")
APPLE2_DIR = os.path.join(SCRIPT_DIR, "apple2")

# --- Applesoft BASIC Tokenizer ---
TOKENS = {
    'END': 0x80, 'FOR': 0x81, 'NEXT': 0x82, 'DATA': 0x83, 'INPUT': 0x84,
    'DEL': 0x85, 'DIM': 0x86, 'READ': 0x87, 'GR': 0x88, 'TEXT': 0x89,
    'PR#': 0x8A, 'IN#': 0x8B, 'CALL': 0x8C, 'PLOT': 0x8D, 'HLIN': 0x8E,
    'VLIN': 0x8F, 'HGR2': 0x90, 'HGR': 0x91, 'HCOLOR=': 0x92, 'HPLOT': 0x93,
    'DRAW': 0x94, 'XDRAW': 0x95, 'HTAB': 0x96, 'HOME': 0x97, 'ROT=': 0x98,
    'SCALE=': 0x99, 'SHLOAD': 0x9A, 'TRACE': 0x9B, 'NOTRACE': 0x9C, 'NORMAL': 0x9D,
    'INVERSE': 0x9E, 'FLASH': 0x9F, 'COLOR=': 0xA0, 'POP': 0xA1, 'VTAB': 0xA2,
    'HIMEM:': 0xA3, 'LOMEM:': 0xA4, 'ONERR': 0xA5, 'RESUME': 0xA6, 'RECALL': 0xA7,
    'STORE': 0xA8, 'SPEED=': 0xA9, 'LET': 0xAA, 'GOTO': 0xAB, 'RUN': 0xAC,
    'IF': 0xAD, 'RESTORE': 0xAE, '&': 0xAF, 'GOSUB': 0xB0, 'RETURN': 0xB1,
    'REM': 0xB2, 'STOP': 0xB3, 'ON': 0xB4, 'WAIT': 0xB5, 'LOAD': 0xB6,
    'SAVE': 0xB7, 'DEF': 0xB8, 'POKE': 0xB9, 'PRINT': 0xBA, 'CONT': 0xBB,
    'LIST': 0xBC, 'CLEAR': 0xBD, 'GET': 0xBE, 'NEW': 0xBF, 'TAB(': 0xC0,
    'TO': 0xC1, 'FN': 0xC2, 'SPC(': 0xC3, 'THEN': 0xC4, 'AT': 0xC5,
    'NOT': 0xC6, 'STEP': 0xC7, '+': 0xC8, '-': 0xC9, '*': 0xCA,
    '/': 0xCB, '^': 0xCC, 'AND': 0xCD, 'OR': 0xCE, '>': 0xCF,
    '=': 0xD0, '<': 0xD1, 'SGN': 0xD2, 'INT': 0xD3, 'ABS': 0xD4,
    'USR': 0xD5, 'FRE': 0xD6, 'SCRN(': 0xD7, 'PDL': 0xD8, 'POS': 0xD9,
    'SQR': 0xDA, 'RND': 0xDB, 'LOG': 0xDC, 'EXP': 0xDD, 'COS': 0xDE,
    'SIN': 0xDF, 'TAN': 0xE0, 'ATN': 0xE1, 'PEEK': 0xE2, 'LEN': 0xE3,
    'STR$': 0xE4, 'VAL': 0xE5, 'ASC': 0xE6, 'CHR$': 0xE7,
    'LEFT$': 0xE8, 'RIGHT$': 0xE9, 'MID$': 0xEA
}
SORTED_TOKENS = sorted(TOKENS.items(), key=lambda x: len(x[0]), reverse=True)

def tokenize_line(line_text):
    buf = bytearray()
    i = 0
    in_quote = False
    in_rem = False

    while i < len(line_text):
        ch = line_text[i]
        if ch == '"':
            in_quote = not in_quote
            buf.append(ord('"'))
            i += 1
            continue

        if in_quote or in_rem:
            buf.extend(ch.encode('ascii', errors='replace'))
            i += 1
            continue

        matched = False
        remaining = line_text[i:].upper()
        for tok_name, tok_val in SORTED_TOKENS:
            if remaining.startswith(tok_name):
                buf.append(tok_val)
                i += len(tok_name)
                matched = True
                if tok_name == 'REM':
                    in_rem = True
                break

        if not matched:
            buf.append(ord(ch))
            i += 1

    buf.append(0x00)
    return buf

def build_applesoft_program_from_file(file_path, start_addr=0x0801):
    lines = []
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            parts = line.split(" ", 1)
            if parts[0].isdigit():
                num = int(parts[0])
                rest = parts[1] if len(parts) > 1 else ""
                lines.append((num, rest))

    prog = bytearray()
    curr_addr = start_addr

    for line_num, line_text in sorted(lines, key=lambda x: x[0]):
        tokenized = tokenize_line(line_text)
        next_addr = curr_addr + 2 + 2 + len(tokenized)
        prog.extend([next_addr & 0xFF, (next_addr >> 8) & 0xFF])
        prog.extend([line_num & 0xFF, (line_num >> 8) & 0xFF])
        prog.extend(tokenized)
        curr_addr = next_addr

    prog.extend([0x00, 0x00])
    return prog

def build_dsk():
    print("=" * 60)
    print(" Apple II Web Client & Bridge - DSK Image Builder")
    print("=" * 60)

    # 1. Locate AppleCommander
    try:
        ac_jar = find_applecommander()
        print(f"[OK] AppleCommander JAR: {ac_jar}")
    except Exception as e:
        print(f"[FAIL] {e}")
        sys.exit(1)

    # 2. Prepare base DSK image
    if os.path.exists(TEMPLATE_DSK):
        print(f"[+] Creating {OUTPUT_DSK} from template...")
        shutil.copy2(TEMPLATE_DSK, OUTPUT_DSK)
    else:
        print(f"[+] Creating clean 140K DOS 3.3 disk {OUTPUT_DSK}...")
        cmd = ["java", "-jar", ac_jar, "-dos140", OUTPUT_DSK]
        subprocess.run(cmd, check=True)

    # Clean up non-standard template files if present
    extra_files = ["HANGUL", "TEST", "SAMPLE", "DIAG", "DEMO", "PEEKALL", "JEMANG", "FONT", "LOADER.OBJ0"]
    existing_files = [name for _, name in list_dsk_files(OUTPUT_DSK)]
    for f in extra_files:
        if f in existing_files:
            delete_file(OUTPUT_DSK, f)

    # 3. Inject HELLO (Applesoft BASIC type A)
    hello_path = os.path.join(APPLE2_DIR, "HELLO.BAS")
    if os.path.exists(hello_path):
        print(f"[+] Tokenizing & Injecting HELLO [A] from {hello_path}...")
        hello_bin = build_applesoft_program_from_file(hello_path)
        put_file(OUTPUT_DSK, "HELLO", "A", 0x0801, hello_bin)
    else:
        print(f"[WARN] HELLO.BAS not found at {hello_path}")

    # 4. Inject WEBCLIENT (Applesoft BASIC type A)
    webclient_path = os.path.join(APPLE2_DIR, "WEBCLIENT.BAS")
    if os.path.exists(webclient_path):
        print(f"[+] Tokenizing & Injecting WEBCLIENT [A] from {webclient_path}...")
        webclient_bin = build_applesoft_program_from_file(webclient_path)
        put_file(OUTPUT_DSK, "WEBCLIENT", "A", 0x0801, webclient_bin)
    else:
        print(f"[FAIL] WEBCLIENT.BAS not found at {webclient_path}")
        sys.exit(1)

    # 5. Verify & List contents
    print("-" * 60)
    print(f"[OK] Successfully generated: {OUTPUT_DSK}")
    print(f"[+] Files on {os.path.basename(OUTPUT_DSK)}:")
    files = list_dsk_files(OUTPUT_DSK)
    for ftype, fname in files:
        marker = " <== (WEB CLIENT)" if fname in ("HELLO", "WEBCLIENT") else ""
        print(f"    [{ftype}] {fname:<16}{marker}")
    print("=" * 60)

if __name__ == '__main__':
    build_dsk()

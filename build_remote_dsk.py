#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_remote_dsk.py - Build A2REMOTE.DSK, the boot disk for a real Apple II
whose keyboard does not work.

The disk is DOS 3.3 (from tools/dos33_template.dsk) with only:
  - HELLO  : runs at boot: HIMEM below A2KBDA, IN#2 if a Super Serial Card
             is in slot 2 (its firmware sets the ACIA up), then BRUN A2KBDA
             (source: apple2/REMOTE_HELLO.BAS)
  - A2KBDA : the input routine ($9300) - keys from the keyboard, the SSC and
             the cassette input (sound from the PC, audio_keys.js)
  - A2SRV  : the sector server (apple2/a2srv.bin, $6000); the web server types
             BRUN A2SRV to read this disk over the SSC, and it returns to
             BASIC when done

The template's other files are left out so that few tracks are in use: the
web server reads only those, and a real SSC at 9600 baud takes about six
seconds a track. --keep keeps them.

Usage:  python build_remote_dsk.py [output.dsk] [--keep]   (default: a2remote.dsk)
"""

import os
import shutil
import sys

from ac_tool import put_file, list_dsk_files, run_ac_command
from build_dsk import build_applesoft_program_from_file

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DSK = os.path.join(SCRIPT_DIR, "tools", "dos33_template.dsk")
HELLO_SRC = os.path.join(SCRIPT_DIR, "apple2", "REMOTE_HELLO.BAS")
A2SRV_BIN = os.path.join(SCRIPT_DIR, "apple2", "a2srv.bin")
A2KBDA_BIN = os.path.join(SCRIPT_DIR, "apple2", "a2kbda.bin")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = "--keep" in sys.argv
    out = os.path.abspath(args[0] if args else os.path.join(SCRIPT_DIR, "a2remote.dsk"))
    shutil.copyfile(TEMPLATE_DSK, out)

    if not keep:
        for _t, name in list_dsk_files(out):
            if name != "HELLO":
                # locked files too: unlock, then delete
                run_ac_command(["-unlock", out, name])
                run_ac_command(["-d", out, name])

    hello = build_applesoft_program_from_file(HELLO_SRC)
    put_file(out, "HELLO", "A", 0x0801, hello)

    with open(A2SRV_BIN, "rb") as f:
        put_file(out, "A2SRV", "B", 0x6000, f.read())

    with open(A2KBDA_BIN, "rb") as f:
        put_file(out, "A2KBDA", "B", 0x9300, f.read())

    print(f"[OK] {out}")
    for t, n in list_dsk_files(out):
        print(f"  [{t}] {n}")


if __name__ == "__main__":
    main()

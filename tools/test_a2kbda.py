#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_a2kbda.py - Run A2KBDA (apple2/a2kbda.bin) in the py65 6502 simulator
and feed it the sound audio_keys.js makes, cycle by cycle, on $C060.

For each case a WAV is made by node audio_keys.js, its samples become the
cassette input level at the CPU's cycle time, and KIN (the KSW routine) is
called the way RDKEY does until the expected text comes back - or a timeout.

Needs py65 (python -m pip install py65) and node.
Usage:  python tools/test_a2kbda.py
"""

import os
import random
import subprocess
import sys
import tempfile
import wave

from py65.devices.mpu6502 import MPU
from py65.memory import ObservableMemory

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "apple2", "a2kbda.bin")
LOAD = 0x9300
KIN = 0x932C          # from apple2/a2kbda.lst
BELL1 = 0xFBDD


def make_wav(text, gap=None):
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    code = ("const a=require(process.argv[1]);const o=process.argv[4]?{gap:+process.argv[4]}:{};"
            "require('fs').writeFileSync(process.argv[3],a.textToWav(process.argv[2],o).wav)")
    args = ["node", "-e", code, os.path.join(ROOT, "audio_keys.js"), text, path]
    if gap is not None:
        args.append(str(gap))
    subprocess.run(args, check=True)
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        pcm = w.readframes(w.getnframes())
    os.unlink(path)
    return rate, pcm


class Apple:
    def __init__(self, rate, pcm, clock=1.0205e6, start=0.02, jitter_us=0.0, flip=False, corrupt_at=None):
        self.mem = ObservableMemory()
        self.mpu = MPU(memory=self.mem)
        self.rate, self.pcm, self.clock, self.start = rate, pcm, clock, start
        self.jitter = jitter_us * 1e-6
        self.flip = flip
        self.level = 0x00
        self.bells = 0
        if corrupt_at is not None:
            # invert a few ms of signal in the middle of the data
            pcm = bytearray(pcm)
            a = int(corrupt_at * rate)
            for i in range(a, a + int(0.004 * rate)):
                if i < len(pcm):
                    pcm[i] = 256 - pcm[i] if pcm[i] != 128 else 128
            self.pcm = bytes(pcm)
        with open(BIN, "rb") as f:
            code = f.read()
        for i, b in enumerate(code):
            self.mem[LOAD + i] = b
        self.mem[0x03EA] = 0x60       # DOS hook: RTS
        self.mem[BELL1] = 0x60        # beep: RTS
        self.mem.subscribe_to_read([0xC060], self.tapein)
        self.mem.subscribe_to_read([0xC000, 0xC0A9, 0xC205, 0xC207], lambda a: 0x00)
        # $0300: JSR INSTALL / BRK    $0310: JSR KIN / BRK
        for a, b in zip(range(0x0300, 0x0304), [0x20, LOAD & 0xFF, LOAD >> 8, 0x00]):
            self.mem[a] = b
        for a, b in zip(range(0x0310, 0x0314), [0x20, KIN & 0xFF, KIN >> 8, 0x00]):
            self.mem[a] = b
        self.mem[0x28], self.mem[0x29] = 0x00, 0x04   # BASL -> $0400

    def tapein(self, _addr):
        t = self.mpu.processorCycles / self.clock - self.start
        if self.jitter:
            t += random.uniform(-self.jitter, self.jitter)
        i = int(t * self.rate)
        if 0 <= i < len(self.pcm):
            s = self.pcm[i]
            if s > 128:
                self.level = 0x80
            elif s < 128:
                self.level = 0x00
        v = self.level ^ (0x80 if self.flip else 0)
        return v | random.randrange(0x80)   # other bits float

    def call(self, pc, a=0, x=0, y=0, limit_s=30.0):
        m = self.mpu
        m.pc, m.a, m.x, m.y = pc, a, x, y
        end = pc + 3
        limit = m.processorCycles + int(limit_s * self.clock)
        while m.pc != end:
            if m.pc == BELL1:
                self.bells += 1
            m.step()
            if m.processorCycles > limit:
                return None
        return m

    def run(self, expect, timeout_s):
        """Call KIN until `expect` is in (or, for b'', until the timeout - any key is then wrong)."""
        self.call(0x0300)
        got = []
        deadline = self.mpu.processorCycles + int(timeout_s * self.clock)
        while len(got) < max(len(expect), 1):
            left = (deadline - self.mpu.processorCycles) / self.clock
            if left <= 0:
                break
            m = self.call(0x0310, a=0xA0, x=0x55, y=0x00, limit_s=left)
            if m is None:
                break
            if m.x != 0x55:
                raise AssertionError("KIN did not keep X")
            got.append(m.a)
        return bytes(got)


def case(name, text, expect=None, timeout=None, **kw):
    rate, pcm = make_wav(text, kw.pop("gap", None))
    seconds = len(pcm) / rate
    want = (expect if expect is not None else text.replace("\n", "\r") + "\r").encode("latin1")
    want_hi = bytes(b | 0x80 for b in want)
    apple = Apple(rate, pcm, **kw)
    got = apple.run(want_hi, timeout or seconds + 1.0)
    ok = got == want_hi
    show = bytes(b & 0x7F for b in got).decode("latin1").replace("\r", "\\r")
    print(f"{'PASS' if ok else 'FAIL'}  {name:34s} {seconds:5.2f}s audio  got {show!r}  beeps {apple.bells}")
    return ok, apple


def main():
    random.seed(1)
    results = []
    results.append(case("CATALOG", "CATALOG")[0])
    results.append(case("BASIC lines + SAVE (one packet)", '10 PRINT "HELLO FROM AUDIO"\n20 END\nSAVE AUDIOTEST')[0])
    results.append(case("all printable ASCII", "".join(chr(c) for c in range(32, 127)))[0])
    long_text = "\n".join(f"{n} REM LINE {n} OF A LONG PROGRAM SENT BY SOUND" for n in range(10, 200, 10))
    results.append(case("3 packets (over 255 bytes)", long_text)[0])
    results.append(case("CPU clock -3%", "RUN HELLO", clock=1.0205e6 * 0.97)[0])
    results.append(case("CPU clock +3%", "RUN HELLO", clock=1.0205e6 * 1.03)[0])
    results.append(case("timing jitter +-40us (edge chatter)", "CATALOG", jitter_us=40)[0])
    results.append(case("jitter + clock -3%", "LIST", jitter_us=30, clock=1.0205e6 * 0.97)[0])
    results.append(case("inverted signal", "CATALOG", flip=True)[0])
    # The data of "CATALOG" runs from about 0.22 s to 0.28 s of the WAV.
    ok, apple = case("corrupted packet (expect beep, no keys)", "CATALOG", expect="", timeout=3.0, corrupt_at=0.24)
    results.append(ok and apple.bells >= 1)
    print(f"  -> corrupted packet: {'beeped and dropped' if apple.bells >= 1 else 'NOT detected'}")
    print(f"\n{sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()

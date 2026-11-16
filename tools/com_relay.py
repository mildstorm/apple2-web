#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
com_relay.py - Relay a PC serial (COM) port to a local TCP port

The real Apple II's Super Serial Card reaches the PC on a COM port (USB-RS232
adapter + null modem cable). server.js talks to every Apple the same way - a
TCP byte stream, like the STM32 board's port 6502 - so for real hardware it
starts this relay and connects to it.

One TCP client at a time; a new one replaces the old. Bytes are passed both
ways unchanged.

Usage:
  python tools/com_relay.py COM12 [--baud 9600] [--port 6502] [--rtscts]
  python tools/com_relay.py --list            (show the COM ports)

Needs pyserial:  python -m pip install pyserial
"""

import argparse
import socket
import sys
import threading
import time

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("[COM] pyserial is not installed - run: python -m pip install pyserial", flush=True)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("com", nargs="?")
    ap.add_argument("--baud", type=int, default=9600)
    ap.add_argument("--port", type=int, default=6502)
    ap.add_argument("--rtscts", action="store_true", help="hardware flow control")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.list or not a.com:
        for p in serial.tools.list_ports.comports():
            print(f"{p.device}\t{p.description}")
        return

    # serial_for_url also takes pyserial URLs, e.g. loop:// for a self-test
    ser = serial.serial_for_url(a.com, baudrate=a.baud, bytesize=8, parity="N",
                                stopbits=1, timeout=0.05, rtscts=a.rtscts)
    # The SSC's 6551 needs CTS (and the firmware looks at DSR/DCD) - keep our
    # DTR and RTS on so a null modem cable presents them.
    ser.dtr = True
    ser.rts = True
    print(f"[COM] {a.com} open at {a.baud} 8N1{' RTS/CTS' if a.rtscts else ''}", flush=True)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", a.port))
    srv.listen(1)
    print(f"[COM] relay listening on 127.0.0.1:{a.port}", flush=True)

    state = {"client": None}
    lock = threading.Lock()

    def com_to_tcp():
        while True:
            data = ser.read(4096)
            if not data:
                continue
            with lock:
                c = state["client"]
            if c is not None:
                try:
                    c.sendall(data)
                except OSError:
                    pass

    threading.Thread(target=com_to_tcp, daemon=True).start()

    while True:
        conn, addr = srv.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        with lock:
            old = state["client"]
            state["client"] = conn
        if old is not None:
            try:
                old.close()
            except OSError:
                pass
        print(f"[COM] client {addr[0]}:{addr[1]} connected", flush=True)
        ser.reset_input_buffer()

        def tcp_to_com(c):
            try:
                while True:
                    d = c.recv(4096)
                    if not d:
                        break
                    ser.write(d)
            except OSError:
                pass
            with lock:
                if state["client"] is c:
                    state["client"] = None
            print("[COM] client gone", flush=True)

        threading.Thread(target=tcp_to_com, args=(conn,), daemon=True).start()


if __name__ == "__main__":
    try:
        main()
    except serial.SerialException as e:
        print(f"[COM] {e}", flush=True)
        sys.exit(1)
    except KeyboardInterrupt:
        pass

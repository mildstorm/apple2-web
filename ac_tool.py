#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AppleCommander Utility & DSK Management Tool (ac_tool.py)

Provides robust, cross-platform AppleCommander integration for:
  - build_font_dsk.py
  - inject_basic.py
  - verify_dsk_font.py

Features:
  - Smart automatic detection of AppleCommander JAR (env var, tools/ directory, PATH).
  - Clean error messages and environment setup guidance for end-users.
  - Can be used both as an imported Python module and as a standalone CLI tool.
"""

import os
import sys
import shutil
import subprocess
import glob
import re

ENV_VAR_NAME = "APPLECOMMANDER_JAR"
ENV_VAR_ALT = "AC_JAR"

def get_script_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def check_java():
    """Checks if Java runtime is available in PATH."""
    java_cmd = shutil.which("java")
    if not java_cmd:
        return False, "Java가 시스템 PATH에 설치되어 있지 않습니다. Java (JRE/JDK 8 이상)를 설치해 주세요."
    try:
        res = subprocess.run(["java", "-version"], capture_output=True, text=True)
        return True, java_cmd
    except Exception as e:
        return False, str(e)

def find_applecommander(custom_path=None):
    """
    Locates the AppleCommander JAR file in the following order:
      1. Explicit custom_path argument (CLI flag --ac-jar)
      2. Environment variables: APPLECOMMANDER_JAR, AC_JAR
      3. Project directory: tools/AppleCommander*.jar, tools/ac.jar
      4. Current working directory or script directory: AppleCommander*.jar
      5. System PATH: AppleCommander.jar or ac.jar
    """
    # 1. Custom path
    if custom_path:
        if os.path.isfile(custom_path):
            return os.path.abspath(custom_path)
        raise FileNotFoundError(f"지정된 AppleCommander JAR 파일을 찾을 수 없습니다: {custom_path}")

    # 2. Environment variables
    for var in (ENV_VAR_NAME, ENV_VAR_ALT):
        val = os.environ.get(var)
        if val and os.path.isfile(val):
            return os.path.abspath(val)

    # 3. Project tools/ directory
    script_dir = get_script_dir()
    search_dirs = [
        os.path.join(script_dir, "tools"),
        os.path.join(os.getcwd(), "tools"),
        script_dir,
        os.getcwd()
    ]

    for d in search_dirs:
        if os.path.isdir(d):
            # Check exact or glob matches
            patterns = ["AppleCommander*.jar", "applecommander*.jar", "*ac*.jar"]
            for pat in patterns:
                matches = glob.glob(os.path.join(d, pat))
                if matches:
                    # Prefer exact match or latest
                    return os.path.abspath(sorted(matches)[-1])

    # 4. PATH lookup
    path_jar = shutil.which("AppleCommander.jar") or shutil.which("applecommander.jar") or shutil.which("ac.jar")
    if path_jar and os.path.isfile(path_jar):
        return os.path.abspath(path_jar)

    # Not found - build helpful instruction
    msg = (
        "\n[오류] AppleCommander JAR 파일을 찾을 수 없습니다!\n\n"
        "다음 세 가지 방법 중 하나로 환경 설정을 완료해 주세요:\n"
        "  1. [가장 권장] 프로젝트 내 'tools/' 폴더에 'AppleCommander.jar' 파일을 복사합니다.\n"
        "  2. [환경 변수] 시스템 환경 변수 'APPLECOMMANDER_JAR'에 JAR 파일의 전체 경로를 지정합니다.\n"
        "     (예: set APPLECOMMANDER_JAR=C:\\tools\\AppleCommander.jar)\n"
        "  3. [옵션 지정] 스크립트 실행 시 '--ac-jar <파일경로>' 인자를 전달합니다.\n\n"
        "※ AppleCommander는 https://github.com/AppleCommander/AppleCommander/releases 에서 다운로드할 수 있습니다.\n"
    )
    raise FileNotFoundError(msg)

def run_ac_command(args, custom_ac=None, capture=True):
    """Executes an AppleCommander command via java -jar."""
    java_ok, java_info = check_java()
    if not java_ok:
        raise RuntimeError(f"[Java 누락] {java_info}\nJava를 먼저 설치해 주세요.")

    ac_jar = find_applecommander(custom_ac)
    cmd = ["java", "-jar", ac_jar] + args
    return subprocess.run(cmd, capture_output=capture, text=True, errors='replace')

def list_dsk_files(dsk_path, custom_ac=None):
    """Returns a list of (file_type, file_name) tuples from DSK."""
    res = run_ac_command(["-l", dsk_path], custom_ac=custom_ac)
    if res.returncode != 0:
        raise RuntimeError(f"DSK 파일 목록 조회 실패 ({dsk_path}): {res.stderr}")

    files = []
    for line in res.stdout.splitlines():
        m = re.match(r'^\s*[*]?\s*([A-Z])\s+\d+\s+([A-Za-z0-9_\-\.]+)', line)
        if m:
            files.append((m.group(1), m.group(2)))
    return files

def export_text_file(dsk_path, file_name, custom_ac=None):
    """Exports a text/BASIC file from DSK (-e)."""
    res = run_ac_command(["-e", dsk_path, file_name], custom_ac=custom_ac)
    return res.stdout

def get_raw_file(dsk_path, file_name, out_path, custom_ac=None):
    """Gets raw binary file from DSK (-g)."""
    res = run_ac_command(["-g", dsk_path, file_name, out_path], custom_ac=custom_ac)
    if res.returncode != 0:
        raise RuntimeError(f"바이너리 파일 추출 실패 ({file_name}): {res.stderr}")
    return os.path.exists(out_path)

def put_file(dsk_path, file_name, file_type, addr, local_data_or_file, custom_ac=None):
    """Puts a file into DSK (-p). Auto-deletes existing file first."""
    delete_file(dsk_path, file_name, custom_ac=custom_ac)

    # If bytes/bytearray, write to a temp file
    temp_file = None
    if isinstance(local_data_or_file, (bytes, bytearray)):
        temp_file = f"_temp_put_{os.getpid()}.bin"
        with open(temp_file, "wb") as f:
            f.write(local_data_or_file)
        in_file = temp_file
    else:
        in_file = local_data_or_file

    try:
        addr_str = f"0x{addr:X}" if isinstance(addr, int) else str(addr)
        ac_jar = find_applecommander(custom_ac)
        cmd = f'java -jar "{ac_jar}" -p {dsk_path} {file_name} {file_type} {addr_str} < {in_file}'
        subprocess.run(cmd, shell=True, check=True)
    finally:
        if temp_file and os.path.exists(temp_file):
            os.remove(temp_file)

def delete_file(dsk_path, file_name, custom_ac=None):
    """Deletes a file from DSK (-d)."""
    run_ac_command(["-d", dsk_path, file_name], custom_ac=custom_ac)

def print_environment_diagnosis():
    """Prints diagnostic information about Java and AppleCommander."""
    print("=" * 65)
    print(" AppleCommander & Java 개발 환경 설정 진단")
    print("=" * 65)

    # 1. Java check
    java_ok, java_info = check_java()
    if java_ok:
        print(f"[OK] Java Runtime: 발견됨 ({java_info})")
    else:
        print(f"[FAIL] Java Runtime: {java_info}")

    # 2. AppleCommander check
    try:
        ac_path = find_applecommander()
        print(f"[OK] AppleCommander JAR: 발견됨 ({ac_path})")
        # Run -help or -ls test
        res = run_ac_command(["-l", "unicode.dsk"] if os.path.exists("unicode.dsk") else ["-h"])
        print("[OK] AppleCommander 실행 테스트: 성공")
    except Exception as e:
        print(f"[FAIL] AppleCommander JAR: {e}")

    # 3. Environment Variables
    env_ac = os.environ.get(ENV_VAR_NAME) or os.environ.get(ENV_VAR_ALT)
    print(f"  * 환경 변수 ({ENV_VAR_NAME}): {env_ac if env_ac else '(설정되지 않음, 기본 경로 자동 탐색됨)'}")
    print("=" * 65)

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help", "help", "check", "diagnose"):
        print_environment_diagnosis()
        print("\n[사용법]")
        print("  python ac_tool.py check                     : 환경설정 상태 진단")
        print("  python ac_tool.py list <dsk>                : DSK 디스크 내 파일 목록")
        print("  python ac_tool.py export <dsk> <file>       : 텍스트/BASIC 파일 추출")
        print("  python ac_tool.py get <dsk> <file> <out>    : 원본 바이너리 파일 추출")
        print("  python ac_tool.py put <dsk> <src> <dst> <type> <addr> : 파일 주입")
        print("  python ac_tool.py delete <dsk> <file>       : 파일 삭제")
        sys.exit(0)

    action = sys.argv[1].lower()
    if action == "list" and len(sys.argv) >= 3:
        files = list_dsk_files(sys.argv[2])
        print(f"[{sys.argv[2]}] 파일 목록:")
        for t, n in files:
            print(f"  [{t}] {n}")
    elif action == "export" and len(sys.argv) >= 4:
        content = export_text_file(sys.argv[2], sys.argv[3])
        print(content)
    elif action == "get" and len(sys.argv) >= 5:
        get_raw_file(sys.argv[2], sys.argv[3], sys.argv[4])
        print(f"[성공] {sys.argv[3]} -> {sys.argv[4]} 추출 완료")
    elif action == "delete" and len(sys.argv) >= 4:
        delete_file(sys.argv[2], sys.argv[3])
        print(f"[완료] {sys.argv[3]} 삭제 완료")
    else:
        print(f"[오류] 잘못된 인자입니다: {sys.argv}")

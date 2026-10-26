#!/usr/bin/env python3
"""Real installed-Pi PTY smoke, only generated synthetic sessions; no inference.
Artifacts remain under package-local ignored .tmp/tui-*. Requires POSIX PTY + pi.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

PACKAGE = Path(__file__).resolve().parents[1]
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)')

def run(mode):
    (PACKAGE / '.tmp').mkdir(exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix=f'tui-{mode}-', dir=PACKAGE / '.tmp'))
    agent = root / 'agent'
    project = root / 'workspace'
    project.mkdir()
    for n in ('alpha', 'beta'):
        directory = agent / 'sessions' / f'--synthetic-{n}--'
        directory.mkdir(parents=True)
        records = [
            dict(type='session', version=3, id=f'synthetic-{n}', cwd=f'/synthetic/{n}', timestamp='2026-01-01T00:00:00.000Z'),
            dict(type='message', id='u', parentId=None, timestamp='2026-01-01T00:01:00.000Z', message=dict(role='user', content=f'Synthetic {n} evidence 日本語', timestamp=1)),
            dict(type='session_info', id='name', parentId='u', timestamp='2026-01-01T00:02:00.000Z', name=f'Smoke {n}')]
        (directory / f'{n}.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in records))
    master, slave = pty.openpty()
    def resize(rows, cols):
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    resize(32, 120)
    env = dict(os.environ, TERM='xterm-256color', PI_CODING_AGENT_DIR=str(agent), PI_CODING_AGENT_SESSION_DIR=str(agent / 'sessions'), PI_OFFLINE='1', NO_COLOR='1')
    command = [shutil.which('pi') or 'pi', '--no-session', '-ne', '--no-mcp', '-ns', '-np', '--no-themes', '-nc', '-na', '--tui-mode', mode, '-e', str(PACKAGE / 'extensions' / 'index.ts')]
    process = subprocess.Popen(command, cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()
    def drain(seconds=.2):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if select.select([master], [], [], min(.1, max(0, deadline-time.monotonic())))[0]:
                try:
                    chunk = os.read(master, 65536)
                    if not chunk: break
                    output.extend(chunk)
                except OSError: break
    def wait(text, timeout=20):
        start = 0
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            drain(.1)
            if text in ANSI.sub('', output[start:].decode('utf-8', errors='replace')): return
            if process.poll() is not None: break
        raise AssertionError(f'{mode}: missing {text!r}; see {root}/terminal.txt')
    def send(value):
        os.write(master, value.encode()); drain(.25)
    try:
        drain(4)
        os.write(master, b'/context-lens tui\r')
        wait('session selection')
        send('Smoke')
        # Picker now contains the two synthetic past sessions only.
        send('\t'); send('\x1b[B'); send('\t')
        send('\x13')  # review selected sessions despite search filtering
        assert 'Selected only' in ANSI.sub('', output.decode('utf-8', errors='replace'))
        send('\x13'); send('\r')
        drain(.5); send('\r')  # accept default retained-context scope
        wait('text units', 10)
        send('\x1b[C')  # comparison
        drain(.5)
        # Narrow resize and Unicode rendering while report is active.
        narrow_start = len(output)
        resize(24, 42); os.kill(process.pid, signal.SIGWINCH); drain(.5)
        narrow = ANSI.sub('', output[narrow_start:].decode('utf-8', errors='replace'))
        assert 'Compare (2/6)' in narrow and 'A AI analysis' in narrow and 'D evidence' in narrow and 'Esc back' in narrow, 'narrow navigation/actions clipped'
        send('\x1b[C'); send('\x1b[6~')  # growth + page scroll
        resize(32, 120); os.kill(process.pid, signal.SIGWINCH); drain(.5)
        send('d'); drain(.3); send('\r'); drain(.5)
        return_start = len(output)
        send('\x1b'); drain(.4)
        returned = ANSI.sub('', output[return_start:].decode('utf-8', errors='replace'))
        assert 'Context Lens · Growth (3/6)' in returned, 'return from evidence lost active report tab'
        send('\x1b'); drain(.4)
        os.write(master, b'/context-lens tui current\r'); drain(.5); send('\r'); drain(.7); send('\x1b')
        text = ANSI.sub('', output.decode('utf-8', errors='replace'))
        assert 'Compare' in text and 'Growth' in text, 'report tabs not observed'
        assert 'Side-by-side' in text, 'comparison not observed'
        assert 'synthetic-alpha' in text and 'synthetic-beta' in text, 'multi-project selection not observed'
        assert 'Local evidence' in text, 'local contributor detail not observed'
        assert 'Context Lens:' not in text, 'extension reported an error'
        print(f'PASS {mode}: selected-session review, summary/plain scopes, narrow actions, preserved Growth tab, multi-project compare/detail, current ephemeral; {root}/terminal.txt')
    finally:
        (root / 'terminal.txt').write_text(ANSI.sub('', output.decode('utf-8', errors='replace')))
        (root / 'terminal.ansi').write_bytes(output)
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
        os.close(master)

for mode in ('regular', 'fullscreen'):
    run(mode)

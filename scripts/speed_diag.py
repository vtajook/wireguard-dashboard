#!/usr/bin/env python3
"""Read-only speed check for the panel (changes nothing).

    /opt/WG_Panel/venv/bin/python /opt/WG_Panel/scripts/speed_diag.py

Measures how long the peer list API takes for every interface, how big the
answer is, how often the per-interface lock is busy (what makes enable /
disable wait), and prints the gunicorn worker/thread settings.
"""
import json
import os
import re
import sqlite3
import ssl
import subprocess
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INST = os.path.join(ROOT, 'instance')


def env_value(name):
    v = os.environ.get(name)
    if v:
        return v
    try:
        for line in open(os.path.join(ROOT, '.env'), encoding='utf-8', errors='replace'):
            m = re.match(r'\s*(?:export\s+)?' + re.escape(name) + r'\s*=\s*(.*)\s*$', line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    except OSError:
        pass
    return ''


def panel_ports():
    out = subprocess.run(['ss', '-ltnpH'], capture_output=True, text=True).stdout
    pid = subprocess.run(['systemctl', 'show', '-p', 'MainPID', '--value', 'wg-panel'],
                         capture_output=True, text=True).stdout.strip()
    ports = []
    for line in out.splitlines():
        if pid and f'pid={pid},' not in line and 'python' not in line and 'gunicorn' not in line:
            continue
        m = re.search(r':(\d+)\s', line.split()[3] + ' ')
        if m:
            ports.append(int(m.group(1)))
    return sorted(set(ports))


KEY = env_value('API_KEY')
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(base, path, timeout=120):
    req = urllib.request.Request(base + path, headers={'X-API-KEY': KEY, 'Accept': 'application/json'})
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        body = r.read()
        took = time.perf_counter() - t
        return r.status, len(body), took, dict(r.headers), body


def find_base():
    for port in panel_ports():
        for scheme in ('https', 'http'):
            base = f'{scheme}://127.0.0.1:{port}'
            try:
                st, *_ = get(base, '/api/healthz', timeout=8)
                if st == 200:
                    return base
            except Exception:
                continue
    return ''


print('=' * 60)
if not KEY:
    print('API_KEY not found in .env; cannot call the API.')
base = find_base()
print('panel url :', base or 'NOT FOUND')

try:
    rt = json.load(open(os.path.join(INST, 'runtime.json')))
except Exception:
    rt = {}
print('runtime   :', {k: rt.get(k) for k in ('workers', 'threads', 'timeout')}, '| WORKERS env:', env_value('WORKERS') or '-', 'THREADS env:', env_value('THREADS') or '-')

db = sqlite3.connect(os.path.join(INST, 'wg_panel.db'), timeout=30)
ifaces = db.execute("SELECT i.id, i.name, COUNT(p.id) FROM interface_config i LEFT JOIN peer p ON p.iface_id=i.id "
                    "WHERE i.node_id IS NULL GROUP BY i.id ORDER BY i.id").fetchall()
print('interfaces:', ', '.join(f'{n}(id {i}): {c} peers' for i, n, c in ifaces))

if base and KEY:
    print('\n== peer list API (/api/peers?iface_id=…) ==')
    for iid, name, cnt in ifaces:
        for attempt in (1, 2):
            try:
                st, size, took, hdr, _ = get(base, f'/api/peers?iface_id={iid}')
                print(f'  {name:8} try{attempt}: {took:6.2f}s  {size / 1048576:6.2f} MB  cache={hdr.get("X-Peers-Cache", "-"):5} server={hdr.get("X-Response-Time", "-")}s')
            except Exception as exc:
                print(f'  {name:8} try{attempt}: FAILED {exc}')
    try:
        st, size, took, *_ = get(base, '/api/healthz')
        print(f'  healthz        : {took:6.3f}s')
    except Exception as exc:
        print('  healthz FAILED', exc)

print('\n== interface lock busy time (10 s sample; enable/disable wait for this) ==')
import fcntl
lockdir = os.path.join(INST, 'locks')
for iid, name, cnt in ifaces:
    path = os.path.join(lockdir, f'{name}.alloc.lock')
    if not os.path.exists(path):
        print(f'  {name}: no lock file (never used)')
        continue
    busy = total = 0
    longest = cur = 0.0
    end = time.time() + 10
    with open(path, 'w') as fh:
        while time.time() < end:
            total += 1
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(fh, fcntl.LOCK_UN)
                cur = 0.0
            except BlockingIOError:
                busy += 1
                cur += 0.05
                longest = max(longest, cur)
            time.sleep(0.05)
    print(f'  {name}: busy {100.0 * busy / max(1, total):5.1f}% of the time, longest hold seen ≈ {longest:.1f}s')

print('\n== panel CPU (5 s) ==')
pid = subprocess.run(['systemctl', 'show', '-p', 'MainPID', '--value', 'wg-panel'], capture_output=True, text=True).stdout.strip()
pids = [pid] + subprocess.run(['pgrep', '-P', pid], capture_output=True, text=True).stdout.split() if pid and pid != '0' else []


def cpu_of(p):
    try:
        f = open(f'/proc/{p}/stat').read().rsplit(')', 1)[1].split()
        return int(f[11]) + int(f[12])
    except Exception:
        return 0


a = {p: cpu_of(p) for p in pids}
time.sleep(5)
hz = os.sysconf('SC_CLK_TCK')
for p in pids:
    print(f'  pid {p}: {100.0 * (cpu_of(p) - a[p]) / hz / 5:5.1f}% of one core')
print('=' * 60)

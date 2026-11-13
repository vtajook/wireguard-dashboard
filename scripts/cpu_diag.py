#!/usr/bin/env python3
"""Read-only CPU / network diagnosis for a busy WireGuard server.

    python3 /opt/WG_Panel/scripts/cpu_diag.py

Changes NOTHING. Measures where the CPU goes for a few seconds and prints
hints (in English + Persian) for the usual WireGuard bottlenecks.
"""
import os
import re
import subprocess
import time


def sh(cmd, timeout=10):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception:
        return ''


def read(path, default=''):
    try:
        with open(path) as fh:
            return fh.read().strip()
    except Exception:
        return default


def cpu_snapshot():
    rows = {}
    for line in read('/proc/stat').splitlines():
        if line.startswith('cpu'):
            p = line.split()
            rows[p[0]] = [int(x) for x in p[1:9]]   # user nice system idle iowait irq softirq steal
    return rows


def softirq_snapshot():
    out = {}
    lines = read('/proc/softirqs').splitlines()
    if not lines:
        return out
    cpus = lines[0].split()
    for line in lines[1:]:
        p = line.split()
        if p and p[0].rstrip(':') in ('NET_RX', 'NET_TX'):
            out[p[0].rstrip(':')] = [int(x) for x in p[1:1 + len(cpus)]]
    return out


def proc_times():
    out = {}
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        st = read(f'/proc/{pid}/stat')
        if not st:
            continue
        try:
            comm = st[st.index('(') + 1:st.rindex(')')]
            f = st[st.rindex(')') + 2:].split()
            out[int(pid)] = (comm, int(f[11]) + int(f[12]))
        except Exception:
            pass
    return out


hints = []
print('=' * 60)
print('kernel   :', os.uname().release)
model = re.search(r'model name\s*:\s*(.*)', read('/proc/cpuinfo'))
print('cpu      :', model.group(1) if model else '?', '| cores:', os.cpu_count())
hyp = sh("lscpu 2>/dev/null | grep -i hypervisor | awk -F: '{print $2}'").strip()
print('virtual  :', hyp or 'no / unknown')
print('load avg :', read('/proc/loadavg'))

SEC = 4
a, sa, pa = cpu_snapshot(), softirq_snapshot(), proc_times()
time.sleep(SEC)
b, sb, pb = cpu_snapshot(), softirq_snapshot(), proc_times()
hz = os.sysconf('SC_CLK_TCK')

print('\n== CPU split over %ds (percent of each core) ==' % SEC)
print(f"{'core':6}{'user':>7}{'system':>8}{'softirq':>9}{'steal':>7}{'iowait':>8}{'idle':>7}")
per_core_si = []
total = None
for name in sorted(b, key=lambda n: (n != 'cpu', int(n[3:] or -1) if n != 'cpu' else -1)):
    d = [y - x for x, y in zip(a.get(name, [0] * 8), b[name])]
    t = sum(d) or 1
    user, nice, system, idle, iow, irq, si, steal = [100.0 * v / t for v in d]
    print(f"{name:6}{user + nice:7.1f}{system + irq:8.1f}{si:9.1f}{steal:7.1f}{iow:8.1f}{idle:7.1f}")
    if name == 'cpu':
        total = dict(user=user + nice, system=system + irq, si=si, steal=steal, idle=idle)
    else:
        per_core_si.append(si)

if total:
    if total['steal'] > 8:
        hints.append(f"STEAL {total['steal']:.0f}%: the VPS host is overloaded and is not giving you the CPU you pay for. "
                     "No tuning fixes this; ask the provider or move to a less crowded host / dedicated cores.\n"
                     "  سرور مجازی شلوغ است و CPU کامل به شما نمی‌رسد؛ با تنظیمات درست نمی‌شود، باید هاست/پلن عوض شود.")
    if per_core_si and max(per_core_si) > 30 and max(per_core_si) > 3 * (sum(per_core_si) / len(per_core_si)):
        hints.append("ONE CORE does most of the network work (softirq). Spread it with RPS/RFS (see commands below).\n"
                     "  کار شبکه روی یک هسته جمع شده؛ با RPS بین هسته‌ها پخش شود.")

if sa and sb:
    print('\n== network softirqs per core (NET_RX per second) ==')
    rx = [(y - x) / SEC for x, y in zip(sa.get('NET_RX', []), sb.get('NET_RX', []))]
    print('  ' + '  '.join(f'cpu{i}:{int(v)}' for i, v in enumerate(rx)))

print('\n== top processes (CPU %% over %ds) ==' % SEC)
usage = []
for pid, (comm, t2) in pb.items():
    t1 = pa.get(pid, (comm, t2))[1]
    usage.append((100.0 * (t2 - t1) / hz / SEC, pid, comm))
usage.sort(reverse=True)
for pct, pid, comm in usage[:12]:
    if pct >= 0.5:
        print(f'  {pct:6.1f}%  {pid:>7}  {comm}')
panel = sum(p for p, pid, c in usage if 'python' in c or 'gunicorn' in c)
kworker = sum(p for p, pid, c in usage if c.startswith(('kworker', 'ksoftirqd', 'wg-crypt')))
print(f'  -> panel (python/gunicorn) total: {panel:.1f}%   kernel workers (kworker/ksoftirqd/wg-crypt): {kworker:.1f}%')

dev = ''
m = re.search(r'\bdev\s+(\S+)', sh('ip route get 1.1.1.1 2>/dev/null'))
if m:
    dev = m.group(1)
print('\n== network card:', dev or '?', '==')
if dev:
    drv = sh(f'ethtool -i {dev} 2>/dev/null | head -1')
    print(' ', drv or 'driver: ? (ethtool not installed: apt install ethtool)')
    ch = sh(f'ethtool -l {dev} 2>/dev/null')
    if ch:
        cur = re.findall(r'Combined:\s*(\d+)', ch)
        print('  queues (max / current):', ' / '.join(cur) if cur else ch.replace('\n', ' | ')[:120])
        if len(cur) == 2 and int(cur[1]) < int(cur[0]):
            hints.append(f"The card supports {cur[0]} queues but uses {cur[1]}: `ethtool -L {dev} combined {cur[0]}`.\n"
                         "  کارت شبکه صف‌های بیشتری دارد که استفاده نمی‌شود.")
    rxq = sorted(os.listdir(f'/sys/class/net/{dev}/queues')) if os.path.isdir(f'/sys/class/net/{dev}/queues') else []
    rps = [read(f'/sys/class/net/{dev}/queues/{q}/rps_cpus') for q in rxq if q.startswith('rx-')]
    print('  rx queues:', len(rps), '| RPS masks:', ', '.join(rps) or '-')
    rps_off = all(re.fullmatch(r'[0,]*', r or '0') for r in rps)
    feats = sh(f'ethtool -k {dev} 2>/dev/null')
    for key in ('generic-receive-offload', 'rx-udp-gro-forwarding', 'rx-gro-list', 'generic-segmentation-offload', 'tx-udp-segmentation'):
        mm = re.search(rf'^{key}:\s*(\S+)', feats, re.M)
        if mm:
            print(f'  {key}: {mm.group(1)}')
    if re.search(r'^rx-udp-gro-forwarding:\s*off', feats, re.M):
        hints.append(f"UDP GRO forwarding is off. Turning it on lets the kernel handle WireGuard packets in batches "
                     f"(often a large CPU saving): `ethtool -K {dev} rx-udp-gro-forwarding on rx-gro-list off`.\n"
                     "  UDP GRO خاموش است؛ روشن کردنش معمولاً مصرف CPU وایرگارد را کم می‌کند.")
    if len(rps) <= 1 and os.cpu_count() and os.cpu_count() > 1 and rps_off:
        mask = format((1 << os.cpu_count()) - 1, 'x')
        hints.append(f"The card has a single receive queue and RPS is off, so one core receives everything. "
                     f"Spread it: `echo {mask} > /sys/class/net/{dev}/queues/rx-0/rps_cpus` "
                     f"and `sysctl -w net.core.rps_sock_flow_entries=32768`.\n"
                     "  کارت شبکه فقط یک صف دارد و RPS خاموش است؛ همه‌ی کار روی یک هسته می‌رود.")

print('\n== MTU ==')
links = sh("ip -o link 2>/dev/null | awk '{print $2, $5}'")
mtus = {}
for line in links.splitlines():
    p = line.replace(':', '').split()
    if len(p) == 2:
        mtus[p[0]] = int(p[1]) if p[1].isdigit() else 0
for n, v in mtus.items():
    if n.startswith('wg') or n == dev:
        print(f'  {n}: {v}')
if dev in mtus:
    big = [n for n, v in mtus.items() if n.startswith('wg') and v > mtus[dev] - 80]
    if big:
        hints.append(f"WireGuard MTU too high for {dev} ({mtus[dev]}): {', '.join(big)}. Packets get fragmented "
                     f"(double work). Use MTU {mtus[dev] - 80} or lower on the server and in client configs.\n"
                     "  MTU وایرگارد بیشتر از حد مجاز است و بسته‌ها تکه‌تکه می‌شوند.")

print('\n== conntrack / firewall ==')
cnt = read('/proc/sys/net/netfilter/nf_conntrack_count')
mx = read('/proc/sys/net/netfilter/nf_conntrack_max')
print('  conntrack entries:', cnt or '-', '/ max', mx or '-')
if cnt and mx and int(mx) and int(cnt) > 0.8 * int(mx):
    hints.append(f"conntrack table almost full ({cnt}/{mx}): drops and CPU spikes. Raise it: "
                 f"`sysctl -w net.netfilter.nf_conntrack_max={int(mx) * 4}`.\n"
                 "  جدول conntrack تقریباً پر است.")
ports = sorted(set(re.findall(r'^\S+\t\S+\t\S+\t(\d+)', sh('wg show all dump 2>/dev/null | awk -F"\\t" \'NF==5\''), re.M)))
if not ports:
    ports = sorted(set(re.findall(r'listening port:\s*(\d+)', sh('wg show 2>/dev/null'))))
print('  WireGuard ports:', ', '.join(ports) or '?')
raw = sh('iptables -t raw -S 2>/dev/null')
rules = sh('iptables-save 2>/dev/null | grep -c "^-A"')
print('  iptables rules:', rules or '?')
if ports and raw is not None:
    covered = set()
    for m in re.finditer(r'--dport (\d+)(?::(\d+))?\b[^\n]*(?:NOTRACK|--notrack)', raw):
        lo = int(m.group(1)); hi = int(m.group(2) or lo)
        covered.update(str(x) for x in range(lo, hi + 1))
    notracked = [p for p in ports if p in covered]
    print('  conntrack skipped for WG ports:', ', '.join(notracked) or 'none')
    if len(notracked) < len(ports):
        hints.append("The encrypted WireGuard packets (UDP ports " + ', '.join(ports) + ") go through connection "
                     "tracking for no reason. Skipping it saves CPU on busy servers. Ask before applying: it needs a "
                     "matching INPUT accept rule if your firewall is strict.\n"
                     "  بسته‌های رمزشده‌ی وایرگارد بی‌دلیل از conntrack رد می‌شوند؛ حذفش CPU را کم می‌کند.")

gov = read('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor')
print('\n== cpu governor:', gov or 'n/a (normal on most VPS)', '==')
if gov and gov not in ('performance',):
    hints.append(f"CPU governor is '{gov}'. On a server 'performance' avoids slow clock ramp-up.\n"
                 "  حالت مصرف CPU روی performance نیست.")

print('\n' + '=' * 60)
if total:
    print(f"SUMMARY: user {total['user']:.0f}%  system {total['system']:.0f}%  softirq (network) {total['si']:.0f}%  "
          f"steal {total['steal']:.0f}%  idle {total['idle']:.0f}%   | panel {panel:.1f}% of one core")
print('HINTS:' if hints else 'HINTS: nothing obvious found.')
for i, h in enumerate(hints, 1):
    print(f' {i}. {h}')

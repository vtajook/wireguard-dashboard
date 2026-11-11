#!/usr/bin/env python3
"""One-time repair for the usage-inflation bug (fixed in 89d6747).

Run with the panel STOPPED (WireGuard keeps running, users stay connected):

    systemctl stop wg-panel && /opt/WG_Panel/venv/bin/python /opt/WG_Panel/scripts/repair_usage.py; systemctl start wg-panel

What it does
  * makes a backup copy of the database first (instance/wg_panel.db.before_usage_repair_<time>)
  * for every enabled peer that is in the WireGuard runtime: if the saved usage
    is bigger than the kernel counter (rx+tx since the peer was added), the
    saved usage is lowered to the kernel counter. Never raises anything.
  * blocked peers are not in the runtime (no counter) -> not changed, only listed
    when they were blocked for data in the last days and still have time left.

Add --dry-run to only print what would change.
"""
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry-run' in sys.argv


def db_path():
    url = os.environ.get('DATABASE_URL', '')
    if url.startswith('sqlite:///'):
        p = url[len('sqlite:///'):]
        return p if os.path.isabs(p) else os.path.join(ROOT, p)
    return os.path.join(ROOT, 'instance', 'wg_panel.db')


def gib(b):
    return f'{(b or 0) / 1073741824:.1f} GiB'


def main():
    app_py = open(os.path.join(ROOT, 'app.py'), encoding='utf-8', errors='replace').read()
    if 'def _accumulate_peer_usage(peer, live_total=None, persist=False)' not in app_py:
        print('STOP: the panel is not updated yet (usage would keep inflating). Update from Update Center first.')
        return 2

    try:
        active = subprocess.run(['systemctl', 'is-active', 'wg-panel'], capture_output=True, text=True).stdout.strip()
    except Exception:
        active = ''
    if active == 'active' and not DRY:
        print('STOP: wg-panel is running. Run: systemctl stop wg-panel  (users stay connected), then this script.')
        return 2

    raw = subprocess.check_output(['wg', 'show', 'all', 'dump'], text=True, timeout=60)
    live = {}
    for line in raw.splitlines():
        c = line.split('\t')
        if len(c) >= 9:
            live[(c[0], c[1])] = int(c[6] or 0) + int(c[7] or 0)

    path = db_path()
    src = sqlite3.connect(path, timeout=30)
    if not DRY:
        bak = f'{path}.before_usage_repair_{time.strftime("%Y%m%d_%H%M%S")}'
        dst = sqlite3.connect(bak)
        src.backup(dst)
        dst.close()
        print('backup:', bak)

    rows = src.execute(
        'SELECT p.id, p.name, i.name, p.public_key, p.status, COALESCE(p.used_bytes_total,0), '
        'COALESCE(p.data_limit_value,0), COALESCE(p.data_limit_unit,"Mi") '
        'FROM peer p JOIN interface_config i ON i.id = p.iface_id'
    ).fetchall()

    fixed, removed, samples = 0, 0, []
    for pid, name, iface, pub, status, used, lim, unit in rows:
        if status != 'online' or ':' in (iface or ''):
            continue
        cnt = live.get((iface, pub))
        if cnt is None:
            continue
        if used > cnt:
            fixed += 1
            removed += used - cnt
            samples.append((used - cnt, name, used, cnt))
            if not DRY:
                src.execute('UPDATE peer SET used_bytes_total=?, bytes_offset=? WHERE id=?', (cnt, cnt, pid))
    if not DRY:
        src.commit()

    samples.sort(reverse=True)
    print(f'{"would fix" if DRY else "fixed"}: {fixed} peers, removed {gib(removed)} of wrong usage')
    for _, name, used, cnt in samples[:15]:
        print(f'  {name}: {gib(used)} -> {gib(cnt)}')

    # data-blocked peers that still have time (possibly blocked by the bug)
    since = '2026-11-01'
    now = datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M:%S')
    blk = src.execute(
        "SELECT DISTINCT p.id, p.name, i.name, p.data_limit_value, p.data_limit_unit, p.expires_at "
        "FROM peer p JOIN interface_config i ON i.id=p.iface_id JOIN peer_event e ON e.peer_id=p.id "
        "WHERE p.status='blocked' AND COALESCE(p.data_limit_value,0) > 0 AND e.event='limit_reached' "
        "AND e.timestamp >= ? AND (p.expires_at IS NULL OR p.expires_at > ?) ORDER BY p.id",
        (since, now),
    ).fetchall()
    print(f'blocked for data since {since} and still have time: {len(blk)}')
    for pid, name, iface, lim, unit, exp in blk[:60]:
        print(f'  id={pid} {name} ({iface}) limit={lim}{unit} expires={exp}')
    src.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())

# WireGuard Dashboard — Changelog

The built-in updater, installer and `wgpanel` CLI pull from this repository
(`vtajook/wireguard-dashboard`). Set `WG_PANEL_REPO=owner/repo` in `.env` to use another one.

## 2026-11-11 — enforcement & stability audit

Tested end-to-end with a stateful fake `wg`/`ip`, real SQLite and 2000 peers.

- **Fractional data limits**: 0.5 GB was stored as 0 and the peer became
  *unlimited*; 10.5 GB became 10. Fractional GiB are now stored in MiB
  (create, bulk create and edit).
- **Admin-disabled peers** (`offline`) are no longer converted to `blocked`
  by the enforcer, so renewing them does not silently re-enable them.
- `POST /api/peer/<id>/enable` accepts `{"reset": false}` to re-enable
  without resetting used traffic and expiry (the panel UI keeps the old reset).
- `/api/peer/<id>/shortlink` always returned 404 (shadowed by the
  public-key route); fixed.
- Cross-process lock around every `.conf` rewrite: workers and the enforcer
  could overwrite each other's changes.
- Mass expiry is much faster: conf edits no longer scan the whole file in
  Python per peer, and the `wg show all dump` cache is kept when peers are removed.
- Re-enabled peers restart their traffic offset at 0.
- **Deleting a peer left a blackhole route on its IP**, so the next customer
  who got that IP had no internet. Delete now removes it, and interface
  startup removes stale blackholes left by older versions.
- Updater records the installed commit from the downloaded archive itself,
  so "update available" keeps working when the GitHub API is rate-limited.

## 2026-11 — first release

- Renamed to **WireGuard Dashboard**.

## Speed / stability
- Expiry & data-limit enforcement runs in one background enforcer (not inside HTTP requests).
- One `wg show all dump` per cycle instead of several `wg` calls per peer.
- SQLite WAL + busy_timeout; consistent DB snapshots for backups.
- gunicorn `gthread` workers; 30 s inactivity timeout on every client connection
  (stalled scanners can no longer freeze the panel). `WG_CONN_TIMEOUT` to change it.
- `/api/peers`: one query for all short links, cached timezone/endpoint lookups,
  4 s shared response cache (cleared on any write), gzip, slow-call logging.
- Static assets versioned and cached; settings file cached.

## Enforcement accuracy
- A failed/timed-out traffic read no longer double-counts usage.
- Blocked/disabled peers are removed from the `.conf` file too (do not return after restart).
- Editing a blocked peer does not reconnect it; renewing (more days/data) unblocks automatically.
- Failed disables are retried instead of being marked blocked while still connected.

## Features
- Interface subnet resize (e.g. `/24` → `/20`) with NAT rule rewrite; `/20` default for new interfaces.
- **Change link**: new keys + new user link, old config and link stop working; name, data, usage and expiry kept.
  API: `POST /api/peer/<id>/rotate`.
- Bulk delete with "select all in this filter". API: `POST /api/peers/bulk_delete` `{"ids": [...]}`.
- Single-peer lookup: `GET /api/peers?name=<name>` or `?id=<id>`.
- Responsive layout fixes for tablets / "desktop site" mode on phones (`static/css/responsive-fix.css`).

## Bug-hunt round (Nov 11)
- **Interface could be wiped under load**: the "is the interface up?" check ran a full `wg show <dev>` with a 1.5s timeout. On a busy server it timed out, the panel thought the interface was down and, while creating a peer, ran `ip link del` on the live interface (every user on it disconnected). Now uses a tiny `wg show <dev> public-key`, a slow answer counts as up, and an existing link is never deleted automatically.
- Runtime key checks (`allowed-ips`) timeout raised from 2s to 10s (a timeout made blocked peers stay in the kernel, or a delete be reported as done when it was not).
- Traffic is saved right before an interface goes down (resize / down / delete); before, the traffic since the last sample was lost.
- Dashboard peer counters: Total fixed (was always 0), uses the shared WireGuard snapshot, Offline tooltip shows idle vs disabled.
- Users page opens faster with thousands of peers.

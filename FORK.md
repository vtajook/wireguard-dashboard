# wireguard-dashboard — WG_Panel fork of [Azumi67/WG_Panel](https://github.com/Azumi67/WG_Panel)

This fork is based on upstream commit `f0f4106` and adds the following changes.
The panel's built-in updater, installer and `wg` CLI pull from this repository
(`vtajook/wireguard-dashboard`). Set `WG_PANEL_REPO=owner/repo` in `.env` to use another one.

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

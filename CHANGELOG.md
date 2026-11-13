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
- Unlimited-volume users (data limit 0, sold by the bot as time-only plans) now show how much they used ("X used · No cap") on the users page and on the customer page; before they showed "0 MiB left · 0 limit" or "No data allowance".
- Usage meter no longer flips from "remaining %" to "used %" after the first refresh; logs popup "Total usage" was doubled.
- **Usage inflation fixed**: web pages and the bot read usage from a 1-2s old WireGuard snapshot; when the enforcer had already saved a newer offset, the old value looked like a counter reset and the WHOLE counter was added again on every request (users showed hundreds of GB or TB). Usage is now written only by the enforcer (fresh snapshot each cycle) and by explicit actions; all other reads are read-only.
- Renewal of a peer that never really left the kernel no longer counts its whole counter again; reset-usage and enable read a fresh counter instead of a 2s old snapshot.
- **Renewals fixed**: an expired customer renewed with the same plan length stayed blocked ("no change"); first-use services were renewed from their first connection instead of from now (10 days left + 30 bought = 20). Edit API accepts "renew": true; the bot sends it.
- First use after a timer reset waits for a new connection (an old handshake from days ago used to start the timer immediately and the customer lost those days).
- Regular (not first-use) services no longer restart their timer at the first connection (a service created 3 days before the customer connected got 3 free days).
- Saving the edit form without touching the duration no longer restarts the timer of bot-renewed customers (the form drops minutes; renaming a customer 20 days into a renewal gave 20 free days).
- Update Center shows the installed commit next to the version (v2.1.0 · abcd1234) so it can be compared with the latest commit; VERSION bumped to 2.1.0.
- Resizing an interface while the bot creates users: creation waits for the resize, and the post-resize reconcile can no longer remove a user created in the same instant (it was dropped from WireGuard until the next restart); one creation used to fail with HTTP 500.
- **Security (CSRF)**: /api/ writes authenticated by the login cookie must now come from the panel itself (Sec-Fetch-Site, Origin fallback). A page on another subdomain of the same site could otherwise make the admin browser disable, delete or rotate peers. API-key callers (the bot) are unaffected.
- **Security (XSS)**: user names, phone numbers, Telegram IDs and event details were inserted into the users page as HTML; a name containing code ran in the admin browser (page load, edit, logs, more info, confirm dialogs). All are escaped now. Browser test covers every page and window that shows them.
- Users page and dashboard now use the same "online" rule (connected within the last 3 minutes); the users page used 45 seconds, so connected users flickered and the two counts never matched.
- Block, unblock, enable, edit and change-link take the same per-interface lock, so they cannot interleave with a reconcile or resize of that interface.
- Restoring a database backup now restarts the panel automatically (the background enforcer and other workers kept using the old database file until a manual restart).
- Reset timer no longer turns an admin-disabled service back on.
- Update Center keeps only the newest 10 code backups (they were never deleted).
- Database indexes added at startup (peer events, public key, name, status, admin log): peer deletes and log views no longer scan the whole event table.

## Single-user enforcement (one device per config)
- WireGuard cannot limit devices, but one key has only ONE endpoint at a time: when the same config is connected on two devices at once, its endpoint keeps switching between them. The panel reads `wg show all endpoints` every 5s and counts switches BACK to an endpoint already seen in the last 5 minutes. Roaming (Wi-Fi <-> mobile) and NAT port changes move to new endpoints and do not trigger it.
- Action (configurable from the **Single-user** button on the Peers page): disconnect the config for 10, 30, 120, 720 minutes on the 1st, 2nd, 3rd, 4th+ offense (forgotten after 24h without a new one), or only mark it. Exempt list by name or id.
- Users page: red "Multi-device · Nm" badge while disconnected, amber "Multi-device xN" for 24h, filter "Multi-device (24h)", click the badge to forgive and reconnect. Enable also lifts a penalty.
- Customer page shows "Paused" and a Persian/English notice with the minutes left.
- Traffic is saved before the disconnect; after the pause the peer reconnects automatically (unless it expired meanwhile). API: `GET/POST /api/single_user`, `POST /api/peer/<id>/clear_multi_device`, peer fields `shared_strikes`, `shared_last_at`, `shared_block_until`.

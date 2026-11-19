# WireGuard Dashboard — Changelog

The built-in updater, installer and `wgpanel` CLI pull from this repository
(`vtajook/wireguard-dashboard`). Set `WG_PANEL_REPO=owner/repo` in `.env` to use another one.

## 2026-11-20 — agent API fixes (2.2.4)

- Agent create: parallel requests (e.g. a bot sending many at once) could
  all pass the daily test quota and the max-users limit together. Creates of
  one agent now run one at a time (file lock, works across workers).
- install.sh on an existing git install: the remote is set to this
  repository first, so an older install that still points at another
  repository is not reset to that one.
- Agent users list: one database query per user was made to find its
  interface; interfaces are read once now (faster for agents with many
  users).

## 2026-11-20 — resellers page fixes (2.2.3)

- Security: a new reseller could be opened with the login cookie of a
  deleted reseller (SQLite reuses the deleted id and both started at session
  version 1). New resellers start at a random session version.
- Deleting a reseller also deletes its wallet ledger, so a new reseller that
  gets the same id does not inherit old transactions, test quota or spending.
- Charge: amounts typed with Persian digits (۵۰۰۰۰۰) or Persian separators
  were rejected; they are converted now.
- "Users on/off" no longer asks you to type "on" / "off": two plain
  confirmations (disable all, or re-enable).
- "Users on/off": when a few users failed, the result showed only as an
  error; it shows "done / failed" now.

## 2026-11-20 — agent panel fixes (2.2.2)

- Agent dialogs: an empty number box showed in confirm dialogs (delete,
  rotate…). Elements with the `hidden` attribute were shown when their class
  set `display`; this also showed empty result boxes. Fixed in the agent and
  resellers pages.
- Agent dialogs: closing a dialog with Back (phone) or Escape could run the
  action, because the reused dialog kept the "ok" answer of the previous one.
- Agent dialogs: Enter in the GB box pressed Cancel; it presses OK now.
  Decimal GB (e.g. 2.5) is accepted in renew / add dialogs.
- Agent list: changing the status filter or search clears the selection, so
  "delete selected" never deletes users that are no longer on screen.

## 2026-11-19 — bug fixes (2.2.1)

- Agent refund: deleting an unused agent user could refund more than was
  paid. SQLite reuses the id of a deleted last user, so payments of an older,
  already deleted user with the same id were counted too. Only payments made
  after the user was created count now.
- Agent renewal: if a renewal failed, the money came back but the user's
  usage had already been reset to zero. The usage is restored now.
- Agent volume users: a tiny volume (e.g. 0.0001 GB) rounded the cost to 0
  and made free accounts. Volume is in 0.1 GB steps, 0.1 GB minimum.
- Peers page: opening a peer from Diagnosis (edit link) said "peer is not in
  this interface" when the peer was on another page of the list; it is now
  loaded by id and the editor opens.

## 2026-11-18 — users' traffic on the dashboard

- New "Users' traffic" card on the dashboard: today, yesterday, last 7 days,
  this month, last month and all time (download / upload), plus a 30-day bar
  strip. Days follow the panel timezone.
- A background thread samples the byte counters of every WireGuard interface
  once a minute (`instance/traffic_stats.json`, ~13 months kept); interface
  restarts and reboots are handled. Counting starts when this version runs.
- API: `GET /api/traffic_stats`.
- Language button moved into the sidebar; sidebar bottom controls sit right
  under the menu.

## 2026-11-18 — peers page: server-side paging

- Local interfaces: search, status filter, sort and paging now run on the
  server (`GET /api/peers/page?iface_id=&page=&per=&q=&status=&sort=`). The
  browser receives only the visible page (8–50 peers) plus summary counts and
  the ids of all matching peers (for "Select all in this filter"), instead of
  every peer of the interface (≈4 MB for 2700 peers) on each refresh.
- The server builds the full list at most every ~8 s (or right after a change)
  and slices pages from it, so many open tabs do not multiply the work.
- Node scopes keep the previous full-list behaviour.

## 2026-11-18 — faster peers page on big interfaces

- Measured on the live server: the full peer list of wg0 (2737 peers) is
  3.8 MB and takes 1.3 s to build; the page downloaded and re-processed it
  every 5 seconds, and again after every click.
- Now, on interfaces with 400+ peers, the 5-second auto refresh asks only for
  the peers visible on screen (`/api/peers?ids=…`, a few KB) and the full list
  is reloaded once a minute or on an explicit refresh / interface change.
- Enable / disable / reset on one peer reloads just that peer.
- New read-only `scripts/speed_diag.py`.

## 2026-11-18 — safer peer card buttons

- Every action icon on a peer card now shows its name under it.
- **Enable** no longer wipes the peer: it used to reset used traffic, first
  use and the timer (time started again from the next connection). It now only
  re-enables (`reset:false`) and keeps usage and expiry.
- Enable, Disable, Reset data and Reset timer now ask for confirmation and say
  exactly what they do.

## 2026-11-18 — reseller GB price and agent API

- Resellers: new **Price per GB** (0 = monthly unlimited, as before) and
  optional **Extra month for GB users**. Volume user: GB × price/GB covers the
  first month, each further month costs the extra-month price (0 = free).
  Unlimited user: months × price/month. If price/month is 0 and price/GB is
  set, a GB amount is required. Same rules on renew (renew can set new GB).
- Agent API: each agent gets an API key (admin: Resellers → API, or the agent
  itself: API tab in /agent). Header `X-Agent-Key: rsk_…` on `/api/agent/*`
  lets the agent's own bot create / renew / disable / delete its users and
  read links and configs, paid from the same wallet. New: `GET
  /api/agent/peer/<id>`, `GET /api/agent/peer/by-name/<name>`.
- The admin login page also accepts reseller credentials and opens /agent;
  admin "Login as" opens a reseller's panel.

## 2026-11-18 — Persian (فارسی) language

- New **فارسی / English** button in the top bar (and the mobile top bar).
  The choice is saved per browser. With Persian, every admin page, dialog,
  toast and confirmation is shown in Persian (about 3,300 UI strings in
  `static/js/i18n-fa.js`, loaded only when Persian is chosen). User data —
  peer names, IPs, notes — is never changed. Layout stays left-to-right.
- Also on the login and first-setup pages. Customer link pages are unchanged.

## 2026-11-18 — update reload fix, sidebar handle

- After an update the page reloaded before the panel had actually restarted
  (the updater reports "completed" first and restarts a second later), so it
  showed an error and needed several manual refreshes. The page now waits
  until `/api/healthz` answers from the new panel process (new `boot` id) and
  then reloads once. Takes effect from the update *after* this one.
- Round button on the sidebar edge to expand / collapse it (desktop/tablet).
- Resellers page fits phone screens.

## 2026-11-18 — 2.2.0: reseller (agent) panel

- New **Resellers** page in the sidebar. For each agent you set: username and
  password, price per month (Toman), max users, allowed interfaces, free test
  accounts per 24h (length and MB), whether they may put a GB cap on users,
  and enabled/disabled. **Charge** adds money to the agent's wallet (a minus
  amount deducts). Every wallet movement is in the agent's **ledger**.
- Agents log in at **`/agent`** (own login page, Persian UI). They can only:
  create users (only on their allowed interfaces, only with enough balance —
  the price is taken from the wallet), create free test accounts, renew
  (remaining time is kept, traffic restarts from zero), disable / re-enable
  users they disabled themselves, delete users, copy the user link and
  download the config. Deleting a user that was never used within 48 h of
  creation refunds its cost.
- Agents are never logged in as the admin: every admin page and API stays
  closed to them, and they only ever see their own users.
- The admin sees the agent's users (Resellers → Users) and a reseller tag on
  each of those users on the Peers page, and can disable / re-enable all users
  of an agent at once. Deleting an agent keeps its users (they become yours).
- Fixed a crash in automatic backup error logging and a dead check for nodes
  without a public key.

## 2026-11-18 — delete expired peers per interface

- New **Delete expired** button next to Subnet/Delete on each local interface.
  It asks "expired at least N days ago" (0 = all), shows how many peers match,
  and deletes them in one batch after confirmation. A database copy is saved
  first in `instance/safety_copies/` (newest 3 kept).
- Peers in a subscription and first-use peers that never connected are never
  touched. API: `POST /api/iface/<id>/delete_expired` `{"dry_run": true, "older_than_days": 0}`.

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
- Auto-backup can run every hour, or every 2, 3, 6 or 12 hours (minute of the run time, counted from its hour).
- **Automatic network tuning** (at start and every 10 minutes; GET/POST /api/network_tuning, env WG_NET_TUNING=0 to disable): RPS on single-queue NICs (VPS virtio_net sent all receive work to one core), rx-udp-gro-forwarding, and NOTRACK for the WireGuard UDP ports when the INPUT firewall is not strict. Only default values are changed; rules are tagged "wg-panel-notrack" and removed when turned off.
- Dashboard CPU chart no longer drops to 0 (or jumps to 100): psutil keeps the previous sample per THREAD, and requests are served by different threads and workers, so a fresh thread compared two readings taken microseconds apart. CPU is now computed from /proc/stat with one sample shared by all workers.
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

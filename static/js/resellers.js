(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const say = (m, t = "info") => (window.notify ? window.notify(m, t, 3200) : alert(m));
  const confirmBox = (o) => (window.wgConfirm ? window.wgConfirm(o) : Promise.resolve(confirm(o.body || o.title)));
  const promptBox = (o) => (window.wgConfirm ? window.wgConfirm(o) : Promise.resolve(prompt(o.body || o.title, o.value || "")));
  const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : "—");
  const KIND = { charge: "Charge", adjust: "Deduct", create: "Create", renew: "Renew", refund: "Refund", test: "Test" };

  let DATA = { resellers: [], ifaces: [] };
  let editing = null;
  let detail = { id: null, view: "peers", q: "" };
  let qTimer = null;

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
    return j;
  }

  function ifaceNames(ids) {
    const m = new Map(DATA.ifaces.map((i) => [i.id, i.name]));
    const names = (ids || []).map((i) => m.get(i)).filter(Boolean);
    return names.length ? names.join(", ") : "no interface";
  }

  function render() {
    const body = $("#rs-body");
    if (!DATA.resellers.length) {
      body.innerHTML = '<tr><td colspan="8" class="rs-empty">No resellers yet. Create one with “New reseller”.</td></tr>';
      return;
    }
    body.innerHTML = DATA.resellers
      .map((r) => {
        const low = r.price_per_month > 0 && r.balance < r.price_per_month;
        return `<tr>
          <td data-label="Reseller"><div class="rs-name">${esc(r.username)}</div><div class="rs-sub">${esc(ifaceNames(r.iface_ids))}${r.note ? " · " + esc(r.note) : ""}</div></td>
          <td data-label="Status">${r.enabled ? '<span class="rs-badge ok">Active</span>' : '<span class="rs-badge bad">Disabled</span>'}</td>
          <td class="r" data-label="Wallet">${num(r.balance)}${low ? ' <span class="rs-badge warn">low</span>' : ""}</td>
          <td class="r" data-label="Price / month">${num(r.price_per_month)}${r.price_per_gb ? `<div class="rs-sub">+ ${num(r.price_per_gb)} / GB</div>` : '<div class="rs-sub">unlimited GB</div>'}</td>
          <td class="r" data-label="Users">${num(r.users)}${r.max_users ? " / " + num(r.max_users) : ""}<div class="rs-sub">${num(r.users_online_status)} active</div></td>
          <td class="r" data-label="Spent 30d">${num(r.spent_30d)}</td>
          <td data-label="Last login"><span class="rs-sub">${when(r.last_login_at)}</span></td>
          <td class="rs-acts-cell"><div class="acts">
            <button class="rs-btn sm primary" data-act="charge" data-id="${r.id}"><i class="fas fa-wallet"></i> Charge</button>
            <button class="rs-btn sm" data-act="peers" data-id="${r.id}">Users</button>
            <button class="rs-btn sm" data-act="txns" data-id="${r.id}">Ledger</button>
            <button class="rs-btn sm" data-act="loginas" data-id="${r.id}" title="Open this reseller's panel"><i class="fas fa-right-to-bracket"></i> Login as</button>
            <button class="rs-btn sm" data-act="apikey" data-id="${r.id}" title="Create a new API key for this reseller's bot"><i class="fas fa-key"></i> API${r.has_api_key ? " ✓" : ""}</button>
            <button class="rs-btn sm" data-act="edit" data-id="${r.id}">Edit</button>
            <button class="rs-btn sm" data-act="suspend" data-id="${r.id}" title="Disable / re-enable all users of this reseller">Users on/off</button>
            <button class="rs-btn sm danger" data-act="delete" data-id="${r.id}"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`;
      })
      .join("");
  }

  async function load() {
    DATA = await api("/api/resellers");
    render();
    if (detail.id) loadDetail();
  }

  function openForm(r) {
    editing = r || null;
    const f = $("#rs-form");
    f.reset();
    $("#rs-form-title").textContent = r ? `Edit ${r.username}` : "New reseller";
    $("#rs-pw-hint").textContent = r ? "(leave empty to keep)" : "(min 6)";
    f.password.required = !r;
    const v = r || { price_per_month: 0, price_per_gb: 0, max_users: 0, test_per_day: 2, test_hours: 24, test_mb: 200, allow_data_limit: true, enabled: true, iface_ids: [] };
    for (const k of ["username", "price_per_month", "price_per_gb", "max_users", "test_per_day", "test_hours", "test_mb", "note"]) {
      if (v[k] !== undefined) f[k].value = v[k];
    }
    f.allow_data_limit.checked = !!v.allow_data_limit;
    f.enabled.checked = !!v.enabled;
    $("#rs-iface-list").innerHTML = DATA.ifaces.length
      ? DATA.ifaces
          .map((i) => `<label><input type="checkbox" value="${i.id}" ${(v.iface_ids || []).includes(i.id) ? "checked" : ""}> ${esc(i.name)}</label>`)
          .join("")
      : '<span class="rs-sub">No local interfaces.</span>';
    $("#rs-form-error").hidden = true;
    $("#rs-form-dialog").showModal();
  }

  async function saveForm(e) {
    e.preventDefault();
    const f = $("#rs-form");
    const body = {
      username: f.username.value.trim(),
      price_per_month: Number(f.price_per_month.value || 0),
      price_per_gb: Number(f.price_per_gb.value || 0),
      max_users: Number(f.max_users.value || 0),
      test_per_day: Number(f.test_per_day.value || 0),
      test_hours: Number(f.test_hours.value || 24),
      test_mb: Number(f.test_mb.value || 200),
      note: f.note.value.trim(),
      allow_data_limit: f.allow_data_limit.checked,
      enabled: f.enabled.checked,
      iface_ids: [...document.querySelectorAll("#rs-iface-list input:checked")].map((x) => Number(x.value)),
    };
    if (f.password.value.trim()) body.password = f.password.value.trim();
    $("#rs-form-save").disabled = true;
    try {
      if (editing) await api(`/api/resellers/${editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/resellers", { method: "POST", body: JSON.stringify(body) });
      $("#rs-form-dialog").close();
      say(editing ? "Reseller saved" : "Reseller created", "success");
      await load();
    } catch (err) {
      const el = $("#rs-form-error");
      el.textContent = err.message;
      el.hidden = false;
    } finally {
      $("#rs-form-save").disabled = false;
    }
  }

  async function onTable(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const r = DATA.resellers.find((x) => String(x.id) === b.dataset.id);
    if (!r) return;
    const act = b.dataset.act;
    try {
      if (act === "edit") return openForm(r);
      if (act === "apikey") {
        const ok = await confirmBox({
          title: `API key for ${r.username}`,
          body: r.has_api_key
            ? `This reseller already has a key (…${r.api_key_hint}). A new key replaces it and the old one stops working.`
            : "Create an API key so this reseller can connect a bot to the agent API.",
          okText: "Create new key",
        });
        if (!ok) return;
        const j = await api(`/api/resellers/${r.id}/api_key`, { method: "POST", body: "{}" });
        try { await navigator.clipboard.writeText(j.api_key); } catch (_) {}
        await promptBox({ title: "API key (shown once, copied)", body: "Give this key to the reseller. It is not shown again.", value: j.api_key, okText: "Done" });
        await load();
        return;
      }
      if (act === "loginas") {
        const win = window.open("about:blank", "_blank");
        try {
          const j = await api(`/api/resellers/${r.id}/login_as`, { method: "POST", body: "{}" });
          if (win) win.location.href = j.url || "/agent";
          else location.href = j.url || "/agent";
        } catch (err) {
          if (win) win.close();
          throw err;
        }
        return;
      }
      if (act === "peers" || act === "txns") {
        detail = { id: r.id, view: act, q: "" };
        $("#rs-detail-q").value = "";
        return loadDetail();
      }
      if (act === "charge") {
        const v = await promptBox({
          title: `Charge ${r.username}`,
          body: `Wallet now: ${num(r.balance)} Toman. Amount to add (use a minus sign to deduct, e.g. -50000).`,
          value: "",
          okText: "Apply",
        });
        if (v == null || v === false || String(v).trim() === "") return;
        const amount = Number(String(v).replace(/[, ]/g, ""));
        if (!Number.isFinite(amount) || amount === 0) return say("Enter a number like 500000 or -50000", "error");
        const j = await api(`/api/resellers/${r.id}/charge`, { method: "POST", body: JSON.stringify({ amount }) });
        say(`${r.username}: wallet is now ${num(j.balance)}`, "success");
      } else if (act === "suspend") {
        const v = await promptBox({
          title: `Users of ${r.username}`,
          body: 'Type "off" to disable all active users of this reseller, or "on" to re-enable the users that were disabled this way.',
          value: "off",
          okText: "Apply",
        });
        if (!v || !["on", "off"].includes(String(v).trim().toLowerCase())) return;
        const suspend = String(v).trim().toLowerCase() === "off";
        b.disabled = true;
        const j = await api(`/api/resellers/${r.id}/suspend_users`, { method: "POST", body: JSON.stringify({ suspend }) });
        say(`${suspend ? "Disabled" : "Re-enabled"} ${j.done} users${j.failed ? `, ${j.failed} failed` : ""}`, j.failed ? "warning" : "success");
      } else if (act === "delete") {
        const ok = await confirmBox({
          title: `Delete reseller ${r.username}`,
          body: `The agent account is removed and can no longer log in. Its ${r.users} users are kept and become your own users. The wallet balance (${num(r.balance)}) is discarded.`,
          okText: "Delete",
        });
        if (!ok) return;
        await api(`/api/resellers/${r.id}`, { method: "DELETE" });
        if (detail.id === r.id) closeDetail();
        say("Reseller deleted", "success");
      }
      await load();
    } catch (err) {
      say(err.message, "error");
    } finally {
      b.disabled = false;
    }
  }

  function closeDetail() {
    detail.id = null;
    $("#rs-detail").hidden = true;
  }

  function size(b) {
    b = Number(b || 0);
    return b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : Math.round(b / 1048576) + " MB";
  }

  function left(p) {
    if (!p.started) return `first use · ${Math.round(p.days_total)} d`;
    if (!p.expires_at) return "—";
    const s = p.expires_at - Date.now() / 1000;
    if (s <= 0) return "expired";
    const d = Math.floor(s / 86400);
    return d ? `${d} d` : `${Math.floor(s / 3600)} h`;
  }

  function badge(p) {
    if (p.expired) return '<span class="rs-badge bad">Expired</span>';
    if (p.status === "blocked") return '<span class="rs-badge bad">Blocked</span>';
    if (p.status === "offline") return '<span class="rs-badge warn">Disabled</span>';
    if (p.online) return '<span class="rs-badge ok">Online</span>';
    return '<span class="rs-badge">Active</span>';
  }

  async function loadDetail() {
    const r = DATA.resellers.find((x) => x.id === detail.id);
    if (!r) return closeDetail();
    $("#rs-detail").hidden = false;
    $("#rs-detail-title").textContent = `${r.username} — ${detail.view === "peers" ? "users" : "wallet ledger"}`;
    document.querySelectorAll(".rs-seg button").forEach((x) => x.classList.toggle("active", x.dataset.view === detail.view));
    $("#rs-detail-q").hidden = detail.view !== "peers";
    const box = $("#rs-detail-body");
    if (detail.view === "peers") {
      const j = await api(`/api/resellers/${r.id}/peers?q=${encodeURIComponent(detail.q)}`);
      box.innerHTML = j.peers.length
        ? `<div class="rs-table-wrap"><table class="rs-table"><thead><tr><th>User</th><th>Interface</th><th>Status</th><th class="r">Left</th><th class="r">Used</th><th>Created</th></tr></thead><tbody>${j.peers
            .map(
              (p) => `<tr><td class="rs-name">${esc(p.name)}</td><td>${esc(p.iface)}</td><td>${badge(p)}${p.multi_device ? ' <span class="rs-badge warn">multi-device</span>' : ""}</td>
              <td class="r">${left(p)}</td><td class="r">${size(p.used_bytes)}${p.limit_bytes ? " / " + size(p.limit_bytes) : ""}</td><td><span class="rs-sub">${when(p.created_at)}</span></td></tr>`,
            )
            .join("")}</tbody></table></div><p class="rs-sub">${j.total} users${j.total > j.per ? ` (showing newest ${j.per})` : ""}. Manage any of them on the Peers page as usual.</p>`
        : '<div class="rs-empty">No users.</div>';
    } else {
      const j = await api(`/api/resellers/${r.id}/txns`);
      box.innerHTML = j.txns.length
        ? `<div class="rs-table-wrap"><table class="rs-table"><thead><tr><th>Time</th><th>Type</th><th>Details</th><th>By</th><th class="r">Amount</th><th class="r">Balance after</th></tr></thead><tbody>${j.txns
            .map(
              (t) => `<tr><td><span class="rs-sub">${when(t.at)}</span></td><td>${KIND[t.kind] || esc(t.kind)}</td>
              <td>${esc([t.peer_name, t.months ? t.months + " mo" : "", t.note].filter(Boolean).join(" · "))}</td><td>${esc(t.actor)}</td>
              <td class="r ${t.amount > 0 ? "pos" : t.amount < 0 ? "neg" : ""}">${t.amount > 0 ? "+" : ""}${num(t.amount)}</td><td class="r">${num(t.balance_after)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<div class="rs-empty">No transactions.</div>';
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#rs-login-url").textContent = location.origin + "/agent";
    $("#rs-new").addEventListener("click", () => openForm(null));
    $("#rs-form").addEventListener("submit", saveForm);
    $("#rs-form-cancel").addEventListener("click", () => $("#rs-form-dialog").close());
    $("#rs-body").addEventListener("click", onTable);
    $("#rs-detail-close").addEventListener("click", closeDetail);
    document.querySelectorAll(".rs-seg button").forEach((b) =>
      b.addEventListener("click", () => {
        detail.view = b.dataset.view;
        loadDetail().catch((e) => say(e.message, "error"));
      }),
    );
    $("#rs-detail-q").addEventListener("input", (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        detail.q = e.target.value.trim();
        loadDetail().catch((err) => say(err.message, "error"));
      }, 300);
    });
    load().catch((e) => say(e.message, "error"));
  });
})();

(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const fa = (n) => Number(n || 0).toLocaleString("fa-IR");
  const toman = (n) => fa(n) + " تومان";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const KIND = { charge: "شارژ", adjust: "کسر / اصلاح", create: "ساخت", renew: "تمدید", refund: "برگشت وجه", test: "تست" };
  const MONTH_LABEL = (m) => (m === 12 ? "یک ساله" : fa(m) + " ماهه");
  let ME = null;
  let page = 1;
  let qTimer = null;

  function toast(msg, bad) {
    const t = $("#ag-toast");
    t.textContent = msg;
    t.className = "ag-toast show" + (bad ? " bad" : "");
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.className = "ag-toast"), 3200);
  }

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...opts,
    });
    if (r.status === 401) {
      location.href = "/agent/login";
      throw new Error("login");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.detail || j.error || "خطا " + r.status);
    return j;
  }

  function ask({ title, body, options, okText }) {
    const d = $("#ag-dialog");
    $("#d-title").textContent = title;
    $("#d-body").textContent = body || "";
    const sel = $("#d-select");
    sel.hidden = !options;
    sel.innerHTML = (options || []).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    $("#d-ok").textContent = okText || "تأیید";
    return new Promise((res) => {
      d.addEventListener("close", () => res(d.returnValue === "ok" ? (options ? sel.value : true) : null), { once: true });
      d.showModal();
    });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("کپی شد");
  }

  function costNow() {
    if (!ME) return 0;
    return (ME.price_per_month || 0) * Number($("#c-months").value || 1);
  }

  function renderMe() {
    $("#ag-user").textContent = ME.username;
    $("#ag-balance").textContent = toman(ME.balance);
    $("#st-price").textContent = toman(ME.price_per_month);
    $("#st-users").textContent = fa(ME.users) + (ME.max_users ? " / " + fa(ME.max_users) : "");
    $("#st-tests").textContent = ME.test_per_day ? fa(ME.tests_used_24h) + " / " + fa(ME.test_per_day) : "غیرفعال";
    $("#st-spent").textContent = toman(ME.spent_30d);
    $("#c-test").hidden = !ME.test_per_day;
    $("#c-data-wrap").hidden = !ME.allow_data_limit;
    const ifs = $("#c-iface");
    if (!ifs.options.length) {
      ifs.innerHTML = ME.ifaces.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
      $("#c-months").innerHTML = ME.months.map((m) => `<option value="${m}">${MONTH_LABEL(m)}</option>`).join("");
    }
    $("#c-iface-wrap").hidden = ME.ifaces.length <= 1;
    $("#c-cost").textContent = toman(costNow());
    $("#ag-low").hidden = !(ME.price_per_month > 0 && ME.balance < ME.price_per_month);
    $("#c-submit").disabled = !ME.ifaces.length;
  }

  async function loadMe() {
    const j = await api("/api/agent/me");
    ME = j.me;
    renderMe();
  }

  function statusBadge(p) {
    if (p.expired) return '<span class="ag-badge bad">منقضی</span>';
    if (p.status === "blocked") return '<span class="ag-badge bad">مسدود</span>';
    if (p.status === "offline") return '<span class="ag-badge warn">غیرفعال</span>';
    if (p.multi_device) return '<span class="ag-badge warn">چندکاربره</span>';
    if (p.online) return '<span class="ag-badge ok">آنلاین</span>';
    if (!p.started) return '<span class="ag-badge">استفاده نشده</span>';
    return '<span class="ag-badge">فعال</span>';
  }

  function remaining(p) {
    if (!p.started) return "شروع از اولین اتصال · " + fa(Math.round(p.days_total)) + " روز";
    if (!p.expires_at) return "—";
    const s = p.expires_at - Date.now() / 1000;
    if (s <= 0) return "تمام شده";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? fa(d) + " روز" + (h ? " و " + fa(h) + " ساعت" : "") : fa(h) + " ساعت";
  }

  function size(b) {
    b = Number(b || 0);
    if (b >= 1073741824) return fa((b / 1073741824).toFixed(1)) + " گیگ";
    return fa(Math.round(b / 1048576)) + " مگ";
  }

  async function loadPeers() {
    const q = encodeURIComponent($("#u-q").value.trim());
    const j = await api(`/api/agent/peers?page=${page}&per=50&q=${q}`);
    $("#u-total").textContent = fa(j.total) + " کاربر";
    const pages = Math.max(1, Math.ceil(j.total / j.per));
    $("#u-page").textContent = fa(page) + " / " + fa(pages);
    $("#u-prev").disabled = page <= 1;
    $("#u-next").disabled = page >= pages;
    const list = $("#u-list");
    if (!j.peers.length) {
      list.innerHTML = '<div class="ag-empty">هنوز کاربری نساخته‌اید</div>';
      return;
    }
    list.innerHTML = j.peers
      .map((p) => {
        const usage = size(p.used_bytes) + (p.limit_bytes ? " از " + size(p.limit_bytes) : " · نامحدود");
        const toggle =
          p.status === "online"
            ? `<button class="ag-btn sm" data-act="off" data-id="${p.id}">غیرفعال</button>`
            : p.reseller_disabled
              ? `<button class="ag-btn sm" data-act="on" data-id="${p.id}">فعال کن</button>`
              : "";
        return `<div class="ag-row">
          <div><div class="nm" title="${esc(p.name)}">${esc(p.name)}</div><div class="sub">${esc(p.iface)}</div></div>
          <div>${statusBadge(p)}</div>
          <div class="num">${remaining(p)}</div>
          <div class="num">${usage}</div>
          <div class="acts">
            ${p.link ? `<button class="ag-btn sm" data-act="link" data-link="${esc(p.link)}">لینک</button>` : ""}
            <a class="ag-btn sm" href="/api/agent/peer/${p.id}/config">کانفیگ</a>
            <button class="ag-btn sm primary" data-act="renew" data-id="${p.id}" data-name="${esc(p.name)}">تمدید</button>
            ${toggle}
            <button class="ag-btn sm danger" data-act="del" data-id="${p.id}" data-name="${esc(p.name)}" data-fresh="${!p.started || !p.used_bytes ? 1 : 0}">حذف</button>
          </div>
        </div>`;
      })
      .join("");
  }

  async function loadTxns() {
    const j = await api("/api/agent/txns");
    const list = $("#t-list");
    if (!j.txns.length) {
      list.innerHTML = '<div class="ag-empty">تراکنشی ثبت نشده</div>';
      return;
    }
    list.innerHTML =
      `<div class="ag-txn ag-muted"><span>زمان</span><span>نوع</span><span>شرح</span><span class="amt">مبلغ</span><span class="amt">موجودی بعد</span></div>` +
      j.txns
        .map((t) => {
          const when = new Date(t.at * 1000).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
          const desc = [t.peer_name, t.months ? MONTH_LABEL(t.months) : "", t.note].filter(Boolean).join(" · ");
          return `<div class="ag-txn"><span>${when}</span><span>${KIND[t.kind] || esc(t.kind)}</span><span>${esc(desc)}</span>
            <span class="amt ${t.amount > 0 ? "pos" : t.amount < 0 ? "neg" : ""}">${t.amount > 0 ? "+" : ""}${fa(t.amount)}</span>
            <span class="amt">${fa(t.balance_after)}</span></div>`;
        })
        .join("");
  }

  function showResult(j) {
    const box = $("#c-result");
    box.hidden = false;
    box.innerHTML = `<strong>${esc(j.name)} ساخته شد${j.cost ? " · " + toman(j.cost) : ""}</strong>
      ${j.link ? `<code>${esc(j.link)}</code><button class="ag-btn sm" type="button" data-act="link" data-link="${esc(j.link)}">کپی لینک</button>` : ""}
      <a class="ag-btn sm" href="/api/agent/peer/${j.id}/config">دانلود کانفیگ</a>`;
  }

  async function create(test) {
    const name = $("#c-name").value.trim();
    if (!name) {
      $("#c-name").focus();
      return;
    }
    const body = {
      name,
      iface_id: Number($("#c-iface").value || 0),
      months: Number($("#c-months").value || 1),
      data_gb: Number($("#c-data").value || 0),
      start_on_first_use: $("#c-first").checked,
      test: !!test,
    };
    if (!test) {
      const ok = await ask({
        title: "ساخت کاربر",
        body: `${name} · ${MONTH_LABEL(body.months)}\nهزینه: ${toman(costNow())}\nموجودی بعد: ${toman(ME.balance - costNow())}`,
        okText: "ساخت",
      });
      if (!ok) return;
    }
    const btns = [$("#c-submit"), $("#c-test")];
    btns.forEach((b) => (b.disabled = true));
    try {
      const j = await api("/api/agent/peers", { method: "POST", body: JSON.stringify(body) });
      showResult(j);
      $("#c-name").value = "";
      toast(test ? "اکانت تست ساخته شد" : "کاربر ساخته شد");
      page = 1;
      await Promise.all([loadMe(), loadPeers()]);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btns.forEach((b) => (b.disabled = false));
      renderMe();
    }
  }

  async function onListClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const id = b.dataset.id;
    if (act === "link") return copy(b.dataset.link);
    try {
      if (act === "renew") {
        const m = await ask({
          title: "تمدید " + b.dataset.name,
          body: "مدت تمدید را انتخاب کنید. زمان باقی‌مانده حفظ می‌شود و حجم مصرفی صفر می‌شود.",
          options: ME.months.map((x) => ({ value: x, label: MONTH_LABEL(x) + " · " + toman(ME.price_per_month * x) })),
          okText: "تمدید",
        });
        if (!m) return;
        b.disabled = true;
        await api(`/api/agent/peer/${id}/renew`, { method: "POST", body: JSON.stringify({ months: Number(m) }) });
        toast("تمدید شد");
      } else if (act === "off" || act === "on") {
        b.disabled = true;
        await api(`/api/agent/peer/${id}/toggle`, { method: "POST", body: JSON.stringify({ enable: act === "on" }) });
        toast(act === "on" ? "فعال شد" : "غیرفعال شد");
      } else if (act === "del") {
        const ok = await ask({
          title: "حذف " + b.dataset.name,
          body:
            "کاربر برای همیشه حذف می‌شود و کانفیگش کار نمی‌کند." +
            (b.dataset.fresh === "1"
              ? `\nاگر تا ${fa(ME.refund_hours)} ساعت بعد از ساخت هیچ استفاده‌ای نکرده باشد، هزینه‌اش به کیف پول برمی‌گردد.`
              : "\nبرای کاربری که استفاده کرده هزینه‌ای برنمی‌گردد."),
          okText: "حذف",
        });
        if (!ok) return;
        b.disabled = true;
        const j = await api(`/api/agent/peer/${id}`, { method: "DELETE" });
        toast(j.refund ? "حذف شد · " + toman(j.refund) + " برگشت داده شد" : "حذف شد");
      }
      await Promise.all([loadMe(), loadPeers()]);
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("#ag-create").addEventListener("submit", (e) => {
      e.preventDefault();
      create(false);
    });
    $("#c-test").addEventListener("click", () => create(true));
    $("#c-months").addEventListener("change", () => ($("#c-cost").textContent = toman(costNow())));
    $("#u-list").addEventListener("click", onListClick);
    $("#c-result").addEventListener("click", onListClick);
    $("#u-q").addEventListener("input", () => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        page = 1;
        loadPeers().catch((e) => toast(e.message, true));
      }, 300);
    });
    $("#u-prev").addEventListener("click", () => { page = Math.max(1, page - 1); loadPeers(); });
    $("#u-next").addEventListener("click", () => { page += 1; loadPeers(); });
    document.querySelectorAll(".ag-tabs button").forEach((t) =>
      t.addEventListener("click", () => {
        document.querySelectorAll(".ag-tabs button").forEach((x) => x.classList.toggle("active", x === t));
        $("#tab-users").hidden = t.dataset.tab !== "users";
        $("#tab-txns").hidden = t.dataset.tab !== "txns";
        if (t.dataset.tab === "txns") loadTxns().catch((e) => toast(e.message, true));
      }),
    );
    try {
      await loadMe();
      await loadPeers();
    } catch (e) {
      if (e.message !== "login") toast(e.message, true);
    }
    setInterval(() => { if (!document.hidden && !$("#tab-users").hidden) loadPeers().catch(() => {}); }, 30000);
  });
})();

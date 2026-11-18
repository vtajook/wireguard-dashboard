/* Users' traffic card on the dashboard: today / yesterday / 7 days /
   this month / last month / all time + a 30-day bar strip. */
(() => {
  "use strict";
  const fmt = (b) => {
    b = Number(b || 0);
    const u = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(b >= 100 || i === 0 ? 0 : b >= 10 ? 1 : 2)} ${u[i]}`;
  };
  const sum = (v) => Number((v || [0, 0])[0] || 0) + Number((v || [0, 0])[1] || 0);

  function css() {
    if (document.getElementById("ts-style")) return;
    const st = document.createElement("style");
    st.id = "ts-style";
    st.textContent = `
      .ts-card{--ts-bg:#fff;--ts-line:rgba(127,127,127,.22);--ts-muted:#6b7486;--ts-down:#3b82f6;--ts-up:#10b981;
        background:var(--card-bg,var(--ts-bg));border:1px solid var(--border,var(--ts-line));border-radius:16px;padding:16px 18px;margin:0 0 18px;color:inherit}
      html[data-theme=dark] .ts-card{--ts-bg:#171c25;--ts-muted:#8e97a8}
      .ts-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .ts-head h3{margin:0;font-size:16px}
      .ts-head small{color:var(--ts-muted)}
      .ts-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
      .ts-box{border:1px solid var(--border,var(--ts-line));border-radius:12px;padding:10px 12px;min-width:0}
      .ts-box span{display:block;font-size:12px;color:var(--ts-muted)}
      .ts-box b{display:block;font-size:18px;font-variant-numeric:tabular-nums;margin:2px 0}
      .ts-box i{font-style:normal;font-size:11px;color:var(--ts-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
      .ts-bars{display:flex;align-items:flex-end;gap:3px;height:70px;margin-top:14px}
      .ts-bars div{flex:1;min-width:3px;background:linear-gradient(var(--ts-up) var(--up,0%),var(--ts-down) 0);border-radius:3px 3px 0 0;opacity:.85}
      .ts-bars div:hover{opacity:1}
      .ts-legend{display:flex;gap:14px;font-size:11px;color:var(--ts-muted);margin-top:6px}
      .ts-legend em{display:inline-block;width:9px;height:9px;border-radius:2px;margin-inline-end:4px;vertical-align:-1px}
      @media(max-width:980px){.ts-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:520px){.ts-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(st);
  }

  function mount() {
    const anchor = document.querySelector(".nx-page-head") || document.querySelector(".dashboard-topbar");
    if (!anchor) return null;
    css();
    const card = document.createElement("section");
    card.className = "ts-card";
    card.id = "ts-card";
    card.innerHTML = `<div class="ts-head"><h3>Users' traffic</h3><small id="ts-since"></small></div>
      <div class="ts-grid" id="ts-grid"></div>
      <div class="ts-bars" id="ts-bars" aria-label="Last 30 days"></div>
      <div class="ts-legend"><span><em style="background:var(--ts-down)"></em>Download</span><span><em style="background:var(--ts-up)"></em>Upload</span><span>Last 30 days</span></div>`;
    anchor.after(card);
    return card;
  }

  async function load(card) {
    try {
      const r = await fetch("/api/traffic_stats", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!r.ok) return;
      const j = await r.json();
      const box = (label, v) =>
        `<div class="ts-box"><span>${label}</span><b>${fmt(sum(v))}</b><i>↓ ${fmt((v || [])[0])} · ↑ ${fmt((v || [])[1])}</i></div>`;
      card.querySelector("#ts-grid").innerHTML =
        box("Today", j.today) + box("Yesterday", j.yesterday) + box("Last 7 days", j.week) +
        box("This month", j.month) + box("Last month", j.last_month) + box("All time", j.total);
      card.querySelector("#ts-since").textContent = j.since ? `Counting since ${j.since} · ${j.timezone || ""}` : "Counting starts now";
      const max = Math.max(1, ...(j.daily || []).map((d) => d.down + d.up));
      card.querySelector("#ts-bars").innerHTML = (j.daily || [])
        .map((d) => {
          const t = d.down + d.up;
          const h = Math.max(t ? 3 : 1, Math.round((t / max) * 100));
          const up = t ? Math.round((d.up / t) * 100) : 0;
          return `<div style="height:${h}%;--up:${up}%" title="${d.day}: ${fmt(t)} (↓ ${fmt(d.down)} · ↑ ${fmt(d.up)})"></div>`;
        })
        .join("");
    } catch (_) {}
  }

  function start() {
    const card = mount();
    if (!card) return;
    load(card);
    setInterval(() => !document.hidden && load(card), 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

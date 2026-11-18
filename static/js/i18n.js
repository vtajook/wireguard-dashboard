/* Panel language switch (English / فارسی).
 *
 * The panel is written in English. When Persian is chosen, this script loads
 * a dictionary (i18n-fa.js) and translates visible UI text in place: text
 * nodes, placeholders, titles, tooltips and native dialogs. A MutationObserver
 * keeps translating content that pages render later (peer cards, toasts,
 * dialogs). Only known UI strings are changed, so user data stays as it is.
 * The choice is stored per browser (localStorage "wgp:lang").
 */
(() => {
  "use strict";
  const KEY = "wgp:lang";
  let lang = "en";
  try {
    lang = localStorage.getItem(KEY) === "fa" ? "fa" : "en";
  } catch (_) {}

  const script = document.currentScript;
  const base = script && script.src ? script.src.replace(/i18n\.js(\?.*)?$/, "") : "/static/js/";

  function setLang(next) {
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {}
    location.reload();
  }
  window.wgpSetLang = setLang;
  window.wgpLang = lang;

  function addToggle() {
    if (document.getElementById("wgp-lang-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "wgp-lang-toggle";
    btn.className = "wgp-lang-toggle";
    btn.setAttribute("data-no-i18n", "");
    btn.title = lang === "fa" ? "Switch to English" : "تغییر زبان به فارسی";
    btn.innerHTML =
      '<i class="fas fa-language" aria-hidden="true"></i><span>' + (lang === "fa" ? "English" : "فارسی") + "</span>";
    btn.addEventListener("click", () => setLang(lang === "fa" ? "en" : "fa"));
    const top = document.querySelector(".nx-topbar");
    const mobile = document.getElementById("wg-mobile-topbar");
    if (top && top.offsetParent !== null) {
      top.appendChild(btn);
    } else {
      btn.classList.add("floating");
      document.body.appendChild(btn);
    }
    if (mobile) {
      const m = btn.cloneNode(true);
      m.id = "wgp-lang-toggle-m";
      m.classList.remove("floating");
      m.classList.add("mobile");
      m.addEventListener("click", () => setLang(lang === "fa" ? "en" : "fa"));
      mobile.appendChild(m);
      document.documentElement.classList.add("has-m-lang");
    }
  }

  const css = document.createElement("style");
  css.textContent =
    ".wgp-lang-toggle{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;margin-left:10px;border-radius:999px;" +
    "border:1px solid rgba(148,163,184,.4);background:transparent;color:inherit;font:600 13px/1 Vazirmatn,Tahoma,sans-serif;cursor:pointer;white-space:nowrap}" +
    ".wgp-lang-toggle:hover{background:rgba(148,163,184,.15)}" +
    ".wgp-lang-toggle.floating{position:fixed;top:12px;right:16px;z-index:1500;background:#fff;color:#1b2230;box-shadow:0 2px 10px rgba(0,0,0,.12)}" +
    "html[data-theme=dark] .wgp-lang-toggle.floating{background:#171c25;color:#e6e9ef}" +
    ".wgp-lang-toggle.mobile{margin-left:auto;color:#e6eef5}" +
    "@media (max-width:760px){html.has-m-lang .wgp-lang-toggle.floating{display:none}}" +
    "@media (min-width:761px){.wgp-lang-toggle.mobile{display:none}}" +
    "html[data-design=modern] .wgp-lang-toggle.mobile{color:inherit}" +
    "html.lang-fa body{font-family:Vazirmatn,Tahoma,'Segoe UI',system-ui,sans-serif}" +
    "html.i18n-pending body{visibility:hidden}";
  document.head.appendChild(css);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addToggle);
  else addToggle();

  if (lang !== "fa") return;

  document.documentElement.classList.add("lang-fa", "i18n-pending");
  document.documentElement.setAttribute("lang", "fa");
  const reveal = () => document.documentElement.classList.remove("i18n-pending");
  setTimeout(reveal, 2500);

  // ---------- translator ----------
  let EX = null;
  let TPL = [];
  const memo = new Map();
  const NUM = /[0-9][0-9,.]*/g;
  const numTpl = new Map();

  function prepare(dict) {
    EX = new Map(Object.entries(dict.e || {}));
    TPL = [];
    for (const [k, v] of Object.entries(dict.t || {})) {
      const raw = k.split("{x}");
      const kinds = [];
      let src = "^" + esc(raw[0]);
      for (let i = 1; i < raw.length; i++) {
        // "{x}" glued to a word ("config{x}", "polic{x}") is an English plural suffix
        const plural = /[A-Za-z]$/.test(raw[i - 1]);
        kinds.push(plural);
        src += (plural ? "([a-z]{0,3})" : "(.+?)") + esc(raw[i]);
      }
      TPL.push([new RegExp(src + "$"), v, kinds, raw.join("").length]);
      numTpl.set(k, [v, kinds]);
    }
    TPL.sort((a, b) => b[3] - a[3]);
  }

  function esc(p) {
    return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function fill(v, vals, kinds) {
    let i = 0;
    return v.replace(/\{x\}/g, () => {
      const k = i++;
      if (kinds && kinds[k]) return "";
      return k < vals.length ? vals[k] : "";
    });
  }

  function tr(core) {
    if (memo.has(core)) return memo.get(core);
    let out = EX.get(core);
    if (out === undefined) {
      const nums = core.match(NUM);
      if (nums) {
        const t = numTpl.get(core.replace(NUM, "{x}"));
        if (t !== undefined) out = fill(t[0], nums, t[1]);
      }
    }
    if (out === undefined && core.length < 240 && /[A-Za-z]{3}/.test(core)) {
      for (const [re, v, kinds] of TPL) {
        const m = core.match(re);
        if (m) {
          out = fill(v, m.slice(1).map((x) => (EX.get(x) !== undefined ? EX.get(x) : x)), kinds);
          break;
        }
      }
    }
    if (out === undefined) out = null;
    if (memo.size > 20000) memo.clear();
    memo.set(core, out);
    return out;
  }

  function trFull(s) {
    if (!s || !/[A-Za-z]/.test(s)) return null;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const core = m[2].replace(/\s+/g, " ");
    if (!core) return null;
    const t = tr(core);
    if (t === null) {
      // "Label:" style strings
      const c2 = core.replace(/[:：]$/, "");
      if (c2 !== core) {
        const t2 = tr(c2);
        if (t2 !== null) return m[1] + t2 + ":" + m[3];
      }
      return null;
    }
    return m[1] + t + m[3];
  }
  window.wgpT = (s) => (EX ? trFull(String(s)) || s : s);

  const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "NOSCRIPT", "SVG", "KBD"]);
  const ATTRS = ["placeholder", "title", "aria-label", "data-tip", "data-title"];

  function skipEl(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (SKIP.has(n.tagName) || n.hasAttribute("data-no-i18n") || n.isContentEditable) return true;
    }
    return false;
  }

  function doText(node) {
    const p = node.parentElement;
    if (!p || skipEl(p)) return;
    const t = trFull(node.nodeValue);
    if (t !== null && t !== node.nodeValue) node.nodeValue = t;
  }

  function doAttrs(el) {
    if (el.hasAttribute("data-no-i18n")) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) {
        const t = trFull(v);
        if (t !== null && t !== v) el.setAttribute(a, t);
      }
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) {
      const t = trFull(el.value);
      if (t !== null) el.value = t;
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (skipEl(root)) return;
      doAttrs(root);
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (SKIP.has(n.tagName) || n.hasAttribute("data-no-i18n")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) {
        if (/[A-Za-z]/.test(n.nodeValue)) {
          const t = trFull(n.nodeValue);
          if (t !== null && t !== n.nodeValue) n.nodeValue = t;
        }
      } else {
        doAttrs(n);
      }
    }
  }

  // batch mutations
  const pending = new Set();
  let scheduled = false;
  function flush() {
    scheduled = false;
    const items = [...pending];
    pending.clear();
    for (const n of items) {
      if (n.isConnected) walk(n);
    }
  }
  function queue(n) {
    pending.add(n);
    if (!scheduled) {
      scheduled = true;
      (window.queueMicrotask || setTimeout)(flush);
    }
  }

  function start() {
    try {
      walk(document.body);
    } finally {
      reveal();
    }
    const t = trFull(document.title);
    if (t) document.title = t;
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => queue(n));
        } else if (m.type === "characterData") {
          queue(m.target);
        } else if (m.type === "attributes") {
          const el = m.target;
          const v = el.getAttribute(m.attributeName);
          if (v && /[A-Za-z]/.test(v) && !skipEl(el)) {
            const tv = trFull(v);
            if (tv !== null && tv !== v) el.setAttribute(m.attributeName, tv);
          }
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    // native dialogs
    const wrap = (name) => {
      const orig = window[name];
      if (typeof orig !== "function") return;
      window[name] = function (msg, ...rest) {
        return orig.call(window, msg == null ? msg : window.wgpT(String(msg)), ...rest);
      };
    };
    wrap("alert");
    wrap("confirm");
    wrap("prompt");
  }

  function boot() {
    if (!window.WGP_I18N_FA) return;
    prepare(window.WGP_I18N_FA);
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
  }

  if (window.WGP_I18N_FA) {
    boot();
  } else {
    const s = document.createElement("script");
    s.src = base + "i18n-fa.js?v=" + (script && script.dataset.v ? script.dataset.v : "1");
    s.onload = boot;
    s.onerror = reveal;
    document.head.appendChild(s);
  }
})();

/* Single-user enforcement: settings window + "forgive" on a user's badge.
   One config = one device. When a config is used on two devices at the same
   time, its endpoint keeps switching between them; the panel detects that and
   (optionally) disconnects the config for a while. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t = 'info') => (window.showToast ? window.showToast(m, t) : console.log(m));

  async function api(path, opts = {}) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }, opts));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
    return j;
  }

  function addButton() {
    const clear = $('#peer-filter-clear');
    if (!clear || $('#wgp-single-user-btn')) return !!clear;
    const b = document.createElement('button');
    b.id = 'wgp-single-user-btn';
    b.type = 'button';
    b.className = 'btn secondary';
    b.title = 'One config = one device: detect and stop simultaneous use on several devices';
    b.innerHTML = '<i class="fas fa-user-lock" aria-hidden="true"></i><span>Single-user</span>';
    b.addEventListener('click', openSettings);
    clear.after(b);
    return true;
  }

  async function openSettings() {
    let data;
    try { data = await api('/api/single_user'); } catch (e) { toast('Could not load settings: ' + e.message, 'error'); return; }
    const s = data.settings || {};
    const dlg = document.createElement('dialog');
    dlg.className = 'panel-dialog wgp-su-dialog';
    dlg.innerHTML = `
      <form method="dialog" class="wgp-su-form">
        <span class="panel-dialog-symbol" aria-hidden="true"><i class="fas fa-user-lock"></i></span>
        <h2>Single-user (one device per config)</h2>
        <p class="wgp-su-help">When the same config is connected on two devices at the same time, WireGuard keeps switching the user's address between them. The panel watches for that every few seconds. Roaming between Wi-Fi and mobile data does not count.</p>
        <p class="wgp-su-stats"><b>${Number(data.penalized_now || 0)}</b> disconnected right now · <b>${Number(data.flagged_24h || 0)}</b> detected in the last 24h</p>
        <label class="wgp-su-row"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> <span>Enabled</span></label>
        <label class="wgp-su-field"><span>When detected</span>
          <select name="action" class="input">
            <option value="block" ${s.action === 'block' ? 'selected' : ''}>Disconnect the config for a while</option>
            <option value="flag" ${s.action === 'flag' ? 'selected' : ''}>Only mark it (no disconnect)</option>
          </select></label>
        <label class="wgp-su-field"><span>Disconnect minutes for 1st, 2nd, 3rd… offense</span>
          <input name="penalties_min" class="input" value="${esc((s.penalties_min || []).join(', '))}" placeholder="10, 30, 120, 720"></label>
        <label class="wgp-su-field"><span>Offenses are forgotten after (hours without a new one)</span>
          <input name="forgive_hours" type="number" min="1" class="input" value="${esc(s.forgive_hours)}"></label>
        <label class="wgp-su-field"><span>Sensitivity: switches between devices needed within ${Math.round((s.window_sec || 300) / 60)} min (lower = stricter)</span>
          <input name="min_returns" type="number" min="3" max="100" class="input" value="${esc(s.min_returns)}"></label>
        <label class="wgp-su-field"><span>Allowed on several devices (names or IDs, comma separated)</span>
          <textarea name="exempt" class="input" rows="2" placeholder="family_plan_1, 245">${esc((s.exempt || []).join(', '))}</textarea></label>
        <footer><button type="button" value="cancel" class="btn secondary">Cancel</button><button value="ok" class="btn">Save</button></footer>
      </form>`;
    document.body.appendChild(dlg);
    dlg.querySelector('[value=cancel]').onclick = () => dlg.close('cancel');
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue === 'ok') {
        const f = dlg.querySelector('form');
        const payload = {
          enabled: f.enabled.checked,
          action: f.action.value,
          penalties_min: f.penalties_min.value,
          forgive_hours: Number(f.forgive_hours.value || 24),
          min_returns: Number(f.min_returns.value || 6),
          exempt: f.exempt.value,
        };
        try { await api('/api/single_user', { method: 'POST', body: JSON.stringify(payload) }); toast('Single-user settings saved', 'success'); }
        catch (e) { toast('Could not save: ' + e.message, 'error'); }
      }
      dlg.remove();
    }, { once: true });
    dlg.showModal();
  }

  async function forgive(card) {
    const id = card?.dataset?.id;
    if (!id) return;
    const name = card.dataset.name || id;
    const ok = await (window.wgConfirm
      ? window.wgConfirm({ title: 'Forgive multi-device use', body: `Clear the multi-device offenses of "${name}" and reconnect it now if it is serving a penalty?`, okText: 'Forgive' })
      : Promise.resolve(confirm('Forgive and reconnect?')));
    if (!ok) return;
    try {
      const j = await api(`/api/peer/${encodeURIComponent(id)}/clear_multi_device`, { method: 'POST', body: '{}' });
      toast(j.reenabled ? 'Forgiven and reconnected' : 'Offenses cleared', 'success');
      if (window.wgpRefreshPeers) window.wgpRefreshPeers({ force: true });
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  document.addEventListener('click', (e) => {
    const tag = e.target.closest?.('.peer-tag.multi-device');
    if (!tag) return;
    e.preventDefault(); e.stopPropagation();
    forgive(tag.closest('.peer-card'));
  }, true);

  if (!addButton()) {
    const mo = new MutationObserver(() => { if (addButton()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
})();

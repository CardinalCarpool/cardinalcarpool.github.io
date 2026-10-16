// Small UI helpers shared by the main page and the admin dashboard.
(function () {
  const { esc, isoToMDY, mdyToIso } = window.CC;

  function toast(message, isError) {
    const wrap = document.getElementById('toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), isError ? 5000 : 3500);
  }

  // MM/DD/YYYY text input with auto-inserted slashes, plus a calendar button that opens
  // a hidden native date picker and copies the result back in MM/DD/YYYY.
  function initDateField(wrap) {
    const text = wrap.querySelector('input[type="text"]');
    const native = wrap.querySelector('input[type="date"]');
    const btn = wrap.querySelector('.cal-btn');
    text.addEventListener('input', (e) => {
      if (e.inputType && e.inputType.startsWith('delete')) return;
      const digits = text.value.replace(/\D/g, '').slice(0, 8);
      let out = digits.slice(0, 2);
      if (digits.length > 2) out += '/' + digits.slice(2, 4);
      if (digits.length > 4) out += '/' + digits.slice(4);
      if (digits.length === 2 || digits.length === 4) out += '/';
      text.value = out;
    });
    text.addEventListener('blur', () => {
      text.setAttribute('aria-invalid', text.value && !mdyToIso(text.value) ? 'true' : 'false');
    });
    btn.addEventListener('click', () => {
      native.value = mdyToIso(text.value) || '';
      if (native.showPicker) {
        try { native.showPicker(); return; } catch (e) { /* fall through */ }
      }
      native.focus();
      native.click();
    });
    native.addEventListener('change', () => {
      text.value = isoToMDY(native.value);
      text.setAttribute('aria-invalid', 'false');
      text.dispatchEvent(new Event('change', { bubbles: true }));
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function fillLocations(select, anyLabel) {
    const opts = (anyLabel ? [`<option value="">${esc(anyLabel)}</option>`] : ['<option value="" disabled selected>Choose a dorm…</option>'])
      .concat(window.CC.LOCATIONS.map((l) => `<option>${esc(l)}</option>`))
      .concat(['<option>Other</option>']);
    select.innerHTML = opts.join('');
  }

  // ---------- Share the website ----------
  const SHARE_TEXT = 'Heading to the airport? Find a Stanford student to split a ride with on Cardinal Carpool:';
  const ICONS = {
    text: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    email: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  };

  function shareUrl() {
    return location.href.split('#')[0].split('?')[0].replace(/admin\.html$/, '');
  }

  function openShare() {
    const dlg = document.getElementById('shareDialog');
    const url = shareUrl();
    const body = `${SHARE_TEXT} ${url}`;
    const native = navigator.share
      ? '<button class="btn btn-primary btn-block" type="button" id="shareNative">Share…</button>'
      : '';
    dlg.innerHTML = `
      <div class="dialog-body" style="position:relative">
        <button class="btn btn-ghost btn-sm dialog-close" type="button" aria-label="Close" data-close>✕</button>
        <h2 id="shareTitle">Share Cardinal Carpool</h2>
        <p class="sub" style="color:var(--muted);margin:0">More people posting means more ride matches.</p>
        <div class="share-grid">
          <a class="btn btn-ghost" href="sms:?&body=${encodeURIComponent(body)}">${ICONS.text}Text a friend</a>
          <a class="btn btn-ghost" href="mailto:?subject=${encodeURIComponent('Split a ride to the airport?')}&body=${encodeURIComponent(body)}">${ICONS.email}Email</a>
        </div>
        ${native}
        <div class="share-link" style="margin-top:12px">
          <input type="text" readonly value="${esc(url)}" aria-label="Website link">
          <button class="btn btn-ghost" type="button" id="copyLink">Copy</button>
        </div>
      </div>`;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelector('#copyLink').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied!');
      } catch (e) {
        dlg.querySelector('.share-link input').select();
      }
    };
    const nb = dlg.querySelector('#shareNative');
    if (nb) nb.onclick = () => navigator.share({ title: 'Cardinal Carpool', text: SHARE_TEXT, url }).catch(() => {});
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.showModal();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-share]')) openShare();
  });

  window.UI = { toast, initDateField, fillLocations, openShare };
})();

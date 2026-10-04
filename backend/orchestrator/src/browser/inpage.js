// Injected into every page the browser agent opens (context.addInitScript).
// Plain JS on purpose: TypeScript transpilers add helpers that don't exist in page context.
// Elements are "marked" with data-hl="<n>" so the Node side can act on them with real
// Playwright clicks (trusted events) instead of synthetic DOM clicks.
(() => {
  if (window.__holdless) return;
  let counter = 0;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function mark(el) {
    if (!el.dataset.hl) el.dataset.hl = String(++counter);
    return `[data-hl="${el.dataset.hl}"]`;
  }

  function textOf(el) {
    return clean(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '');
  }

  function labelOf(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    const wrap = input.closest('label');
    if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
    if (input.getAttribute('aria-label')) return clean(input.getAttribute('aria-label'));
    let node = input.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      const t = clean(node.innerText);
      if (t && t.length < 400) return t;
    }
    return '';
  }

  /** Visible thing a user could click: the input itself, or its label when the input is styled away. */
  function clickTarget(input) {
    if (visible(input)) return input;
    if (input.id) {
      const l = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (l && visible(l)) return l;
    }
    const wrap = input.closest('label');
    if (wrap && visible(wrap)) return wrap;
    let node = input.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) if (visible(node)) return node;
    return input;
  }

  const CLICKABLE = 'a, button, input[type=submit], input[type=button], [role=button], [role=link]';

  function clickables() {
    return [...document.querySelectorAll(CLICKABLE)].filter((el) => visible(el) && !el.disabled && textOf(el));
  }

  function tokenScore(text, tokens) {
    if (!tokens.length) return 0;
    const t = text.toLowerCase();
    return tokens.filter((tok) => t.includes(tok)).length / tokens.length;
  }

  window.__holdless = {
    signature() {
      const h = [...document.querySelectorAll('h1, h2')].slice(0, 3).map((e) => clean(e.innerText)).join('|');
      return `${location.href}|${(document.body && document.body.innerText.length) || 0}|${h}`;
    },

    pageText() {
      return clean(document.body ? document.body.innerText : '').slice(0, 20000);
    },

    isLogin() {
      return !!document.querySelector('#ap_email, #ap_password, input[name="email"][type="email"], form[name="signIn"]');
    },

    /** First visible clickable whose text matches the regex. */
    findByText(source, flags) {
      const re = new RegExp(source, flags);
      const el = clickables().find((e) => re.test(textOf(e)));
      return el ? { selector: mark(el), text: textOf(el) } : null;
    },

    /** "Return or replace items" control inside the order card that best matches the item / order number. */
    findReturnLink(arg) {
      const re = new RegExp(arg.linkSource, 'i');
      const tokens = arg.tokens || [];
      const order = (arg.orderNumber || '').trim();
      let best = null;
      for (const el of clickables()) {
        if (!re.test(textOf(el))) continue;
        let node = el.parentElement;
        let card = null;
        for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
          const t = clean(node.innerText);
          if (t.length > 120) {
            card = node;
            if (/order\s*(placed|#)|\d{3}-\d{7}-\d{7}/i.test(t) || tokenScore(t, tokens) > 0) break;
          }
        }
        const text = card ? clean(card.innerText) : '';
        let score = tokenScore(text, tokens);
        if (order && text.includes(order)) score += 2;
        if (!best || score > best.score) best = { selector: mark(el), score, snippet: text.slice(0, 240) };
      }
      return best;
    },

    checkboxes() {
      return [...document.querySelectorAll('input[type=checkbox]')]
        .filter((i) => !i.disabled && visible(clickTarget(i)))
        .map((i) => ({ selector: mark(i), target: mark(clickTarget(i)), label: labelOf(i).slice(0, 300), checked: i.checked }));
    },

    radioGroups() {
      const groups = {};
      for (const i of document.querySelectorAll('input[type=radio]')) {
        if (i.disabled || !visible(clickTarget(i))) continue;
        const key = i.name || `__${mark(i)}`;
        (groups[key] = groups[key] || []).push({
          selector: mark(i),
          target: mark(clickTarget(i)),
          label: labelOf(i).slice(0, 300),
          checked: i.checked,
        });
      }
      return Object.entries(groups).map(([name, options]) => ({ name, options }));
    },

    selects() {
      return [...document.querySelectorAll('select')]
        .filter((s) => !s.disabled && (visible(s) || visible(s.parentElement)))
        .map((s) => ({
          selector: mark(s),
          options: [...s.options].map((o) => clean(o.text)),
          selectedIndex: s.selectedIndex,
          label: labelOf(s).slice(0, 200),
        }));
    },

    /** Sets a native select and fires the events framework widgets listen for. */
    setSelect(selector, index) {
      const s = document.querySelector(selector);
      if (!s) return false;
      s.selectedIndex = index;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return s.selectedIndex === index;
    },

    textareas() {
      return [...document.querySelectorAll('textarea')]
        .filter((t) => visible(t) && !t.disabled && !t.readOnly)
        .map((t) => ({ selector: mark(t), value: t.value, label: labelOf(t).slice(0, 200) }));
    },

    /** Compact list of visible clickables for the LLM fallback. */
    describeClickables(limit) {
      return clickables()
        .slice(0, limit)
        .map((el) => ({ selector: mark(el), tag: el.tagName.toLowerCase(), text: textOf(el).slice(0, 80) }));
    },

    qrImage() {
      const img = [...document.querySelectorAll('img, canvas, svg')].find(
        (e) => visible(e) && /qr/i.test(`${e.getAttribute('alt') || ''} ${e.getAttribute('src') || ''} ${e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || ''} ${e.getAttribute('aria-label') || ''}`),
      );
      return img ? mark(img) : null;
    },
  };
})();

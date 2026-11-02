// Small helpers shared by every page: safe HTML, formatting, icons,
// toasts and dialogs. No framework, just plain JavaScript modules.

// ----------------------------------------------------------- safe HTML
// html`<p>${name}</p>` escapes `name`, so a customer called
// "<script>" can never run code on the page.
class Raw {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}
export const raw = (text) => new Raw(String(text));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ----------------------------------------------------------- formatting
export function rupees(paise) {
  const value = (paise || 0) / 100;
  return '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: value % 1 ? 2 : 0, minimumFractionDigits: value % 1 ? 2 : 0 });
}
/** Short money: ₹1.2L, ₹45.6K */
export function rupeesShort(paise) {
  const value = (paise || 0) / 100;
  if (value >= 100000) return '₹' + (value / 100000).toFixed(value >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'L';
  if (value >= 10000) return '₹' + (value / 1000).toFixed(0) + 'K';
  if (value >= 1000) return '₹' + (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return '₹' + Math.round(value);
}

/** 'YYYY-MM-DD HH:MM:SS' (local time) -> Date */
export function parseDate(text) {
  if (!text) return null;
  const [d, t = '00:00:00'] = text.split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm, ss] = t.split(':').map(Number);
  return new Date(y, m - 1, day, hh, mm, ss || 0);
}
export const fmtDate = (text) => parseDate(text)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) ?? '';
export const fmtShort = (text) => parseDate(text)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) ?? '';
export const fmtTime = (text) => parseDate(text)?.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) ?? '';
export function fmtDateTime(text) {
  const d = parseDate(text);
  if (!d) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = fmtTime(text);
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${fmtShort(text)}, ${time}`;
}
export function ago(days) {
  if (days === null || days === undefined) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return 'over a year ago';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtBirthday(mmdd) {
  if (!mmdd) return '';
  const [m, d] = mmdd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
export const fmtPhone = (p) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : '');
export const fmtCode = (c) => (c ? `${c.slice(0, 3)}-${c.slice(3)}` : '');
export const initials = (name) =>
  String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** CSS class for a level badge: lvl-0 (first level) ... lvl-N */
export function levelClass(levelName, tiers = []) {
  const index = tiers.findIndex((t) => t.name === levelName);
  return `badge lvl-${Math.max(index, 0)}`;
}

// ----------------------------------------------------------- icons
const ICONS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
  counter: '<path d="M5.5 3.5h13v17l-2.6-1.7-2.2 1.7-1.7-1.3-1.7 1.3-2.2-1.7-2.6 1.7z"/><path d="M9 8.5h6M9 12.5h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.6 14.8c1.6.8 2.6 2.6 2.9 5.2"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4.5" rx="1"/><path d="M5.5 12.5v8h13v-8M12 8v12.5"/><path d="M12 8c-1.3-3.6-5-4-5-1.6C7 8 12 8 12 8zm0 0c1.3-3.6 5-4 5-1.6C17 8 12 8 12 8z"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M6.5 17v-6M11 17V6.5M15.5 17v-8M20 17v-3.5"/>',
  sliders: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M14.5 4h4A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>',
  printer: '<path d="M6.5 9V3.5h11V9M6.5 17.5h-2A1.5 1.5 0 0 1 3 16v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1.5 1.5 0 0 1-1.5 1.5h-2"/><rect x="6.5" y="14" width="11" height="6.5" rx="1"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  chat: '<path d="M4.5 19.5 5.8 16A7.8 7.8 0 1 1 8.6 18.6z"/><path d="M9 10.5c.4 1.8 2.2 3.6 4.4 4.2l1.2-1.2 1.8.8"/>',
  more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19M6 14.5h4"/>',
  cake: '<path d="M4.5 20.5v-8h15v8M3 20.5h18M4.5 15.5c2.5 1.4 5 1.4 7.5 0s5-1.4 7.5 0M12 12.5V9"/><path d="M12 4.5c1 1 1 2.5 0 2.5s-1-1.5 0-2.5z"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13.5h10L18 7M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19.5 8.5l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5h1.5M19.5 14H20"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2L9.5 4.5h5L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
};
export function icon(name, cls = 'icon') {
  return raw(
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
  );
}

export const LOGO_MARK = raw(`<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
  <circle cx="20" cy="20" r="19" fill="#f2a007"/>
  <path d="M29.5 20a9.5 9.5 0 1 1-9.5-9.5c2.7 0 5.2 1.1 7.1 2.9l2.4 2.4" fill="none" stroke="#1b2140" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M29.5 9.6v6.2h-6.2" fill="none" stroke="#1b2140" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`);

let stampSeed = 0;
/** A violet rubber-stamp impression (used for loyalty stamps). */
export function inkStamp(extraClass = '') {
  stampSeed += 1;
  const id = `ink${stampSeed}`;
  return raw(`<svg class="ink-stamp ${extraClass}" viewBox="0 0 48 48" aria-hidden="true">
    <defs><filter id="${id}" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="${stampSeed}" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -3.4 0 0 0 2.5" result="speckle"/>
      <feComposite in="SourceGraphic" in2="speckle" operator="in"/>
    </filter></defs>
    <g filter="url(#${id})" fill="none" stroke="currentColor">
      <circle cx="24" cy="24" r="21" stroke-width="2.8"/>
      <circle cx="24" cy="24" r="16.5" stroke-width="1.2"/>
      <path d="M16 24.5l5.3 5.3L32.5 18.3" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`);
}

// ----------------------------------------------------------- toasts
function toastArea() {
  let area = $('.toast-area');
  if (!area) {
    area = document.createElement('div');
    area.className = 'toast-area';
    area.setAttribute('role', 'status');
    area.setAttribute('aria-live', 'polite');
    document.body.append(area);
  }
  return area;
}
export function toast(message, { error = false, action, timeout = 4000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = html`<span>${message}</span>${action ? html`<button type="button">${action.label}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      el.remove();
      action.onClick();
    });
  }
  toastArea().append(el);
  setTimeout(() => el.remove(), timeout);
}
export const toastError = (err) => toast(err?.message || String(err), { error: true, timeout: 6000 });

// ----------------------------------------------------------- dialogs
/**
 * Opens a dialog. `body` is html``. Returns the <dialog> element.
 * Buttons: [{ label, className, onClick(dialog) }]. Return false from
 * onClick to keep the dialog open.
 */
export function openDialog({ title, body, buttons = [], onClose }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = html`
    <div class="modal-head">
      <h2>${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${buttons.length ? html`<div class="modal-foot">${buttons.map((b, i) => html`<button type="button" class="btn ${b.className || ''}" data-btn="${i}">${b.label}</button>`)}</div>` : ''}
  `;
  document.body.append(dialog);
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  buttons.forEach((b, i) => {
    dialog.querySelector(`[data-btn="${i}"]`).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const keepOpen = b.onClick ? (await b.onClick(dialog)) === false : false;
        if (!keepOpen) dialog.close();
      } catch (err) {
        toastError(err);
      } finally {
        btn.disabled = false;
      }
    });
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  dialog.showModal();
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openDialog({
      title,
      body: html`<p>${message}</p>`,
      buttons: [
        { label: 'Cancel', className: 'btn-ghost' },
        { label: confirmLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}

/**
 * Opens a new tab right away (so the browser does not block it as a pop-up),
 * then sends it to the URL that `getUrl()` returns after talking to the server.
 */
export async function openInNewTab(getUrl) {
  const tab = window.open('about:blank', '_blank');
  try {
    const url = await getUrl();
    if (tab) tab.location.href = url;
    else location.href = url;
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    window.prompt('Copy this:', text);
  }
}

/** Reads all named fields of a <form> into a plain object (checkboxes -> true/false). */
export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
    else data[el.name] = el.value;
  }
  return data;
}

/** Shows an error message inside a form (or clears it). */
export function formError(form, message) {
  let box = form.querySelector('.form-error');
  if (!message) { box?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = message;
}

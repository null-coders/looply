// "Bring back" screen: win-back offers for customers who stopped coming,
// birthday offers, and the results of offers already sent.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import {
  $, ago, fmtBirthday, fmtShort, html, icon, openInNewTab, plural, rupees, toast, toastError,
} from '../ui.js';

const { me, page } = await startPage('offers', 'Bring back');
const s = me.program.settings;
const TABS = [
  ['missing', 'Stopped coming'],
  ['birthdays', 'Birthdays'],
  ['sent', 'Offers sent'],
];
let tab = TABS.some(([k]) => `#${k}` === location.hash) ? location.hash.slice(1) : 'missing';

page.innerHTML = html`
  <div class="page-head">
    <div><h1>Bring customers back</h1>
      <p>Send a personal offer on WhatsApp. Each message opens in WhatsApp, ready to send.</p></div>
    <div class="actions"><a class="btn" href="/app/rewards#offers">${icon('sliders')} Change offer amounts</a></div>
  </div>
  <div class="tabs" role="tablist" aria-label="Offer lists" style="margin-bottom:16px">
    ${TABS.map(([k, l]) => html`<button type="button" role="tab" data-tab="${k}" aria-selected="${String(k === tab)}">${l}<span class="count" data-count="${k}"></span></button>`)}
  </div>
  <section class="panel" id="content"><div class="loading">Loading</div></section>`;

const content = $('#content');

// Each list is loaded once and kept until something changes.
const cache = {};
const SOURCES = {
  missing: () => api.get('/offers/missing').then((d) => d.customers),
  birthdays: () => api.get('/offers/birthdays').then((d) => d.customers),
  sent: () => api.get('/coupons').then((d) => d.coupons),
};
function load(kind) {
  if (!cache[kind]) {
    cache[kind] = SOURCES[kind]().then((list) => {
      $(`[data-count="${kind}"]`).textContent = list.length;
      return list;
    });
    cache[kind].catch(() => delete cache[kind]);
  }
  return cache[kind];
}
function refreshCounts() {
  for (const kind of Object.keys(SOURCES)) load(kind).catch(() => {});
}

async function sendCoupon(customerId, kind, button) {
  button.disabled = true;
  try {
    await openInNewTab(async () => {
      const result = await api.post(`/customers/${customerId}/coupons`, { kind });
      toast(result.reused ? 'Offer was already running, sending it again.' : `Coupon ${result.coupon.code} created.`);
      return result.whatsappUrl;
    });
    for (const kind of Object.keys(SOURCES)) delete cache[kind];
    await render();
    refreshCounts();
  } catch (err) {
    toastError(err);
    button.disabled = false;
  }
}

async function renderMissing() {
  const customers = await load('missing');
  if (!customers.length) {
    content.innerHTML = html`<div class="empty"><h3>Nobody has stopped coming</h3>
      <p>Customers who do not visit for ${s.inactive_after_days} days will show up here.</p></div>`;
    return;
  }
  const canSend = customers.filter((c) => c.consent && !(c.offer && c.offer.status === 'active')).length;
  content.innerHTML = html`
    <p class="intro">These ${plural(customers.length, 'customer')} came before, but not in the last ${s.inactive_after_days} days. Biggest spenders are at the top.
      The offer is <strong>${s.winback_percent}% off</strong>, valid for ${plural(s.winback_days, 'day')}.
      ${canSend ? html`You can send it to ${canSend} right now.` : ''}</p>
    <div class="list">${customers.map((c) => html`
      <div class="list-item offer-row">
        <div class="grow">
          <a class="title" href="/app/customer?id=${c.id}">${c.name}</a>
          <div class="small muted">Last came ${ago(c.daysSinceLastVisit)}, ${plural(c.visits, 'visit')}, spent ${rupees(c.spent)}</div>
        </div>
        <div class="offer-action">
          ${c.offer && c.offer.status === 'active'
            ? html`<span class="badge good">Sent ${fmtShort(c.offer.sentAt)}, valid till ${fmtShort(c.offer.expiresAt)}</span>
                   <button type="button" class="btn btn-sm" data-send="${c.id}">Send again</button>`
            : c.offer && c.offer.status === 'expired'
              ? html`<span class="badge">Last offer expired</span>${c.consent ? html`<button type="button" class="btn btn-whatsapp btn-sm" data-send="${c.id}">${icon('chat', 'icon icon-sm')} Send new offer</button>` : ''}`
              : c.consent
                ? html`<button type="button" class="btn btn-whatsapp btn-sm" data-send="${c.id}">${icon('chat', 'icon icon-sm')} Send ${s.winback_percent}% offer</button>`
                : html`<span class="small muted" title="Ask them at the counter and tick WhatsApp offers on their profile">Has not agreed to offers</span>`}
        </div>
      </div>`)}</div>`;
  content.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => sendCoupon(b.dataset.send, 'winback', b)));
}

async function renderBirthdays() {
  const customers = await load('birthdays');
  if (!customers.length) {
    content.innerHTML = html`<div class="empty"><h3>No birthdays in the next 30 days</h3>
      <p>Add birthdays to customer profiles to send birthday offers.</p></div>`;
    return;
  }
  content.innerHTML = html`
    <p class="intro">Birthdays in the next 30 days. The gift is <strong>${s.birthday_percent}% off</strong>, valid for 7 days. Send it on the day or just before.</p>
    <div class="list">${customers.map((c) => html`
      <div class="list-item offer-row">
        <span class="avatar" style="background:var(--marigold-soft);color:#7a5000">${icon('cake', 'icon icon-sm')}</span>
        <div class="grow">
          <a class="title" href="/app/customer?id=${c.id}">${c.name}</a>
          <div class="small muted">${fmtBirthday(c.birthday)}, ${c.inDays === 0 ? 'today' : c.inDays === 1 ? 'tomorrow' : `in ${c.inDays} days`}</div>
        </div>
        <div class="offer-action">
          ${c.couponSent
            ? html`<span class="badge good">Birthday offer sent</span>`
            : c.consent
              ? html`<button type="button" class="btn btn-whatsapp btn-sm" data-send="${c.id}">${icon('chat', 'icon icon-sm')} Send birthday offer</button>`
              : html`<span class="small muted">Has not agreed to offers</span>`}
        </div>
      </div>`)}</div>`;
  content.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => sendCoupon(b.dataset.send, 'birthday', b)));
}

async function renderSent() {
  const coupons = await load('sent');
  if (!coupons.length) {
    content.innerHTML = html`<div class="empty"><h3>No offers sent yet</h3><p>Offers you send from this screen are tracked here, so you can see who came back.</p></div>`;
    return;
  }
  const used = coupons.filter((k) => k.status === 'used');
  const counted = coupons.filter((k) => k.status !== 'cancelled');
  const sales = used.reduce((sum, k) => sum + (k.usedBill || 0), 0);
  const label = { active: html`<span class="badge good">Waiting</span>`, used: html`<span class="badge lvl-1">Came back</span>`, expired: html`<span class="badge">Expired</span>`, cancelled: html`<span class="badge bad">Cancelled</span>` };
  content.innerHTML = html`
    <dl class="mini-stats" style="margin-bottom:18px">
      <div><dt>Offers sent (90 days)</dt><dd class="num">${counted.length}</dd></div>
      <div><dt>Came back and used it</dt><dd class="num">${used.length}</dd></div>
      <div><dt>Success rate</dt><dd class="num">${counted.length ? Math.round((used.length / counted.length) * 100) : 0}%</dd></div>
      <div><dt>Bills from these visits</dt><dd class="num">${rupees(sales)}</dd></div>
    </dl>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Customer</th><th>Offer</th><th class="hide-sm">Sent</th><th>Result</th></tr></thead>
      <tbody>${coupons.map((k) => html`<tr>
        <td><a class="row-link" href="/app/customer?id=${k.customerId}">${k.customerName}</a></td>
        <td>${k.percent}% off <span class="tiny muted">${k.kindLabel}, ${k.code}</span></td>
        <td class="hide-sm nowrap">${fmtShort(k.createdAt)}</td>
        <td>${label[k.status]} ${k.status === 'used' ? html`<span class="tiny muted">${fmtShort(k.usedAt)}, paid ${rupees(k.usedBill || 0)}</span>` : k.status === 'active' ? html`<span class="tiny muted">till ${fmtShort(k.expiresAt)}</span>` : ''}</td>
      </tr>`)}</tbody></table></div>`;
}

async function render() {
  try {
    if (tab === 'missing') await renderMissing();
    if (tab === 'birthdays') await renderBirthdays();
    if (tab === 'sent') await renderSent();
  } catch (err) {
    toastError(err);
  }
}

page.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  page.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  history.replaceState(null, '', `#${tab}`);
  content.innerHTML = html`<div class="loading">Loading</div>`;
  render();
}));

render();
refreshCounts();

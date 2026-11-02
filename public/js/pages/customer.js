// One customer: loyalty status, card, coupons, bill history, edit/delete.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import { customerFields, readCustomerForm } from '../customer-form.js';
import { levelJourney, offerLines, stampCard } from '../loyalty-view.js';
import {
  $, ago, confirmDialog, copyText, fmtBirthday, fmtCode, fmtDate, fmtDateTime, fmtPhone, fmtShort,
  formError, html, icon, initials, levelClass, openDialog, rupees, toast, toastError,
} from '../ui.js';

const { me, page } = await startPage('customers', 'Customer');
const tiers = me.program.tiers;
const params = new URLSearchParams(location.search);
const id = params.get('id');

const STATUS_BADGE = {
  active: html`<span class="badge good">Unused</span>`,
  used: html`<span class="badge lvl-1">Used</span>`,
  expired: html`<span class="badge">Expired</span>`,
  cancelled: html`<span class="badge bad">Cancelled</span>`,
};

async function load() {
  let data;
  try {
    data = await api.get(`/customers/${encodeURIComponent(id)}`);
  } catch (err) {
    page.innerHTML = html`<div class="empty"><h3>Customer not found</h3><p>${err.message}</p>
      <a class="btn" href="/app/customers">Back to customers</a></div>`;
    return;
  }
  const c = data.customer;
  document.title = `${c.name} | Looply`;
  const avg = c.bills ? Math.round(c.totalSpent / c.bills) : 0;
  const cardPath = `/card/${c.cardToken}`;

  page.innerHTML = html`
    <a class="back-link" href="/app/customers">${icon('back', 'icon icon-sm')} Customers</a>
    <div class="page-head">
      <div class="customer-head">
        <span class="avatar avatar-lg">${initials(c.name)}</span>
        <div>
          <div class="row"><h1>${c.name}</h1><span class="${levelClass(c.level.name, tiers)}">${c.level.name}</span>
            ${c.status === 'missing' ? html`<span class="badge warn">Stopped coming</span>` : ''}</div>
          <p>${fmtPhone(c.phone)}, card ${fmtCode(c.cardCode)}, member since ${fmtDate(c.joinedAt)}</p>
        </div>
      </div>
      <div class="actions">
        <a class="btn btn-whatsapp" href="${data.whatsappCardUrl}" target="_blank" rel="noopener">${icon('chat')} Send card</a>
        <a class="btn btn-primary" href="/app/counter?customer=${c.id}">${icon('counter')} New bill</a>
      </div>
    </div>

    ${params.get('new') ? html`<div class="callout" style="margin-bottom:16px">
      <span>Card created. Send the card link on WhatsApp so ${c.name.split(' ')[0]} has it on their phone.</span>
      <a class="btn btn-whatsapp btn-sm" href="${data.whatsappCardUrl}" target="_blank" rel="noopener">${icon('chat', 'icon icon-sm')} Send card</a></div>` : ''}

    <section class="stats" aria-label="Summary">
      <div class="stat"><div class="label">Visits</div><div class="value">${c.visits}</div></div>
      <div class="stat"><div class="label">Total paid</div><div class="value">${rupees(c.totalSpent)}</div></div>
      <div class="stat"><div class="label">Saved with card</div><div class="value">${rupees(c.totalSaved)}</div></div>
      <div class="stat"><div class="label">Average bill</div><div class="value">${rupees(avg)}</div></div>
      <div class="stat"><div class="label">Last visit</div><div class="value value-text">${c.lastSeenAt ? ago(c.daysSinceLastVisit) : 'Not yet'}</div></div>
    </section>

    <div class="grid-main" style="margin-top:20px">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Level</h2><a href="/app/rewards">Change levels</a></div>
          ${levelJourney(c.tiers, c.visits)}
          <h3 class="mini-title" style="margin-top:14px">What ${c.name.split(' ')[0]} gets next</h3>
          ${offerLines(c)}
        </section>
        ${c.stamps ? html`<section class="panel"><div class="panel-head"><h2>Stamp card</h2></div>${stampCard(c.stamps)}</section>` : ''}
        <section class="panel">
          <div class="panel-head"><h2>Bills</h2><span class="small muted">${c.bills} in total</span></div>
          ${data.visits.length ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th>Visit</th><th class="right hide-sm">Bill</th><th class="hide-sm">Discount</th><th class="right">Paid</th></tr></thead>
            <tbody>${data.visits.map((v) => html`<tr>
              <td class="nowrap">${fmtDateTime(v.created_at)}</td>
              <td>${v.counted ? `#${v.visit_number}` : html`<span class="muted" title="Not counted as a visit">extra bill</span>`}
                ${v.free_reward ? html`<div class="tiny" style="color:#7a5000">${icon('gift', 'icon icon-sm inline-icon')} ${v.free_reward}</div>` : ''}</td>
              <td class="right num hide-sm">${rupees(v.bill_amount)}</td>
              <td class="hide-sm">${v.discount_amount ? html`<span style="color:var(--leaf)">−${rupees(v.discount_amount)}</span> <span class="tiny muted">${v.discount_label}</span>` : html`<span class="muted">None</span>`}</td>
              <td class="right num strong">${rupees(v.final_amount)}</td>
            </tr>`)}</tbody></table></div>`
          : html`<div class="empty"><p>No bills yet. Use New bill when ${c.name.split(' ')[0]} buys something.</p></div>`}
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Loyalty card</h2></div>
          <div class="card-qr">
            <img src="/api/public/cards/${c.cardToken}/qr.svg" alt="QR code of ${c.name}'s loyalty card" width="148" height="148">
            <div>
              <div class="small muted">Card code</div>
              <div class="code-big num">${fmtCode(c.cardCode)}</div>
              <p class="small muted">Scan this QR or type the code at the counter.</p>
            </div>
          </div>
          <div class="row" style="margin-top:14px">
            <a class="btn btn-sm" href="${cardPath}" target="_blank" rel="noopener">${icon('card', 'icon icon-sm')} Open card</a>
            <button type="button" class="btn btn-sm" data-copy>${icon('copy', 'icon icon-sm')} Copy link</button>
            <a class="btn btn-sm" href="/app/print-card?id=${c.id}" target="_blank" rel="noopener">${icon('printer', 'icon icon-sm')} Print card</a>
          </div>
          ${me.phoneUrls.length ? html`<p class="tiny muted" style="margin-top:10px">Tip: the QR points to ${me.baseUrl}. For phones to open it, open Looply at ${me.phoneUrls[0]} instead.</p>` : ''}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Coupons</h2><button type="button" class="btn btn-sm" data-coupon>${icon('gift', 'icon icon-sm')} Give coupon</button></div>
          ${data.coupons.length ? html`<div class="list">${data.coupons.map((k) => html`
            <div class="list-item">
              <div class="grow"><div class="title">${k.percent}% off, ${k.code}</div>
                <div class="small muted">${k.kindLabel}, ${k.status === 'used' ? `used ${fmtShort(k.usedAt)}` : `valid till ${fmtShort(k.expiresAt)}`}</div></div>
              ${STATUS_BADGE[k.status]}
              ${k.status === 'active' ? html`<button type="button" class="icon-btn" data-cancel="${k.id}" aria-label="Cancel coupon ${k.code}" title="Cancel coupon">${icon('x', 'icon icon-sm')}</button>` : ''}
            </div>`)}</div>`
          : html`<p class="muted small">No coupons yet. Win-back and birthday offers you send will show here.</p>`}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Details</h2><button type="button" class="btn btn-sm" data-edit>${icon('edit', 'icon icon-sm')} Edit</button></div>
          <dl class="details">
            <div><dt>Birthday</dt><dd>${c.birthday ? fmtBirthday(c.birthday) : html`<span class="muted">Not added</span>`}</dd></div>
            <div><dt>WhatsApp offers</dt><dd>${c.consent ? 'Yes, agreed' : html`<span class="muted">Not agreed</span>`}</dd></div>
            <div><dt>Joined</dt><dd>${c.joinedVia === 'qr' ? 'Scanned the counter QR' : 'At the counter'}</dd></div>
            <div><dt>Notes</dt><dd>${c.notes || html`<span class="muted">None</span>`}</dd></div>
          </dl>
          <button type="button" class="btn btn-danger btn-sm" data-delete style="margin-top:16px">${icon('trash', 'icon icon-sm')} Delete customer</button>
        </section>
      </div>
    </div>`;

  $('[data-copy]').addEventListener('click', () => copyText(data.cardUrl, 'Card link copied'));
  $('[data-edit]').addEventListener('click', () => editCustomer(c));
  $('[data-coupon]').addEventListener('click', () => giveCoupon(c));
  $('[data-delete]').addEventListener('click', () => deleteCustomer(c));
  page.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Cancel coupon?', message: 'The customer will not be able to use it any more.', confirmLabel: 'Cancel coupon', danger: true }))) return;
    try {
      await api.post(`/coupons/${btn.dataset.cancel}/cancel`);
      toast('Coupon cancelled.');
      load();
    } catch (err) { toastError(err); }
  }));
}

function editCustomer(c) {
  openDialog({
    title: 'Edit customer',
    body: html`<form class="form-grid" id="edit-form" novalidate>${customerFields(c, { notes: true })}</form>`,
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      {
        label: 'Save changes',
        className: 'btn-primary',
        onClick: async (dlg) => {
          const form = $('#edit-form', dlg);
          formError(form, null);
          try {
            await api.put(`/customers/${c.id}`, readCustomerForm(form));
            toast('Changes saved.');
            load();
          } catch (err) {
            formError(form, err.message);
            return false;
          }
        },
      },
    ],
  });
}

function giveCoupon(c) {
  const s = me.program.settings;
  openDialog({
    title: `Give ${c.name.split(' ')[0]} a coupon`,
    body: html`<form class="form-grid" id="coupon-form" novalidate>
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="strong" style="margin-bottom:6px">Type of coupon</legend>
        <div class="stack-sm">
          <label class="check"><input type="radio" name="kind" value="gift" checked> <span>Gift coupon <span class="muted">(you choose the discount)</span></span></label>
          <label class="check"><input type="radio" name="kind" value="winback"> <span>Win-back offer, ${s.winback_percent}% off for ${s.winback_days} days</span></label>
          <label class="check"><input type="radio" name="kind" value="birthday"> <span>Birthday offer, ${s.birthday_percent}% off for 7 days</span></label>
        </div>
      </fieldset>
      <div class="form-grid two" data-gift>
        <label class="field"><span>Discount %</span><input class="input" name="percent" type="number" min="1" max="90" value="10"></label>
        <label class="field"><span>Valid for (days)</span><input class="input" name="days" type="number" min="1" max="90" value="14"></label>
      </div>
      ${!c.consent ? html`<p class="small muted">${c.name.split(' ')[0]} has not agreed to WhatsApp offers, so only a gift coupon can be given. You can hand over the code in person.</p>` : ''}
    </form>`,
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      {
        label: 'Create coupon',
        className: 'btn-primary',
        onClick: async (dlg) => {
          const form = $('#coupon-form', dlg);
          formError(form, null);
          const kind = form.querySelector('[name=kind]:checked').value;
          try {
            const result = await api.post(`/customers/${c.id}/coupons`, {
              kind,
              percent: form.querySelector('[name=percent]').value,
              days: form.querySelector('[name=days]').value,
            });
            await load();
            showCouponCreated(c, result);
          } catch (err) {
            formError(form, err.message);
            return false;
          }
        },
      },
    ],
  });
  const form = $('#coupon-form');
  form.addEventListener('change', () => {
    const kind = form.querySelector('[name=kind]:checked').value;
    form.querySelector('[data-gift]').classList.toggle('hidden', kind !== 'gift');
  });
}

function showCouponCreated(c, result) {
  openDialog({
    title: result.reused ? 'Coupon already running' : 'Coupon created',
    body: html`<p>${result.reused ? 'This customer already has this offer. You can send it again.' : 'Send it to the customer on WhatsApp.'}</p>
      <div class="coupon-ticket"><span class="num">${result.coupon.discount_percent}% off</span><span>${result.coupon.code}</span><span class="small muted">valid till ${fmtShort(result.coupon.expires_at)}</span></div>`,
    buttons: [
      { label: 'Close', className: 'btn-ghost' },
      { label: 'Send on WhatsApp', className: 'btn-whatsapp', onClick: () => { window.open(result.whatsappUrl, '_blank', 'noopener'); } },
    ],
  });
}

async function deleteCustomer(c) {
  const ok = await confirmDialog({
    title: `Delete ${c.name}?`,
    message: 'Their name, mobile number, card and coupons are removed for good. Their old bills stay in your sales reports without a name.',
    confirmLabel: 'Delete customer',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/customers/${c.id}`);
    toast('Customer deleted.');
    location.href = '/app/customers';
  } catch (err) { toastError(err); }
}

load();

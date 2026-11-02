// Counter screen: find the customer, type the bill, see the discount, save.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import { customerFields, readCustomerForm } from '../customer-form.js';
import { offerLines, stampCard } from '../loyalty-view.js';
import { openScanner } from '../scanner.js';
import {
  $, ago, debounce, fmtCode, fmtPhone, formError, html, icon, initials, inkStamp, levelClass,
  ordinal, rupees, toast, toastError,
} from '../ui.js';

const { me, page } = await startPage('counter', 'Counter');
const tiers = me.program.tiers;

const state = {
  customer: null,
  preview: null,
  previewSeq: 0,
  saved: null, // result of the last saved bill
  saving: false,
};

page.innerHTML = html`
  <div class="page-head">
    <div><h1>Counter</h1><p>Find the customer, type the bill, and the discount is worked out for you.</p></div>
  </div>
  <div class="counter-grid">
    <div class="stack">
      <section class="panel" id="find-panel" aria-labelledby="find-title">
        <h2 id="find-title" class="sr-only">Find customer</h2>
        <div class="find-row">
          <div class="input-prefix grow">
            <span class="prefix">${icon('search', 'icon icon-sm')}</span>
            <input class="input input-xl" id="find" autocomplete="off" autofocus
              placeholder="Mobile number, card code or name" aria-label="Find customer by mobile number, card code or name">
          </div>
          <button type="button" class="btn btn-lg" id="scan">${icon('scan')} Scan card</button>
        </div>
        <div id="find-results" aria-live="polite"></div>
      </section>
      <section id="customer-panel"></section>
    </div>
    <aside id="slip-area" aria-live="polite"></aside>
  </div>
  <div class="pay-bar" id="pay-bar" hidden>
    <div><div class="tiny">Collect</div><div class="amount num" id="pay-amount"></div></div>
    <button type="button" class="btn btn-primary" id="pay-record">${icon('check')} Record bill</button>
  </div>`;

const findInput = $('#find');
const results = $('#find-results');
const customerPanel = $('#customer-panel');
const slipArea = $('#slip-area');
const payBar = $('#pay-bar');
// On phones the bill slip is below the fold, so a small bar shows the amount and the button.
$('#pay-record').addEventListener('click', () => saveBill());
const narrow = () => window.matchMedia('(max-width: 980px)').matches;

// ------------------------------------------------------------------ find

let lookupSeq = 0;
async function lookup(query) {
  const q = query.trim();
  const seq = ++lookupSeq;
  if (q.length < 2) { results.innerHTML = ''; return; }
  try {
    const data = await api.get(`/customers/lookup?q=${encodeURIComponent(q)}`);
    if (seq !== lookupSeq) return; // a newer search already started
    if (data.exact) { selectCustomer(data.exact); return; }
    renderResults(q, data.results);
  } catch (err) {
    toastError(err);
  }
}

function renderResults(q, list) {
  const digits = q.replace(/\D/g, '');
  const looksLikePhone = /^(91|0)?[6-9]\d{9}$/.test(digits);
  results.innerHTML = html`
    ${list.length ? html`<div class="result-list">${list.map((c) => html`
      <button type="button" class="result" data-id="${c.id}">
        <span class="avatar">${initials(c.name)}</span>
        <span class="grow"><span class="strong">${c.name}</span><br><span class="small muted">${fmtPhone(c.phone)}, card ${fmtCode(c.card_code)}</span></span>
      </button>`)}</div>` : ''}
    ${!list.length && looksLikePhone ? html`<div class="no-match">
        <p><strong>${fmtPhone(digits.slice(-10))}</strong> does not have a card yet.</p>
        <button type="button" class="btn btn-primary" data-new>${icon('plus')} Give a new card</button>
      </div>` : ''}
    ${!list.length && !looksLikePhone ? html`<div class="no-match">
        <p class="muted">No customer found. Type the full 10-digit mobile number to give a new card.</p>
        <button type="button" class="btn" data-new>${icon('plus')} New customer</button>
      </div>` : ''}`;
}

findInput.addEventListener('input', debounce(() => lookup(findInput.value), 220));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const only = results.querySelectorAll('.result');
    if (only.length === 1) only[0].click();
    else lookup(findInput.value);
  }
});
results.addEventListener('click', async (e) => {
  const pick = e.target.closest('.result');
  if (pick) {
    try {
      const data = await api.get(`/customers/${pick.dataset.id}`);
      selectCustomer(data.customer);
    } catch (err) { toastError(err); }
  }
  if (e.target.closest('[data-new]')) showNewCustomerForm(findInput.value);
});

$('#scan').addEventListener('click', () => {
  openScanner({
    onResult: async (text) => {
      const before = state.customer;
      findInput.value = '';
      await lookup(text);
      if (state.customer === before) {
        results.innerHTML = '';
        toast('This QR code is not a loyalty card of your shop.', { error: true });
      }
    },
  });
});

// ------------------------------------------------------------------ new customer

function showNewCustomerForm(typed) {
  const digits = typed.replace(/\D/g, '').slice(-10);
  const isPhone = /^[6-9]\d{9}$/.test(digits);
  results.innerHTML = '';
  customerPanel.innerHTML = html`
    <form class="panel stack" id="new-form" novalidate>
      <div class="spread"><h2>New loyalty card</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button></div>
      ${customerFields({ phone: isPhone ? digits : '', name: isPhone ? '' : typed.trim() })}
      <button class="btn btn-primary btn-lg" type="submit">${icon('card')} Create card</button>
    </form>`;
  slipArea.innerHTML = '';
  const form = $('#new-form');
  form.querySelector(isPhone ? '[name=name]' : '[name=phone]').focus();
  form.querySelector('[data-cancel]').addEventListener('click', reset);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, null);
    try {
      const data = await api.post('/customers', readCustomerForm(form));
      selectCustomer(data.customer, { welcomeUrl: data.whatsappUrl });
      toast(`Card created for ${data.customer.name}`);
    } catch (err) {
      if (err.status === 409 && err.customerId) {
        const data = await api.get(`/customers/${err.customerId}`);
        selectCustomer(data.customer);
        toast('This number already had a card, so we opened it.');
        return;
      }
      formError(form, err.message);
    }
  });
}

// ------------------------------------------------------------------ selected customer

function selectCustomer(customer, { welcomeUrl } = {}) {
  state.customer = customer;
  state.preview = null;
  state.saved = null;
  results.innerHTML = '';
  findInput.value = '';
  renderCustomer(welcomeUrl);
  renderSlip();
  const params = new URLSearchParams(location.search);
  if (params.get('customer') !== String(customer.id)) {
    history.replaceState(null, '', `/app/counter?customer=${customer.id}`);
  }
  $('#bill')?.focus();
}

function renderCustomer(welcomeUrl) {
  const c = state.customer;
  customerPanel.innerHTML = html`
    <div class="panel stack">
      <div class="customer-head">
        <span class="avatar avatar-lg">${initials(c.name)}</span>
        <div class="grow">
          <div class="row"><a class="h2-link" href="/app/customer?id=${c.id}">${c.name}</a>
            <span class="${levelClass(c.level.name, tiers)}">${c.level.name}</span></div>
          <div class="small muted">${fmtPhone(c.phone)}, card ${fmtCode(c.cardCode)}</div>
        </div>
        <button type="button" class="icon-btn" data-clear aria-label="Change customer">${icon('x')}</button>
      </div>
      ${welcomeUrl ? html`<div class="callout">
          <span>Send the new card link so ${c.name.split(' ')[0]} has it on their phone.</span>
          <a class="btn btn-whatsapp btn-sm" href="${welcomeUrl}" target="_blank" rel="noopener">${icon('chat', 'icon icon-sm')} Send card</a>
        </div>` : ''}
      <form id="bill-form" class="bill-form" novalidate>
        <label class="field"><span>Bill amount</span>
          <div class="input-prefix"><span class="prefix">₹</span>
            <input class="input input-xl num" id="bill" name="bill" inputmode="decimal" autocomplete="off" placeholder="0"></div>
        </label>
      </form>
      <dl class="facts">
        <div><dt>Visits</dt><dd class="num">${c.visits}</dd></div>
        <div><dt>Last visit</dt><dd>${c.lastSeenAt ? ago(c.daysSinceLastVisit) : 'First time'}</dd></div>
        <div><dt>Saved so far</dt><dd class="num">${rupees(c.totalSaved)}</dd></div>
      </dl>
      <div>
        <h3 class="mini-title">Offers they have</h3>
        ${offerLines(c)}
      </div>
      ${c.stamps ? html`<div><h3 class="mini-title">Stamp card</h3>${stampCard(c.stamps)}</div>` : ''}
    </div>`;
  customerPanel.querySelector('[data-clear]').addEventListener('click', reset);
  const bill = $('#bill');
  bill.addEventListener('input', debounce(updatePreview, 200));
  $('#bill-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveBill();
  });
}

async function updatePreview() {
  const bill = $('#bill')?.value.replace(/,/g, '').trim();
  const seq = ++state.previewSeq;
  if (!bill || Number(bill) <= 0) {
    state.preview = null;
    renderSlip();
    return;
  }
  try {
    const preview = await api.post('/visits/preview', { customerId: state.customer.id, bill });
    if (seq !== state.previewSeq) return;
    state.preview = { ...preview, bill };
    renderSlip();
  } catch (err) {
    if (seq !== state.previewSeq) return;
    state.preview = { error: err.message };
    renderSlip();
  }
}

// ------------------------------------------------------------------ the bill slip

function renderSlip() {
  const c = state.customer;
  const p0 = state.preview;
  payBar.hidden = !(c && !state.saved && p0 && !p0.error);
  if (!payBar.hidden) $('#pay-amount').textContent = rupees(p0.finalPaise);
  if (!c) {
    slipArea.innerHTML = html`<div class="slip slip-empty">
      <p class="slip-shop">${me.shop.name}</p>
      <p class="muted">Find a customer to start a bill.</p>
      <ol class="how small muted">
        <li>Ask for their mobile number, or scan their card.</li>
        <li>Type the bill amount.</li>
        <li>Collect the amount shown and press Record bill.</li>
      </ol>
    </div>`;
    return;
  }
  if (state.saved) return renderSaved();
  const p = state.preview;
  if (!p || p.error) {
    slipArea.innerHTML = html`<div class="slip">
      <p class="slip-shop">${me.shop.name}</p>
      <p class="slip-for">Bill for ${c.name}</p>
      <p class="muted" style="margin-top:16px">${p?.error || 'Type the bill amount to see the discount.'}</p>
    </div>`;
    return;
  }
  const billPaise = Math.round(Number(p.bill) * 100);
  const others = p.options.filter((o) => o !== p.chosen && !(p.chosen && o.label === p.chosen.label));
  slipArea.innerHTML = html`<div class="slip">
    <p class="slip-shop">${me.shop.name}</p>
    <p class="slip-for">Bill for ${c.name}</p>
    <div class="slip-lines">
      <div class="slip-line"><span>Bill</span><span class="num">${rupees(billPaise)}</span></div>
      ${p.chosen ? html`<div class="slip-line discount"><span>${p.chosen.label}, ${p.discountPercent}%</span><span class="num">−${rupees(p.discountPaise)}</span></div>`
        : html`<div class="slip-line muted"><span>No discount on this bill</span><span class="num">₹0</span></div>`}
    </div>
    <div class="slip-total"><span>Collect</span><span class="num">${rupees(p.finalPaise)}</span></div>
    <ul class="slip-notes small">
      ${p.counts ? html`<li>${icon('check', 'icon icon-sm')} This is ${c.name.split(' ')[0]}'s ${ordinal(p.visitNumber)} visit.</li>` : ''}
      ${p.freeReward ? html`<li class="reward-note">${icon('gift', 'icon icon-sm')} Give ${p.freeReward} free with this bill. Stamp card is full!</li>` : ''}
      ${p.notes.map((n) => html`<li class="muted">${icon('clock', 'icon icon-sm')} ${n}</li>`)}
      ${others.length ? html`<li class="muted">${icon('star', 'icon icon-sm')} Best offer used. Also had: ${others.map((o) => `${o.label} (${o.percent}%)`).join(', ')}.${others.some((o) => o.type === 'coupon') ? ' Coupons stay for next time.' : ''}</li>` : ''}
    </ul>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="record">${icon('check')} Record bill</button>
  </div>`;
  $('#record').addEventListener('click', saveBill);
}

async function saveBill() {
  if (state.saving) return; // a double click or double Enter must not save the bill twice
  const bill = $('#bill')?.value.replace(/,/g, '').trim();
  if (!bill || Number(bill) <= 0) {
    toast('Type the bill amount first.', { error: true });
    $('#bill')?.focus();
    return;
  }
  const button = $('#record');
  if (button) button.disabled = true;
  state.saving = true;
  try {
    const result = await api.post('/visits', { customerId: state.customer.id, bill });
    state.saved = result;
    state.customer = result.customer;
    renderCustomer();
    $('#bill').value = '';
    $('#bill').disabled = true;
    renderSlip();
    if (narrow()) slipArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toastError(err);
    if (button) button.disabled = false;
  } finally {
    state.saving = false;
  }
}

function renderSaved() {
  const { visit, customer, whatsappUrl } = state.saved;
  slipArea.innerHTML = html`<div class="slip slip-saved">
    <div class="saved-head">
      <div class="saved-stamp">${inkStamp('thunk')}</div>
      <div><p class="slip-shop">Bill saved</p><p class="slip-for">${customer.name}, visit ${customer.visits}</p></div>
    </div>
    <div class="slip-total"><span>Collect</span><span class="num">${rupees(visit.final_amount)}</span></div>
    ${visit.discount_amount ? html`<p class="small">${customer.name.split(' ')[0]} saved ${rupees(visit.discount_amount)} (${visit.discount_label}).</p>` : ''}
    ${visit.free_reward ? html`<p class="reward-note small">${icon('gift', 'icon icon-sm')} Remember to give ${visit.free_reward}.</p>` : ''}
    <p class="small muted">${customer.nextVisit.percent ? `Next visit: ${customer.nextVisit.percent}% off.` : ''}
      ${customer.comeback ? `Or ${customer.comeback.percent}% off if they return within the comeback window.` : ''}</p>
    <div class="stack-sm" style="margin-top:14px">
      <a class="btn btn-whatsapp btn-lg btn-block" href="${whatsappUrl}" target="_blank" rel="noopener">${icon('chat')} Send receipt on WhatsApp</a>
      <button type="button" class="btn btn-primary btn-lg btn-block" data-next>${icon('plus')} Next customer</button>
      <button type="button" class="btn btn-ghost btn-block" data-undo>${icon('undo')} Undo this bill</button>
    </div>
  </div>`;
  slipArea.querySelector('[data-next]').addEventListener('click', reset);
  slipArea.querySelector('[data-undo]').addEventListener('click', undoLast);
}

async function undoLast() {
  try {
    await api.post(`/visits/${state.saved.visit.id}/undo`);
    const data = await api.get(`/customers/${state.customer.id}`);
    toast('Bill undone. Nothing was saved.');
    selectCustomer(data.customer);
  } catch (err) {
    toastError(err);
  }
}

function reset() {
  state.customer = null;
  state.preview = null;
  state.saved = null;
  customerPanel.innerHTML = '';
  results.innerHTML = '';
  findInput.value = '';
  history.replaceState(null, '', '/app/counter');
  renderSlip();
  findInput.focus();
}

// ------------------------------------------------------------------ start

renderSlip();
const preselect = new URLSearchParams(location.search).get('customer');
if (preselect) {
  api.get(`/customers/${encodeURIComponent(preselect)}`)
    .then((data) => selectCustomer(data.customer))
    .catch(() => history.replaceState(null, '', '/app/counter'));
}

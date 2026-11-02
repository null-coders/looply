// Customers list with search, filters and sorting.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import { customerFields, readCustomerForm } from '../customer-form.js';
import {
  $, ago, debounce, fmtPhone, formError, html, icon, levelClass, openDialog, rupees, toast,
  toastError,
} from '../ui.js';

const { me, page } = await startPage('customers', 'Customers');
const tiers = me.program.tiers;
const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') || '',
  filter: params.get('filter') || 'all',
  level: params.get('level') || '',
  sort: params.get('sort') || 'recent',
  offset: 0,
  rows: [],
  total: 0,
};

const FILTERS = [
  ['all', 'All'],
  ['new', 'Joined this month'],
  ['missing', 'Stopped coming'],
  ['birthday', 'Birthday this month'],
  ['consent', 'Get WhatsApp offers'],
];

page.innerHTML = html`
  <div class="page-head">
    <div><h1>Customers</h1><p id="count">Loading</p></div>
    <div class="actions">
      <a class="btn" href="/api/export/customers.csv" download>${icon('download')} Download list</a>
      <button type="button" class="btn btn-primary" id="add">${icon('plus')} Add customer</button>
    </div>
  </div>
  <div class="toolbar">
    <div class="input-prefix toolbar-search">
      <span class="prefix">${icon('search', 'icon icon-sm')}</span>
      <input class="input" id="q" type="search" placeholder="Search name, mobile or card code" value="${state.q}" aria-label="Search customers">
    </div>
    <select class="input toolbar-select" id="level" aria-label="Level">
      <option value="">All levels</option>
      ${tiers.map((t) => html`<option value="${t.id}" ${String(t.id) === state.level ? html`selected` : ''}>${t.name}</option>`)}
    </select>
    <select class="input toolbar-select" id="sort" aria-label="Sort by">
      ${[['recent', 'Latest visit first'], ['visits', 'Most visits'], ['spent', 'Highest spend'], ['joined', 'Newest card'], ['name', 'Name A to Z']].map(
        ([v, l]) => html`<option value="${v}" ${v === state.sort ? html`selected` : ''}>${l}</option>`
      )}
    </select>
  </div>
  <div class="tabs" role="tablist" aria-label="Filter customers" style="margin:14px 0 16px">
    ${FILTERS.map(([v, l]) => html`<button type="button" role="tab" data-filter="${v}" aria-selected="${String(v === state.filter)}">${l}</button>`)}
  </div>
  <section class="panel table-panel">
    <div class="table-wrap" id="table"></div>
    <div id="more" class="more-row"></div>
  </section>`;

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.filter !== 'all') p.set('filter', state.filter);
  if (state.level) p.set('level', state.level);
  if (state.sort !== 'recent') p.set('sort', state.sort);
  const query = p.toString();
  history.replaceState(null, '', `/app/customers${query ? `?${query}` : ''}`);
}

let seq = 0;
async function load({ append = false } = {}) {
  const mySeq = ++seq;
  if (!append) state.offset = 0;
  const p = new URLSearchParams({ q: state.q, filter: state.filter, level: state.level, sort: state.sort, limit: 50, offset: state.offset });
  try {
    const data = await api.get(`/customers?${p}`);
    if (mySeq !== seq) return;
    state.rows = append ? state.rows.concat(data.customers) : data.customers;
    state.total = data.total;
    render();
  } catch (err) { toastError(err); }
}

function render() {
  $('#count').textContent = `${state.total} ${state.total === 1 ? 'customer' : 'customers'}${state.filter !== 'all' || state.q || state.level ? ' match' : ' with a loyalty card'}`;
  if (!state.rows.length) {
    $('#table').innerHTML = state.filter === 'all' && !state.q && !state.level
      ? html`<div class="empty"><h3>No customers yet</h3><p>Give your first loyalty card at the counter, or add a customer here.</p>
          <a class="btn btn-primary" href="/app/counter">Open counter</a></div>`
      : html`<div class="empty"><h3>Nobody matches</h3><p>Try another search or filter.</p></div>`;
    $('#more').innerHTML = '';
    return;
  }
  $('#table').innerHTML = html`<table class="table">
    <thead><tr>
      <th>Customer</th><th>Level</th><th class="right">Visits</th><th class="right hide-sm">Total paid</th><th class="hide-sm">Last visit</th>
    </tr></thead>
    <tbody>${state.rows.map((c) => html`
      <tr class="link-row" data-id="${c.id}">
        <td><a class="row-link" href="/app/customer?id=${c.id}">${c.name}</a>
          <div class="tiny muted">${fmtPhone(c.phone)}${c.consent ? '' : ', no WhatsApp offers'}</div></td>
        <td><span class="${levelClass(c.level.name, tiers)}">${c.level.name}</span></td>
        <td class="right num">${c.visits}</td>
        <td class="right num hide-sm">${rupees(c.spent)}</td>
        <td class="hide-sm">${c.lastSeenAt ? html`<span class="${c.status === 'missing' ? 'missing-text' : ''}">${ago(c.daysSinceLastVisit)}</span>` : html`<span class="muted">No visit yet</span>`}</td>
      </tr>`)}</tbody>
  </table>`;
  $('#more').innerHTML = state.rows.length < state.total
    ? html`<button type="button" class="btn" id="more-btn">Show more (${state.total - state.rows.length} left)</button>`
    : '';
  $('#more-btn')?.addEventListener('click', () => {
    state.offset = state.rows.length;
    load({ append: true });
  });
}

$('#table').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (row && !e.target.closest('a')) location.href = `/app/customer?id=${row.dataset.id}`;
});
$('#q').addEventListener('input', debounce(() => { state.q = $('#q').value.trim(); syncUrl(); load(); }, 250));
$('#level').addEventListener('change', () => { state.level = $('#level').value; syncUrl(); load(); });
$('#sort').addEventListener('change', () => { state.sort = $('#sort').value; syncUrl(); load(); });
page.querySelectorAll('[data-filter]').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.filter = tab.dataset.filter;
    page.querySelectorAll('[data-filter]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    syncUrl();
    load();
  });
});

$('#add').addEventListener('click', () => {
  const dialog = openDialog({
    title: 'Add customer',
    body: html`<form class="form-grid" id="add-form" novalidate>${customerFields()}</form>`,
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      {
        label: 'Create card',
        className: 'btn-primary',
        onClick: async (dlg) => {
          const form = $('#add-form', dlg);
          formError(form, null);
          try {
            const data = await api.post('/customers', readCustomerForm(form));
            toast(`Card created for ${data.customer.name}`);
            location.href = `/app/customer?id=${data.customer.id}&new=1`;
          } catch (err) {
            formError(form, err.message);
            return false;
          }
        },
      },
    ],
  });
  $('[name=name]', dialog).focus();
});

load();

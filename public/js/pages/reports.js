// Reports: is the loyalty program bringing customers back?
import { api } from '../api.js';
import { barChart } from '../charts.js';
import { startPage } from '../layout.js';
import { $, html, icon, parseDate, plural, rupees, toastError } from '../ui.js';

const { page } = await startPage('reports', 'Reports');
let days = Number(new URLSearchParams(location.search).get('days')) || 30;
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

page.innerHTML = html`
  <div class="page-head">
    <div><h1>Reports</h1><p id="range-text">Loading</p></div>
    <div class="actions">
      <div class="tabs" role="tablist" aria-label="Time range">
        ${RANGES.map(([d, l]) => html`<button type="button" role="tab" data-days="${d}" aria-selected="${String(d === days)}">${l}</button>`)}
      </div>
      <a class="btn" href="/api/export/visits.csv" download>${icon('download')} Download all bills</a>
    </div>
  </div>
  <div id="report"><div class="loading">Loading</div></div>`;

function change(now, before) {
  if (!before) return html`<div class="delta">No data for the period before</div>`;
  const pct = Math.round(((now - before) / before) * 100);
  return html`<div class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct}% vs the ${days} days before</div>`;
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Groups daily rows into weeks (90 days) or months (1 year) so the chart stays readable. */
function group(daily) {
  if (days <= 31) {
    return daily.map((d) => {
      const date = parseDate(`${d.day} 00:00:00`);
      return { ...d, label: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), title: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) };
    });
  }
  const buckets = new Map();
  daily.forEach((d, i) => {
    const date = parseDate(`${d.day} 00:00:00`);
    const key = days <= 90 ? Math.floor(i / 7) : `${date.getFullYear()}-${date.getMonth()}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        sales: 0, discount: 0, visits: 0, repeatVisits: 0,
        label: days <= 90 ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : date.toLocaleDateString('en-IN', { month: 'short' }),
        title: days <= 90 ? `Week from ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      });
    }
    const b = buckets.get(key);
    b.sales += d.sales; b.discount += d.discount; b.visits += d.visits; b.repeatVisits += d.repeatVisits;
  });
  return [...buckets.values()];
}

async function load() {
  let r;
  try {
    r = await api.get(`/reports?days=${days}`);
  } catch (err) { toastError(err); return; }
  const c = r.current;
  const p = r.previous;
  const from = parseDate(`${r.from} 00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const to = parseDate(`${r.to} 00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  $('#range-text').textContent = `${from} to ${to}`;
  const rows = group(r.daily);
  const type = (t) => r.byType.find((x) => x.type === t) || { uses: 0, discount: 0, sales: 0 };
  const coupon = (k) => r.coupons.find((x) => x.kind === k) || { sent: 0, used: 0 };
  const membersTotal = r.levels.reduce((s, l) => s + l.members, 0);
  const maxWeekday = Math.max(...r.weekdays.map((w) => w.bills), 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const quietest = [...r.weekdays].sort((a, b) => a.bills - b.bills)[0];

  $('#report').innerHTML = html`
    <section class="stats" aria-label="Totals">
      <div class="stat"><div class="label">Sales</div><div class="value">${rupees(c.sales)}</div>${change(c.sales, p.sales)}</div>
      <div class="stat"><div class="label">Bills</div><div class="value">${c.bills}</div>${change(c.bills, p.bills)}</div>
      <div class="stat"><div class="label">Customers who came</div><div class="value">${c.customers}</div><div class="delta">${plural(c.newMembers, 'new card')}</div></div>
      <div class="stat"><div class="label">Average bill</div><div class="value">${rupees(c.avgBill)}</div>${change(c.avgBill, p.avgBill)}</div>
      <div class="stat"><div class="label">Repeat visits</div><div class="value">${pct(c.repeatVisits, c.visits)}%</div><div class="delta">was ${pct(p.repeatVisits, p.visits)}% before</div></div>
    </section>

    <section class="panel" style="margin-top:20px">
      <div class="panel-head"><h2>Sales${days > 31 ? (days <= 90 ? ' by week' : ' by month') : ' by day'}</h2></div>
      <div id="chart"></div>
      <div class="legend" style="margin-top:8px"><span><i style="background:var(--violet)"></i>Paid by customers</span><span><i style="background:var(--marigold)"></i>Discount given</span></div>
      <details class="table-view"><summary>Show as a table</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th>Period</th><th class="right">Paid</th><th class="right">Discount</th><th class="right">Visits</th></tr></thead>
        <tbody>${rows.map((x) => html`<tr><td>${x.title}</td><td class="right num">${rupees(x.sales)}</td><td class="right num">${rupees(x.discount)}</td><td class="right num">${x.visits}</td></tr>`)}</tbody></table></div>
      </details>
    </section>

    <div class="grid-2" style="margin-top:20px">
      <section class="panel">
        <h2>Is the loyalty program working?</h2>
        <ul class="insights">
          <li><strong>${pct(c.repeatVisits, c.visits)}% of visits</strong> were customers coming back for their 2nd time or more.</li>
          <li>Returning customers paid <strong>${rupees(c.repeatSales)}</strong>, which is ${pct(c.repeatSales, c.sales)}% of your sales.</li>
          <li>You gave <strong>${rupees(c.discount)}</strong> in discounts. That is ${pct(c.discount, c.gross)}% of the total bill value.</li>
          <li><strong>${plural(c.newMembers, 'new customer')}</strong> got a loyalty card.</li>
          ${c.freeRewards ? html`<li><strong>${plural(c.freeRewards, 'free reward')}</strong> given for full stamp cards.</li>` : ''}
        </ul>
      </section>
      <section class="panel">
        <h2>Which offers were used</h2>
        <div class="table-wrap"><table class="table" style="margin-top:8px">
          <thead><tr><th>Offer</th><th class="right">Used</th><th class="right">Discount</th></tr></thead>
          <tbody>
            <tr><td>Level discount</td><td class="right num">${type('level').uses}</td><td class="right num">${rupees(type('level').discount)}</td></tr>
            <tr><td>Comeback offer</td><td class="right num">${type('comeback').uses}</td><td class="right num">${rupees(type('comeback').discount)}</td></tr>
            <tr><td>Coupons</td><td class="right num">${type('coupon').uses}</td><td class="right num">${rupees(type('coupon').discount)}</td></tr>
          </tbody></table></div>
        <h3 class="mini-title" style="margin-top:16px">Coupons sent in this period</h3>
        <ul class="insights">
          <li>Win-back: ${coupon('winback').sent} sent, <strong>${coupon('winback').used} came back</strong> (${pct(coupon('winback').used, coupon('winback').sent)}%)</li>
          <li>Birthday: ${coupon('birthday').sent} sent, <strong>${coupon('birthday').used} used</strong></li>
          <li>Gift: ${coupon('gift').sent} given, <strong>${coupon('gift').used} used</strong></li>
        </ul>
      </section>
    </div>

    <div class="grid-2" style="margin-top:20px">
      <section class="panel">
        <h2>Members by level</h2>
        <p class="small muted" style="margin-bottom:8px">All ${membersTotal} card holders, today.</p>
        ${r.levels.map((l) => html`<div class="hbar">
          <span>${l.name} <span class="tiny muted">${l.percent}%</span></span>
          <div class="track" role="img" aria-label="${l.members} members"><div class="fill" style="width:${pct(l.members, membersTotal)}%"></div></div>
          <span class="num right">${l.members}</span></div>`)}
      </section>
      <section class="panel">
        <h2>Busy and quiet days</h2>
        <p class="small muted" style="margin-bottom:8px">Bills per day of the week.${quietest.bills < maxWeekday ? ` ${WEEKDAYS[quietest.weekday]} is your quietest day, a good day for a special offer.` : ''}</p>
        ${order.map((w) => r.weekdays[w]).map((w) => html`<div class="hbar">
          <span>${WEEKDAYS[w.weekday].slice(0, 3)}</span>
          <div class="track" role="img" aria-label="${w.bills} bills"><div class="fill ${w.weekday === quietest.weekday ? 'fill-quiet' : ''}" style="width:${pct(w.bills, maxWeekday)}%"></div></div>
          <span class="num right">${w.bills}</span></div>`)}
      </section>
    </div>

    <section class="panel" style="margin-top:20px">
      <h2>Top customers</h2>
      ${r.topCustomers.length ? html`<div class="table-wrap"><table class="table" style="margin-top:8px">
        <thead><tr><th>Customer</th><th class="right">Bills</th><th class="right">Paid</th><th class="right hide-sm">Saved</th></tr></thead>
        <tbody>${r.topCustomers.map((t) => html`<tr>
          <td><a class="row-link" href="/app/customer?id=${t.id}">${t.name}</a></td>
          <td class="right num">${t.bills}</td><td class="right num">${rupees(t.spent)}</td><td class="right num hide-sm">${rupees(t.saved)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="muted">No bills in this period.</p>`}
    </section>`;

  $('#chart').append(barChart(
    rows.map((x) => ({
      label: x.label,
      title: x.title,
      segments: [
        { name: 'paid', value: x.sales, className: 'bar', text: rupees(x.sales) },
        { name: 'discount', value: x.discount, className: 'bar-2', text: rupees(x.discount) },
      ],
    })),
    { height: 240, width: $('#chart').clientWidth, ariaLabel: `Sales for the last ${days} days` }
  ));
}

page.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
  days = Number(b.dataset.days);
  page.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  history.replaceState(null, '', `?days=${days}`);
  $('#report').style.opacity = '0.5';
  load().then(() => { $('#report').style.opacity = ''; });
}));

load();

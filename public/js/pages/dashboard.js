// Home screen: today's numbers, recent bills and who needs attention.
import { api } from '../api.js';
import { barChart } from '../charts.js';
import { startPage } from '../layout.js';
import {
  $, ago, fmtBirthday, fmtDateTime, html, icon, initials, parseDate, plural, rupees, toast, toastError,
} from '../ui.js';

const { me, page } = await startPage('home', 'Home');

function delta(now, before, billsToday) {
  if (!billsToday) return html`<div class="delta">No bills yet today</div>`;
  if (!before) return now ? html`<div class="delta">Yesterday: ₹0</div>` : html`<div class="delta">No bills yesterday</div>`;
  const change = Math.round(((now - before) / before) * 100);
  return html`<div class="delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '+' : ''}${change}% vs yesterday</div>`;
}

async function load() {
  const d = await api.get('/dashboard');
  const firstName = me.shop.ownerName.split(' ')[0];
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  page.innerHTML = html`
    <div class="page-head">
      <div><h1>Namaste, ${firstName}</h1><p>${today}</p></div>
      <div class="actions">
        <a class="btn btn-primary btn-lg" href="/app/counter">${icon('counter')} Open counter</a>
      </div>
    </div>

    <section class="stats" aria-label="Today">
      <div class="stat"><div class="label">Sales today</div><div class="value">${rupees(d.today.sales)}</div>${delta(d.today.sales, d.yesterday.sales, d.today.bills)}</div>
      <div class="stat"><div class="label">Bills today</div><div class="value">${d.today.bills}</div><div class="delta">${plural(d.today.customers, 'customer')}</div></div>
      <div class="stat"><div class="label">Discount given today</div><div class="value">${rupees(d.today.discount)}</div><div class="delta">${d.today.gross ? Math.round((d.today.discount / d.today.gross) * 100) : 0}% of bills</div></div>
      <div class="stat"><div class="label">New cards today</div><div class="value">${d.today.newMembers}</div><div class="delta">${plural(d.members, 'member')} in total</div></div>
    </section>

    <div class="grid-main" style="margin-top:20px">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>Sales, last 14 days</h2><a href="/app/reports">Reports</a></div>
          <div id="chart"></div>
          <div class="legend" style="margin-top:8px"><span><i style="background:var(--violet)"></i>Paid by customers</span><span><i style="background:var(--marigold)"></i>Discount given</span></div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>Latest bills</h2></div>
          ${d.recent.length ? html`<div class="list">${d.recent.map((v) => html`
            <div class="list-item">
              <span class="avatar">${v.customer_name ? initials(v.customer_name) : '?'}</span>
              <div class="grow">
                ${v.customer_id ? html`<a class="title" href="/app/customer?id=${v.customer_id}">${v.customer_name}</a>` : html`<span class="title">Deleted customer</span>`}
                <div class="small muted">${fmtDateTime(v.created_at)}${v.discount_label ? `, ${v.discount_label}` : ''}${v.free_reward ? `, ${v.free_reward} given` : ''}</div>
              </div>
              <div class="right">
                <div class="num strong">${rupees(v.final_amount)}</div>
                ${v.discount_amount ? html`<div class="tiny" style="color:var(--leaf)">saved ${rupees(v.discount_amount)}</div>` : ''}
              </div>
              ${v.canUndo ? html`<button type="button" class="icon-btn" data-undo="${v.id}" title="Undo this bill" aria-label="Undo bill of ${v.customer_name}">${icon('undo', 'icon icon-sm')}</button>` : ''}
            </div>`)}</div>`
          : html`<div class="empty"><h3>No bills yet</h3><p>Bills you record at the counter show up here.</p><a class="btn btn-primary" href="/app/counter">Open counter</a></div>`}
        </section>
      </div>

      <div class="stack">
        <section class="panel attention">
          <div class="panel-head"><h2>Customers who stopped coming</h2></div>
          ${d.missing.count ? html`
            <p><span class="big-num num">${d.missing.count}</span> ${d.missing.count === 1 ? 'customer has' : 'customers have'} not come for over ${me.program.settings.inactive_after_days} days.</p>
            <div class="list" style="margin-top:8px">${d.missing.top.map((m) => html`
              <div class="list-item">
                <div class="grow"><a class="title" href="/app/customer?id=${m.id}">${m.name}</a>
                  <div class="small muted">Last came ${ago(m.daysSinceLastVisit)}, spent ${rupees(m.spent)}</div></div>
              </div>`)}</div>
            <a class="btn btn-primary btn-block" href="/app/offers" style="margin-top:12px">${icon('gift')} Send win-back offers</a>
            ${d.missing.withConsent ? html`<p class="small muted" style="margin-top:8px">${plural(d.missing.withConsent, 'customer')} can get an offer on WhatsApp right now.</p>` : ''}`
          : html`<p class="muted">Everyone came back recently. Nice.</p>`}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Birthdays this week</h2></div>
          ${d.birthdays.length ? html`<div class="list">${d.birthdays.map((b) => html`
            <div class="list-item">
              <span class="avatar" style="background:var(--marigold-soft);color:#7a5000">${icon('cake', 'icon icon-sm')}</span>
              <div class="grow"><a class="title" href="/app/customer?id=${b.id}">${b.name}</a>
                <div class="small muted">${b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : `${fmtBirthday(b.birthday)}, in ${b.inDays} days`}</div></div>
              ${b.couponSent ? html`<span class="badge good">Offer sent</span>` : ''}
            </div>`)}</div>
            <a href="/app/offers#birthdays" class="small" style="display:inline-block;margin-top:10px">Send birthday offers</a>`
          : html`<p class="muted">No birthdays in the next 7 days.</p>`}
        </section>

        <section class="panel">
          <div class="panel-head"><h2>This month</h2></div>
          <dl class="mini-stats">
            <div><dt>Sales</dt><dd class="num">${rupees(d.month.sales)}</dd></div>
            <div><dt>Bills</dt><dd class="num">${d.month.bills}</dd></div>
            <div><dt>Repeat visits</dt><dd class="num">${d.month.visits ? Math.round((d.month.repeatVisits / d.month.visits) * 100) : 0}%</dd></div>
            <div><dt>New cards</dt><dd class="num">${d.month.newMembers}</dd></div>
          </dl>
        </section>
      </div>
    </div>`;

  $('#chart').append(barChart(
    d.last14.map((x, i) => {
      const date = parseDate(`${x.day} 00:00:00`);
      return {
        label: i === d.last14.length - 1 ? 'Today' : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        title: date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        segments: [
          { name: 'paid', value: x.sales, className: 'bar', text: rupees(x.sales) },
          { name: 'discount', value: x.discount, className: 'bar-2', text: rupees(x.discount) },
        ],
      };
    }),
    { height: 210, width: $('#chart').clientWidth, ariaLabel: 'Daily sales for the last 14 days' }
  ));

  page.querySelectorAll('[data-undo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/visits/${btn.dataset.undo}/undo`);
        toast('Bill undone.');
        load();
      } catch (err) { toastError(err); }
    });
  });
}

load().catch(toastError);

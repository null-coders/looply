// Printable physical loyalty card (front + back, credit-card size).
import { api } from '../api.js';
import { fmtCode, html, icon, ordinal } from '../ui.js';

const id = new URLSearchParams(location.search).get('id');
const [me, data] = await Promise.all([api.get('/me'), api.get(`/customers/${encodeURIComponent(id)}`)]);
const c = data.customer;
const s = me.program.settings;
document.title = `Card for ${c.name} | Looply`;

const perks = c.tiers.filter((t) => t.percent > 0).slice(0, 3).map((t) => `${ordinal(t.atVisit)} visit: ${t.percent}% off`);
if (s.stamp_enabled) perks.push(`Full ${s.stamp_every}-stamp card: ${s.stamp_reward}`);

document.body.innerHTML = html`
  <div class="print-bar">
    <div><strong>Loyalty card for ${c.name}</strong><p>Print on thick paper or card sheet, cut along the dashed lines and fold or stick back to back.</p></div>
    <div class="row">
      <a class="btn" href="/app/customer?id=${c.id}">${icon('back', 'icon icon-sm')} Back</a>
      <button type="button" class="btn btn-primary" data-print>${icon('printer', 'icon icon-sm')} Print</button>
    </div>
  </div>
  <div class="sheet">
    <div class="card-pair">
      <div class="pcard pcard-front">
        <div class="ring" aria-hidden="true"></div>
        <div class="shop">${me.shop.name}</div>
        <div class="kind">Loyalty card</div>
        <div class="who">
          <div class="name">${c.name}</div>
          <div class="code">${fmtCode(c.cardCode)}</div>
        </div>
        <div class="brand-small">Looply</div>
      </div>
      <div class="pcard pcard-back">
        <img src="/api/public/cards/${c.cardToken}/qr.svg" alt="QR code">
        <div>
          <div class="scan">Show this at the counter. Scan it to see your rewards.</div>
          <ul>${perks.map((p) => html`<li>${p}</li>`)}</ul>
          <div class="code-line">Card ${fmtCode(c.cardCode)}${me.shop.phone ? `, shop ${me.shop.phone}` : ''}</div>
        </div>
      </div>
    </div>
    ${me.phoneUrls.length ? html`<p class="print-help">Note: this QR code opens ${me.baseUrl}, which works only on this computer. Open Looply at ${me.phoneUrls[0]} before printing so the code works on customers' phones.</p>` : ''}
  </div>`;

document.querySelector('[data-print]').addEventListener('click', () => window.print());

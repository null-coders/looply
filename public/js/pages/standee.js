// Printable counter poster: customers scan it to get a loyalty card themselves.
import { api } from '../api.js';
import { html, icon, ordinal } from '../ui.js';

const me = await api.get('/me');
const s = me.program.settings;
const tiers = me.program.tiers;
document.title = `Counter poster | Looply`;

const perks = tiers
  .filter((t) => t.discount_percent > 0)
  .slice(0, 3)
  .map((t) => html`<div><strong>${t.discount_percent}% off</strong> from your ${ordinal(t.min_visits)} visit</div>`);
if (s.comeback_enabled) perks.push(html`<div><strong>${s.comeback_percent}% off</strong> when you come back within ${s.comeback_days} days</div>`);
if (s.stamp_enabled) perks.push(html`<div><strong>${s.stamp_reward}</strong> when your ${s.stamp_every}-stamp card is full</div>`);
perks.push(html`<div><strong>${s.birthday_percent}% off</strong> on your birthday</div>`);

document.body.innerHTML = html`
  <div class="print-bar">
    <div><strong>Counter poster</strong><p>Print it and keep it near the bill counter. Customers scan it with the phone camera to join.</p></div>
    <div class="row">
      <a class="btn" href="/app/settings">${icon('back', 'icon icon-sm')} Back</a>
      <button type="button" class="btn btn-primary" data-print>${icon('printer', 'icon icon-sm')} Print</button>
    </div>
  </div>
  <div class="sheet">
    <div class="poster">
      <div class="shop">${me.shop.name}</div>
      <h1>Get your free loyalty card</h1>
      <div class="qr-wrap"><img src="/api/shop/join-qr.svg" alt="QR code to join"></div>
      <div class="scan">Scan with your phone camera</div>
      <div class="perks">${perks}</div>
      <div class="foot">No app needed. Your card opens in your phone browser.</div>
    </div>
    ${me.phoneUrls.length ? html`<p class="print-help">Note: this QR code opens ${me.baseUrl}, which works only on this computer. Open Looply at ${me.phoneUrls[0]} before printing so the code works on customers' phones.</p>` : ''}
  </div>`;

document.querySelector('[data-print]').addEventListener('click', () => window.print());

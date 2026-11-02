// Self sign-up page. The customer scans the poster on the counter and
// creates their own loyalty card here.
import { api } from '../api.js';
import { customerFields, readCustomerForm } from '../customer-form.js';
import { $, formError, html, LOGO_MARK, ordinal } from '../ui.js';

const slug = location.pathname.split('/').filter(Boolean).pop();
document.body.className = 'public';

async function load() {
  let shop;
  try {
    shop = await api.get(`/public/shops/${encodeURIComponent(slug)}`);
  } catch (err) {
    document.body.innerHTML = html`<div class="public-wrap"><div class="empty"><h3>Shop not found</h3><p>${err.message}</p></div></div>`;
    return;
  }
  document.title = `Join ${shop.name} rewards`;

  const perks = shop.tiers.filter((t) => t.percent > 0).map((t) => html`<li><strong>${t.percent}% off</strong><span>from your ${ordinal(t.atVisit)} visit (${t.name})</span></li>`);
  if (shop.comeback) perks.push(html`<li><strong>${shop.comeback.percent}% off</strong><span>when you come back within ${shop.comeback.days} days</span></li>`);
  if (shop.stamps) perks.push(html`<li><strong>Free</strong><span>${shop.stamps.reward} when your ${shop.stamps.every}-stamp card is full. One stamp per visit${shop.stamps.welcome ? ', and the first stamp is free today' : ''}.</span></li>`);
  perks.push(html`<li><strong>${shop.birthdayPercent}% off</strong><span>on your birthday</span></li>`);

  document.body.innerHTML = html`<div class="public-wrap">
    <div class="join-head">
      <div class="shop">${shop.name}</div>
      <h1>Get your free loyalty card</h1>
    </div>
    <section class="panel"><h2 style="margin-bottom:12px">What you get</h2><ul class="perk-list">${perks}</ul></section>
    <form class="panel form-grid" style="margin-top:16px" novalidate>
      <h2>Your details</h2>
      ${customerFields()}
      <p class="small muted">${shop.name} uses your name, number and birthday only for this loyalty card. You can turn off offers or delete your card at any time from the card page.</p>
      <button class="btn btn-primary btn-lg" type="submit">Get my card</button>
    </form>
    <div class="public-foot">${LOGO_MARK}<span>Loyalty card by Looply</span></div>
  </div>`;

  // The consent text is written for the shopkeeper; reword it for the customer.
  $('.check span').innerHTML = html`Send me offers from ${shop.name} on WhatsApp. <span class="muted">Optional, you can stop anytime.</span>`;

  const form = $('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, null);
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const r = await api.post(`/public/shops/${encodeURIComponent(slug)}/join`, readCustomerForm(form));
      location.href = `${r.cardPath}?joined=1`;
    } catch (err) {
      formError(form, err.message);
      button.disabled = false;
    }
  });
}

load();

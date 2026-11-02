// Shop settings: profile, self sign-up QR, data download, password.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import { $, copyText, formData, formError, html, icon, toast } from '../ui.js';

const { me, page } = await startPage('settings', 'Shop settings');
const shop = me.shop;
const CATEGORIES = [['cafe', 'Cafe / tea stall'], ['salon', 'Salon / parlour'], ['kirana', 'Kirana store'], ['fashion', 'Clothes / shoes'], ['other', 'Something else']];

page.innerHTML = html`
  <div class="page-head"><div><h1>Shop settings</h1><p>Your shop details, sign-up QR code and data.</p></div></div>
  <div class="grid-2">
    <div class="stack">
      <form class="panel form-grid" id="profile" novalidate>
        <h2>Shop details</h2>
        <label class="field"><span>Shop name</span><input class="input" name="name" value="${shop.name}" maxlength="60"></label>
        <div class="form-grid two">
          <label class="field"><span>Owner name</span><input class="input" name="ownerName" value="${shop.ownerName}" maxlength="60"></label>
          <label class="field"><span>Shop mobile</span><input class="input" name="phone" value="${shop.phone || ''}" inputmode="tel" placeholder="Shown on customer cards"></label>
        </div>
        <label class="field"><span>Address</span><input class="input" name="address" value="${shop.address || ''}" maxlength="160" placeholder="Shown on customer cards"></label>
        <label class="field"><span>Type of shop</span>
          <select class="input" name="category">${CATEGORIES.map(([v, l]) => html`<option value="${v}" ${v === shop.category ? html`selected` : ''}>${l}</option>`)}</select></label>
        <div><button class="btn btn-primary" type="submit">Save details</button></div>
      </form>

      <form class="panel form-grid" id="password" novalidate>
        <h2>Change password</h2>
        <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8"></label>
        <div><button class="btn" type="submit">Change password</button></div>
      </form>
    </div>

    <div class="stack">
      <section class="panel">
        <h2>Customers can join by themselves</h2>
        <p class="section-help">Put this QR code on your counter. Customers scan it with their phone camera, type their name and number, and get a card. No queue at the counter.</p>
        <div class="card-qr">
          <img src="/api/shop/join-qr.svg" alt="QR code to join ${shop.name} rewards" width="148" height="148">
          <div class="stack-sm">
            <a class="btn btn-primary btn-sm" href="/app/standee" target="_blank" rel="noopener">${icon('printer', 'icon icon-sm')} Print counter poster</a>
            <button type="button" class="btn btn-sm" data-copy>${icon('copy', 'icon icon-sm')} Copy join link</button>
            <a class="btn btn-sm" href="/join/${shop.slug}" target="_blank" rel="noopener">${icon('link', 'icon icon-sm')} Open join page</a>
          </div>
        </div>
        ${me.phoneUrls.length ? html`<div class="note-box">
          <strong>For phones to open QR codes</strong>
          <p class="small">You opened Looply as ${me.baseUrl}, which only works on this computer. Open it at <a href="${me.phoneUrls[0]}/app/settings">${me.phoneUrls[0]}</a> (phones on the same Wi-Fi) and all QR codes and card links will work on phones too.</p>
        </div>` : ''}
      </section>

      <section class="panel">
        <h2>Your data</h2>
        <p class="section-help">Download everything as Excel-ready CSV files. Keep a copy as a backup.</p>
        <div class="row">
          <a class="btn btn-sm" href="/api/export/customers.csv" download>${icon('download', 'icon icon-sm')} Customers</a>
          <a class="btn btn-sm" href="/api/export/visits.csv" download>${icon('download', 'icon icon-sm')} All bills</a>
        </div>
        <p class="small muted" style="margin-top:14px">Customers can stop WhatsApp offers or delete their own data from their card page at any time. Card links use a long secret code, so nobody can guess another customer's card.</p>
      </section>
    </div>
  </div>`;

$('[data-copy]').addEventListener('click', () => copyText(me.joinUrl, 'Join link copied'));

$('#profile').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  formError(form, null);
  try {
    await api.put('/shop', formData(form));
    document.querySelectorAll('[data-shop-name]').forEach((el) => { el.textContent = form.elements.namedItem('name').value; });
    toast('Shop details saved.');
  } catch (err) { formError(form, err.message); }
});

$('#password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  formError(form, null);
  try {
    await api.put('/shop/password', formData(form));
    form.reset();
    toast('Password changed.');
  } catch (err) { formError(form, err.message); }
});

import { api } from '../api.js';
import { $, formData, formError, html } from '../ui.js';
import { authLayout } from './auth-common.js';

const CATEGORIES = [
  ['cafe', 'Cafe / tea stall'],
  ['salon', 'Salon / parlour'],
  ['kirana', 'Kirana store'],
  ['fashion', 'Clothes / shoes'],
  ['other', 'Something else'],
];

document.title = 'Create your shop | Looply';
authLayout(html`
  <h1>Create your shop</h1>
  <p>Takes a minute. We set up a reward program for your type of shop, and you can change it later.</p>
  <form class="form-grid" novalidate>
    <label class="field"><span>Shop name</span>
      <input class="input" name="shopName" required maxlength="60" placeholder="Sharma General Store"></label>
    <div class="form-grid two">
      <label class="field"><span>Your name</span>
        <input class="input" name="ownerName" required maxlength="60" autocomplete="name"></label>
      <label class="field"><span>Mobile <span class="hint">(optional)</span></span>
        <input class="input" name="phone" inputmode="tel" autocomplete="tel" placeholder="98765 43210"></label>
    </div>
    <fieldset class="field" style="border:0;padding:0;margin:0">
      <legend class="strong" style="margin-bottom:6px">What kind of shop?</legend>
      <div class="category-picker">
        ${CATEGORIES.map(([value, label], i) => html`<label><input type="radio" name="category" value="${value}" ${i === 0 ? html`checked` : ''}>${label}</label>`)}
      </div>
    </fieldset>
    <label class="field"><span>Email</span>
      <input class="input" type="email" name="email" required autocomplete="email"></label>
    <label class="field"><span>Password <span class="hint">(at least 8 characters)</span></span>
      <input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    <button class="btn btn-primary btn-lg" type="submit">Create shop</button>
    <p class="muted">Already have a shop? <a href="/login">Log in</a></p>
  </form>
`);

const form = $('form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, null);
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api.post('/auth/register', formData(form));
    location.href = '/app/rewards?welcome=1';
  } catch (err) {
    formError(form, err.message);
    form.scrollIntoView({ block: 'start' });
    button.disabled = false;
  }
});

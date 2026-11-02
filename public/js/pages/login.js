import { api } from '../api.js';
import { $, formData, formError, html } from '../ui.js';
import { authLayout } from './auth-common.js';

document.title = 'Log in | Looply';
authLayout(html`
  <h1>Log in to your shop</h1>
  <p>Use the email and password you signed up with.</p>
  <div class="demo-box">
    <strong>Try the demo shop.</strong> It already has customers, bills and offers.
    <div class="row" style="margin-top:8px">
      <span class="small">demo@looply.in / demo1234</span>
      <button type="button" class="btn btn-sm" data-demo>Use demo login</button>
    </div>
  </div>
  <form class="form-grid" novalidate>
    <label class="field"><span>Email</span>
      <input class="input" type="email" name="email" autocomplete="email" required></label>
    <label class="field"><span>Password</span>
      <input class="input" type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn btn-primary btn-lg" type="submit">Log in</button>
    <p class="muted">New here? <a href="/register">Create your shop</a></p>
  </form>
`);

const form = $('form');
if (new URLSearchParams(location.search).has('demo')) {
  form.email.value = 'demo@looply.in';
  form.password.value = 'demo1234';
}
$('[data-demo]').addEventListener('click', () => {
  form.email.value = 'demo@looply.in';
  form.password.value = 'demo1234';
  form.requestSubmit();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, null);
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api.post('/auth/login', formData(form));
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/app') ? next : '/app/';
  } catch (err) {
    formError(form, err.message);
    button.disabled = false;
  }
});

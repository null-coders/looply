// The frame around every shopkeeper screen: sidebar on computers,
// top bar + bottom tabs on phones.
import { api } from './api.js';
import { $, html, icon, LOGO_MARK, openDialog, toastError } from './ui.js';

const NAV = [
  { key: 'home', label: 'Home', href: '/app/', icon: 'home' },
  { key: 'counter', label: 'Counter', href: '/app/counter', icon: 'counter', counter: true },
  { key: 'customers', label: 'Customers', href: '/app/customers', icon: 'users' },
  { key: 'offers', label: 'Bring back', href: '/app/offers', icon: 'gift' },
  { key: 'rewards', label: 'Rewards', href: '/app/rewards', icon: 'star' },
  { key: 'reports', label: 'Reports', href: '/app/reports', icon: 'chart' },
  { key: 'settings', label: 'Shop settings', href: '/app/settings', icon: 'sliders' },
];

async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    location.href = '/login';
  }
}

function openMoreSheet() {
  const dialog = openDialog({
    title: 'More',
    body: html`<div class="sheet-list">
      ${NAV.filter((n) => ['rewards', 'reports', 'settings'].includes(n.key)).map(
        (n) => html`<a href="${n.href}">${icon(n.icon)} ${n.label}</a>`
      )}
      <button type="button" data-logout>${icon('logout')} Log out</button>
    </div>`,
  });
  $('[data-logout]', dialog).addEventListener('click', logout);
}

/**
 * Draws the frame, loads the logged-in shop and returns
 * { me, page } where `page` is the element the screen should fill.
 */
export async function startPage(active, title) {
  document.title = `${title} | Looply`;
  const navLink = (n) => html`<a href="${n.href}" class="${n.counter ? 'nav-counter' : ''}" ${n.key === active ? html`aria-current="page"` : ''}>${icon(n.icon)}<span>${n.label}</span></a>`;
  const tab = (key, label, iconName, href) => html`<a href="${href}" ${key === active ? html`aria-current="page"` : ''}>${icon(iconName)}<span>${label}</span></a>`;

  document.body.innerHTML = html`
    <a href="#page" class="sr-only">Skip to content</a>
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="/app/">${LOGO_MARK}<span class="brand-name">Looply</span></a>
        <nav class="nav" aria-label="Main">${NAV.map(navLink)}</nav>
        <div class="sidebar-foot">
          <div class="shop-name" data-shop-name></div>
          <div class="tiny" data-owner-name></div>
          <button type="button" data-logout>${icon('logout', 'icon icon-sm')} Log out</button>
        </div>
      </aside>
      <header class="topbar">
        <a class="brand" href="/app/">${LOGO_MARK}<span class="brand-name">Looply</span></a>
        <span class="shop-name" data-shop-name></span>
      </header>
      <main class="main"><div class="page" id="page" tabindex="-1"><div class="loading">Loading</div></div></main>
      <nav class="tabbar" aria-label="Main">
        ${tab('home', 'Home', 'home', '/app/')}
        ${tab('customers', 'Customers', 'users', '/app/customers')}
        <a href="/app/counter" class="tab-counter" ${active === 'counter' ? html`aria-current="page"` : ''}><span class="bubble">${icon('counter')}</span><span>Counter</span></a>
        ${tab('offers', 'Bring back', 'gift', '/app/offers')}
        <button type="button" data-more ${['rewards', 'reports', 'settings'].includes(active) ? html`aria-current="page"` : ''}>${icon('more')}<span>More</span></button>
      </nav>
    </div>`;

  $('[data-logout]').addEventListener('click', logout);
  $('[data-more]').addEventListener('click', openMoreSheet);

  let me;
  try {
    me = await api.get('/me');
  } catch (err) {
    $('#page').innerHTML = html`<div class="empty"><h3>Could not load Looply</h3><p>${err.message}</p></div>`;
    toastError(err);
    throw err;
  }
  document.querySelectorAll('[data-shop-name]').forEach((el) => { el.textContent = me.shop.name; });
  $('[data-owner-name]').textContent = me.shop.ownerName;
  return { me, page: $('#page') };
}

// Shared layout for the login and register pages.
import { html, inkStamp, LOGO_MARK } from '../ui.js';

function sampleCard() {
  const slots = Array.from({ length: 7 }, (_, i) =>
    i < 4
      ? html`<div class="stamp-slot filled">${inkStamp()}</div>`
      : i === 6
        ? html`<div class="stamp-slot reward">Free</div>`
        : html`<div class="stamp-slot">${i + 1}</div>`
  );
  return html`<div class="demo-stamp">
    <div class="demo-stamp-head"><strong>Kesar Chai Corner</strong><span>Anita Rao</span></div>
    <div class="stamp-grid">${slots}</div>
    <p>3 more visits for a free chai</p>
  </div>`;
}

export function authLayout(content) {
  document.body.innerHTML = html`
    <div class="auth-page">
      <aside class="auth-side">
        <a class="brand" href="/">${LOGO_MARK}<span class="brand-name">Looply</span></a>
        <div>
          <h2>Bring your customers back, again and again.</h2>
          <p>Loyalty cards, visit discounts and comeback offers for local shops. Works on any phone, no app to install.</p>
        </div>
        ${sampleCard()}
      </aside>
      <main class="auth-main"><div class="auth-box">${content}</div></main>
    </div>`;
}

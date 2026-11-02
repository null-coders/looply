// Public home page that explains Looply.
import { html, inkStamp, LOGO_MARK } from '../ui.js';

document.title = 'Looply | Loyalty cards for local shops';

const stamps = Array.from({ length: 7 }, (_, i) =>
  i < 5 ? html`<div class="stamp-slot filled">${inkStamp()}</div>`
    : i === 6 ? html`<div class="stamp-slot reward">Free</div>`
      : html`<div class="stamp-slot">${i + 1}</div>`
);

const STEPS = [
  ['Give a card', 'Type the customer\'s mobile number at the counter and send the card link on WhatsApp. Or they scan your counter poster and join by themselves.'],
  ['Record every bill', 'Type the bill amount. Looply picks the best discount the customer has earned: their level, a comeback offer or a coupon.'],
  ['Discounts grow with visits', '2nd visit 5% off, 3rd visit 10% off, and a free item when the stamp card is full. You choose the numbers.'],
  ['Bring back who stopped coming', 'See who has not come for 30 days and send them a personal offer on WhatsApp in one tap. Then see who came back.'],
];

document.body.innerHTML = html`
  <header class="landing-top">
    <a class="brand" href="/">${LOGO_MARK}<span class="brand-name">Looply</span></a>
    <nav class="row"><a class="btn btn-ghost" href="/login">Log in</a><a class="btn btn-primary" href="/register">Create your shop</a></nav>
  </header>

  <main>
    <section class="hero">
      <div class="hero-text">
        <h1>Make every customer a regular.</h1>
        <p>Looply gives every customer of your shop a loyalty card on their phone. Discounts grow with every visit, comeback offers bring them back within days, and you can see who stopped coming.</p>
        <div class="row" style="margin-top:22px">
          <a class="btn btn-primary btn-lg" href="/login?demo=1">Try the demo shop</a>
          <a class="btn btn-lg" href="/register">Create your shop</a>
        </div>
        <p class="small muted" style="margin-top:12px">Free to run on your own computer. Customers need no app.</p>
      </div>
      <div class="hero-visual" aria-label="Example loyalty card">
        <div class="lcard">
          <div class="ring" aria-hidden="true"></div>
          <div class="shop">Kesar Chai Corner</div>
          <div class="kind">Loyalty card</div>
          <div class="bottom"><div><div class="name">Anita Rao</div><div class="code">K7M-2QX</div></div><span class="level">Gold</span></div>
        </div>
        <div class="hero-offer">
          <div><div class="small muted">On your next visit</div><div class="hero-big">10% off</div></div>
          <div class="stamp-grid">${stamps}</div>
        </div>
      </div>
    </section>

    <section class="steps-section">
      <h2>How it works</h2>
      <ol class="steps">${STEPS.map(([t, d], i) => html`<li><span class="step-n">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`)}</ol>
    </section>

    <section class="rules-section">
      <div>
        <h2>Fair rules, built in</h2>
        <p class="muted">Discounts should grow your sales, not eat your profit.</p>
      </div>
      <ul class="rules">
        <li><strong>Minimum bill.</strong> A ₹5 toffee does not count as a visit.</li>
        <li><strong>One visit a day.</strong> One bill cannot be split into many visits.</li>
        <li><strong>Best offer only.</strong> Discounts never stack. Unused offers wait for next time.</li>
        <li><strong>Discount limit.</strong> Set the most you give on a single bill.</li>
        <li><strong>Undo.</strong> A wrong bill can be undone within 10 minutes.</li>
        <li><strong>Customer control.</strong> Customers can stop offers or delete their card themselves.</li>
      </ul>
    </section>
  </main>

  <footer class="landing-foot">${LOGO_MARK}<span>Looply: loyalty cards for local shops</span></footer>`;

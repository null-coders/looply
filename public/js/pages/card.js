// The customer's own digital loyalty card. Opened from the link they get
// on WhatsApp or by scanning the QR on their printed card. No login needed:
// the long secret code in the link is the key.
import { api } from '../api.js';
import { levelJourney, stampCard } from '../loyalty-view.js';
import { $, fmtCode, fmtDate, fmtShort, html, LOGO_MARK, openDialog, rupees, toast, toastError } from '../ui.js';

const token = location.pathname.split('/').filter(Boolean).pop();
document.body.className = 'public';

const KIND = { winback: 'We miss you offer', birthday: 'Birthday gift', gift: 'Gift from the shop' };

async function load() {
  let d;
  try {
    d = await api.get(`/public/cards/${encodeURIComponent(token)}`);
  } catch (err) {
    document.body.innerHTML = html`<div class="public-wrap"><div class="empty"><h3>Card not found</h3><p>${err.message}</p></div></div>`;
    return;
  }
  document.title = `${d.shop.name} loyalty card`;
  const first = d.customer.name.split(' ')[0];
  const joined = new URLSearchParams(location.search).get('joined');

  document.body.innerHTML = html`<div class="public-wrap">
    <div class="public-top">
      <span class="shop-line">${d.shop.name}</span>
      ${d.shop.phone ? html`<a href="tel:${d.shop.phone}">Call shop</a>` : ''}
    </div>

    ${joined ? html`<div class="welcome-box"><strong>Welcome, ${first}!</strong> This page is your loyalty card. Save it: bookmark it or use "Add to Home screen" in your browser. Show it at the counter on every visit.</div>` : ''}

    <div class="lcard">
      <div class="ring" aria-hidden="true"></div>
      <div class="shop">${d.shop.name}</div>
      <div class="kind">Loyalty card</div>
      <div class="bottom">
        <div><div class="name">${d.customer.name}</div><div class="code">${fmtCode(d.customer.cardCode)}</div></div>
        <span class="level">${d.level.name}</span>
      </div>
    </div>

    <div class="next-offer">
      ${d.nextVisit.percent > 0
        ? html`<div class="lead">On your next visit</div><div class="big">${d.nextVisit.percent}% off</div><div class="why">${d.nextVisit.level} level, after ${d.visits} ${d.visits === 1 ? 'visit' : 'visits'}</div>`
        : d.upcoming
          ? html`<div class="lead">Your discount starts on visit ${d.upcoming.atVisit}</div><div class="big">${d.upcoming.percent}% off</div><div class="why">${d.upcoming.visitsToGo === 1 ? 'Just 1 more visit' : `${d.upcoming.visitsToGo} more visits`} to reach ${d.upcoming.name}</div>`
          : html`<div class="lead">Thanks for being a member</div>`}
      ${d.comeback ? html`<div class="comeback-line">Come back by <strong>${fmtShort(d.comeback.expiresAt)}</strong> and get <strong>${d.comeback.percent}% off</strong> instead.</div>` : ''}
    </div>

    ${d.coupons.length ? html`<section class="pub-section"><h2>Your coupons</h2>
      ${d.coupons.map((k) => html`<div class="ticket"><span class="pct">${k.percent}%</span>
        <div><strong>${KIND[k.kind]}</strong><div class="meta">Code ${k.code}, valid till ${fmtShort(k.expiresAt)}. Applied automatically at the counter.</div></div></div>`)}
    </section>` : ''}

    ${d.stamps ? html`<section class="pub-section panel"><h2>Stamp card</h2>${stampCard(d.stamps)}</section>` : ''}

    <section class="pub-section panel"><h2>Your levels</h2>
      ${levelJourney(d.tiers, d.visits)}
      ${d.upcoming && d.nextVisit.percent > 0 ? html`<p class="small muted" style="margin-top:8px">${d.upcoming.name} (${d.upcoming.percent}% off) from visit ${d.upcoming.atVisit}. ${d.upcoming.visitsToGo === 1 ? '1 visit' : `${d.upcoming.visitsToGo} visits`} to go.</p>` : ''}
    </section>

    <section class="pub-section panel show-qr"><h2>Show at the counter</h2>
      <img src="/api/public/cards/${encodeURIComponent(token)}/qr.svg" alt="Your card QR code" width="200" height="200">
      <div class="code">${fmtCode(d.customer.cardCode)}</div>
      <p class="small muted">Or just tell them your mobile number ending in ${d.customer.phoneEnd}.</p>
    </section>

    <section class="pub-section panel"><h2>Your visits</h2>
      ${d.recent.length ? html`<ul class="visits-list">${d.recent.map((v) => html`<li>
          <span>${fmtDate(v.date)}${v.freeReward ? html`, <strong>${v.freeReward}</strong>` : ''}</span>
          <span>${rupees(v.paid)}${v.saved ? html` <span style="color:var(--leaf)">(saved ${rupees(v.saved)})</span>` : ''}</span></li>`)}</ul>
        <p class="small" style="margin-top:10px">You have saved <strong>${rupees(d.totalSaved)}</strong> with this card.</p>`
      : html`<p class="muted small">Your visits will show here.</p>`}
    </section>

    <section class="pub-section panel privacy"><h2>Your data</h2>
      <div class="switch-row">
        <div><strong>Offers on WhatsApp</strong><div class="small muted">Birthday and special offers from ${d.shop.name}.</div></div>
        <label class="switch"><input type="checkbox" id="consent" ${d.customer.consent ? html`checked` : ''} aria-label="Get offers on WhatsApp"><span></span></label>
      </div>
      <p class="small muted">${d.shop.name} keeps your name, mobile number and visits only to run this card. Member since ${fmtDate(d.customer.joinedAt)}.</p>
      <p style="margin-top:10px"><button type="button" class="link-btn" id="delete">Delete my card and data</button></p>
    </section>

    <div class="public-foot">${LOGO_MARK}<span>Loyalty card by Looply</span></div>
  </div>`;

  $('#consent').addEventListener('change', async (e) => {
    try {
      const r = await api.put(`/public/cards/${encodeURIComponent(token)}/consent`, { consent: e.target.checked });
      toast(r.consent ? 'You will get offers on WhatsApp.' : 'Offers turned off. You keep your discounts.');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toastError(err);
    }
  });

  $('#delete').addEventListener('click', () => {
    openDialog({
      title: 'Delete your card?',
      body: html`<p>Your card, level, stamps and coupons will be deleted for good. To confirm, type the last 4 digits of your mobile number.</p>
        <label class="field" style="margin-top:12px"><span>Last 4 digits</span><input class="input" id="phone-end" inputmode="numeric" maxlength="4" autocomplete="off"></label>`,
      buttons: [
        { label: 'Keep my card', className: 'btn-ghost' },
        {
          label: 'Delete for good',
          className: 'btn-danger',
          onClick: async (dlg) => {
            try {
              await api.post(`/public/cards/${encodeURIComponent(token)}/delete`, { phoneEnd: $('#phone-end', dlg).value });
              document.body.innerHTML = html`<div class="public-wrap"><div class="empty"><h3>Your card is deleted</h3><p>${d.shop.name} no longer has your details.</p></div></div>`;
            } catch (err) {
              toastError(err);
              return false;
            }
          },
        },
      ],
    });
  });
}

load();

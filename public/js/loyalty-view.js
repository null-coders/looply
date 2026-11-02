// Pieces that show a customer's loyalty status. Used by the counter,
// the customer page and the customer's own card.
import { fmtShort, html, inkStamp, plural } from './ui.js';

/** Stamp card: filled stamps, empty slots, and the reward slot at the end. */
export function stampCard(stamps, { animateLast = false } = {}) {
  if (!stamps) return '';
  const slots = [];
  for (let i = 1; i <= stamps.every; i++) {
    if (i <= stamps.filled) {
      const isLast = animateLast && i === stamps.filled;
      slots.push(html`<div class="stamp-slot filled" title="Stamp ${i}">${inkStamp(isLast ? 'thunk' : '')}</div>`);
    } else if (i === stamps.every) {
      slots.push(html`<div class="stamp-slot reward" title="${stamps.reward}">Free</div>`);
    } else {
      slots.push(html`<div class="stamp-slot">${i}</div>`);
    }
  }
  const left = stamps.every - stamps.filled;
  return html`
    <div class="stamp-grid" role="img" aria-label="${stamps.filled} of ${stamps.every} stamps">${slots}</div>
    <p class="small muted" style="margin-top:8px">${
      left === stamps.every && stamps.rewardsEarned > 0
        ? html`Reward collected. A new card starts now: ${stamps.every} visits for ${stamps.reward}.`
        : left === 1
          ? html`<strong class="strong" style="color:var(--ink)">Next visit: ${stamps.reward} free!</strong>`
          : html`${plural(left, 'more visit')} for ${stamps.reward}.`
    }</p>`;
}

/** Levels as milestones: Visit 1 Member, Visit 2 Silver 5% ... */
export function levelJourney(tiers, visits) {
  let nextMarked = false;
  return html`<div class="journey">${tiers.map((t) => {
    const done = visits >= t.atVisit;
    let cls = done ? 'done' : '';
    if (!done && !nextMarked) { cls = 'next'; nextMarked = true; }
    return html`<div class="journey-step ${cls}">
      <div class="journey-dot" aria-hidden="true">${t.atVisit}</div>
      <div class="j-name">${t.name}</div>
      <div class="j-off">${t.percent ? `${t.percent}% off` : 'Card'}</div>
      <span class="sr-only">from visit ${t.atVisit}${done ? ', reached' : ''}</span>
    </div>`;
  })}</div>`;
}

/** Plain-language list of what the customer gets next. */
export function offerLines(s) {
  const lines = [];
  if (s.nextVisit.percent > 0) {
    lines.push(html`<li><strong>${s.nextVisit.percent}% off</strong> on the next visit <span class="muted">(${s.nextVisit.level} level)</span></li>`);
  } else if (s.upcoming) {
    lines.push(html`<li>${s.upcoming.name} level (${s.upcoming.percent}% off) from visit ${s.upcoming.atVisit}</li>`);
  }
  if (s.comeback) {
    lines.push(html`<li><strong>${s.comeback.percent}% off</strong> if they come back by ${fmtShort(s.comeback.expiresAt)} <span class="muted">(comeback offer)</span></li>`);
  }
  for (const c of s.coupons) {
    lines.push(html`<li><strong>${c.percent}% off</strong> with coupon ${c.code} <span class="muted">(valid till ${fmtShort(c.expiresAt)})</span></li>`);
  }
  if (!lines.length) lines.push(html`<li class="muted">No discount yet. It starts as they keep coming.</li>`);
  return html`<ul class="offer-lines">${lines}</ul>`;
}

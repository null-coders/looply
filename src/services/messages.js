// Ready-made WhatsApp messages.
//
// We do not use the paid WhatsApp Business API. Instead we build a
// wa.me link with the message already typed in. The shopkeeper taps it,
// WhatsApp opens on their own phone/laptop, and they press Send. Free.
import { DEMO_EMAIL } from '../constants.js';
import { parseSqlDateTime, rupees, shortDate, whatsappLink } from '../utils.js';

const firstName = (name) => String(name).split(' ')[0];

// The demo shop's customers have made-up numbers that could belong to real
// people, so demo messages open WhatsApp without a number (you pick the chat).
const sendTo = (shop, customer) => (shop.email === DEMO_EMAIL ? null : customer.phone);

export function cardUrl(baseUrl, token) {
  return `${baseUrl}/card/${token}`;
}

export function welcomeMessage({ shop, customer, nextVisitPercent, baseUrl }) {
  const lines = [
    `Welcome to ${shop.name} rewards, ${firstName(customer.name)}!`,
    '',
    `Your loyalty card: ${cardUrl(baseUrl, customer.card_token)}`,
    'Show this card (or tell your number) at the counter on every visit.',
  ];
  if (nextVisitPercent > 0) lines.push(`Your next visit: ${nextVisitPercent}% off.`);
  return whatsappLink(sendTo(shop, customer), lines.join('\n'));
}

export function receiptMessage({ shop, customer, visit, state, baseUrl }) {
  const lines = [`Thank you for visiting ${shop.name}, ${firstName(customer.name)}!`, ''];
  lines.push(`Bill: ${rupees(visit.bill_amount)}`);
  if (visit.discount_amount > 0) {
    lines.push(`Discount (${visit.discount_label}, ${visit.discount_percent}%): -${rupees(visit.discount_amount)}`);
  }
  lines.push(`Paid: ${rupees(visit.final_amount)}`);
  if (visit.free_reward) lines.push(`Free reward: ${visit.free_reward}`);
  lines.push('');
  if (state.comeback) {
    lines.push(`Come back by ${shortDate(parseSqlDateTime(state.comeback.expiresAt))} and get ${state.comeback.percent}% off.`);
  } else if (state.nextVisit.percent > 0) {
    lines.push(`Your next visit: ${state.nextVisit.percent}% off (${state.nextVisit.level}).`);
  }
  if (state.stamps) {
    lines.push(`Stamps: ${state.stamps.filled} of ${state.stamps.every} for ${state.stamps.reward}.`);
  }
  lines.push(`Your card: ${cardUrl(baseUrl, customer.card_token)}`);
  return whatsappLink(sendTo(shop, customer), lines.join('\n'));
}

export function couponMessage({ shop, customer, coupon, baseUrl }) {
  const name = firstName(customer.name);
  const until = shortDate(parseSqlDateTime(coupon.expires_at));
  const intro = {
    winback: `Hi ${name}, we miss you at ${shop.name}! Here is ${coupon.discount_percent}% off on your next visit.`,
    birthday: `Happy birthday, ${name}! ${shop.name} has a gift for you: ${coupon.discount_percent}% off on your next visit.`,
    gift: `Hi ${name}, a special gift from ${shop.name}: ${coupon.discount_percent}% off on your next visit.`,
  }[coupon.kind];
  const lines = [
    intro,
    '',
    `Coupon code: ${coupon.code}`,
    `Valid till: ${until}`,
    `Your card: ${cardUrl(baseUrl, customer.card_token)}`,
  ];
  if (coupon.kind !== 'gift') lines.push('', 'To stop offers, open your card and turn off WhatsApp offers.');
  return whatsappLink(sendTo(shop, customer), lines.join('\n'));
}

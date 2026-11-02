// Rewards screen: the shopkeeper designs their loyalty program here.
import { api } from '../api.js';
import { startPage } from '../layout.js';
import { $, formError, html, icon, ordinal, toast, toastError } from '../ui.js';

const { me, page } = await startPage('rewards', 'Rewards');
const data = await api.get('/program');
const normalize = (p) => ({
  settings: { ...p.settings, stamp_reward: p.settings.stamp_reward ?? '' },
  tiers: p.tiers.map(({ name, min_visits, discount_percent }) => ({ name, min_visits, discount_percent })),
});
let program = normalize(data);
let saved = JSON.stringify(program);

const welcome = new URLSearchParams(location.search).get('welcome');

page.innerHTML = html`
  <div class="page-head">
    <div><h1>Rewards</h1><p>Decide what customers get for coming back again and again.</p></div>
    <div class="actions">
      <label class="sr-only" for="template">Start from a template</label>
      <select class="input" id="template" style="width:auto">
        <option value="">Start from a template</option>
        ${data.templates.map((t) => html`<option value="${t.key}">${t.label}</option>`)}
      </select>
    </div>
  </div>
  ${welcome ? html`<div class="callout" style="margin-bottom:18px"><span><strong>Your shop is ready.</strong> We set up a reward program for your type of shop. Check it below and change anything you like.</span>
    <a class="btn btn-primary btn-sm" href="/app/counter">Go to counter</a></div>` : ''}
  <div class="rewards-grid">
    <form id="program" class="stack" novalidate>
      <section class="panel">
        <h2>Levels</h2>
        <p class="section-help">The more often a customer visits, the higher their level and the bigger their discount. The first level starts at visit 1.</p>
        <div class="tier-head" aria-hidden="true"><span>Level name</span><span>From visit</span><span>Discount</span><span></span></div>
        <div id="tiers"></div>
        <button type="button" class="btn btn-sm" id="add-tier">${icon('plus', 'icon icon-sm')} Add level</button>
      </section>

      <section class="panel">
        <div class="switch-row">
          <div><h2>Comeback offer</h2>
            <p class="section-help">After every visit the customer gets a discount if they come back soon, like the mall coupon "come back within 30 days". It is used only when it is bigger than their level discount.</p></div>
          <label class="switch"><input type="checkbox" name="comeback_enabled" aria-label="Comeback offer on"><span></span></label>
        </div>
        <div class="inline-fields" data-when="comeback_enabled">
          <label class="field"><span>Discount</span><div class="input-suffix"><input class="input" name="comeback_percent" type="number" min="1" max="90"><span>%</span></div></label>
          <label class="field"><span>If they come back within</span><div class="input-suffix"><input class="input" name="comeback_days" type="number" min="1" max="365"><span>days</span></div></label>
        </div>
      </section>

      <section class="panel">
        <div class="switch-row">
          <div><h2>Stamp card</h2>
            <p class="section-help">One stamp per visit. A full card gets a free item, on top of the discount.</p></div>
          <label class="switch"><input type="checkbox" name="stamp_enabled" aria-label="Stamp card on"><span></span></label>
        </div>
        <div class="stack-sm" data-when="stamp_enabled">
          <div class="inline-fields stamp-fields">
            <label class="field"><span>Stamps for a reward</span><input class="input" name="stamp_every" type="number" min="2" max="50"></label>
            <label class="field"><span>Free reward</span><input class="input" name="stamp_reward" maxlength="40" placeholder="Free chai"></label>
          </div>
          <label class="check"><input type="checkbox" name="welcome_stamp"> <span>Give the first stamp free when someone gets a card <span class="muted">(people finish a card faster when it is already started)</span></span></label>
        </div>
      </section>

      <section class="panel" id="offers">
        <h2>Win-back and birthday offers</h2>
        <p class="section-help">Coupons you send from the Bring back screen. Only customers who agreed to WhatsApp offers get them.</p>
        <div class="inline-fields">
          <label class="field"><span>A customer has stopped coming after</span><div class="input-suffix"><input class="input" name="inactive_after_days" type="number" min="7" max="365"><span>days</span></div></label>
          <label class="field"><span>Win-back discount</span><div class="input-suffix"><input class="input" name="winback_percent" type="number" min="1" max="90"><span>%</span></div></label>
          <label class="field"><span>Win-back coupon valid for</span><div class="input-suffix"><input class="input" name="winback_days" type="number" min="1" max="90"><span>days</span></div></label>
          <label class="field"><span>Birthday discount</span><div class="input-suffix"><input class="input" name="birthday_percent" type="number" min="1" max="90"><span>%</span></div></label>
        </div>
      </section>

      <section class="panel">
        <h2>Rules that stop misuse</h2>
        <p class="section-help">So that discounts help your sales instead of eating your profit.</p>
        <div class="stack">
          <div class="inline-fields">
            <label class="field"><span>Smallest bill that counts as a visit</span><div class="input-prefix"><span class="prefix">₹</span><input class="input" name="min_bill_for_visit" type="number" min="0"></div>
              <span class="hint">Smaller bills get no visit and no discount.</span></label>
            <label class="field"><span>Biggest discount on one bill</span><div class="input-prefix"><span class="prefix">₹</span><input class="input" name="max_discount_per_visit" type="number" min="1" placeholder="No limit"></div>
              <span class="hint">Leave empty for no limit.</span></label>
          </div>
          <label class="check"><input type="checkbox" name="one_visit_per_day"> <span>Count only one visit per day <span class="muted">(stops one bill being split into many visits)</span></span></label>
        </div>
      </section>
    </form>

    <aside class="journey-preview panel" aria-live="polite">
      <h2>What a customer gets</h2>
      <p class="section-help">If they keep coming back within the comeback window:</p>
      <div id="preview"></div>
    </aside>
  </div>
  <div class="save-bar" id="save-bar" hidden>
    <span>You have unsaved changes.</span>
    <div class="row">
      <button type="button" class="btn btn-ghost" id="discard">Undo changes</button>
      <button type="button" class="btn btn-primary" id="save">${icon('check')} Save rewards</button>
    </div>
  </div>`;

const form = $('#program');

// ------------------------------------------------------------ fill & read

function fillForm() {
  const s = program.settings;
  for (const el of form.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox') el.checked = !!s[el.name];
    else el.value = s[el.name] ?? '';
  }
  renderTiers();
  toggleSections();
}

function renderTiers() {
  $('#tiers').innerHTML = html`${program.tiers.map((t, i) => html`
    <div class="tier-row" data-i="${i}">
      <input class="input" data-k="name" value="${t.name}" maxlength="24" aria-label="Level ${i + 1} name">
      <div class="input-prefix"><span class="prefix">#</span><input class="input" data-k="min_visits" type="number" min="1" value="${t.min_visits}" ${i === 0 ? html`readonly` : ''} aria-label="Level ${i + 1} starts at visit"></div>
      <div class="input-suffix"><input class="input" data-k="discount_percent" type="number" min="0" max="90" value="${t.discount_percent}" aria-label="Level ${i + 1} discount percent"><span>%</span></div>
      ${i === 0 ? html`<span></span>` : html`<button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove level ${t.name}">${icon('trash', 'icon icon-sm')}</button>`}
    </div>`)}`;
  $('#add-tier').disabled = program.tiers.length >= 8;
}

function readForm() {
  const s = program.settings;
  for (const el of form.elements) {
    if (!el.name || !(el.name in s)) continue;
    if (el.type === 'checkbox') s[el.name] = el.checked ? 1 : 0;
    else if (el.name === 'stamp_reward') s[el.name] = el.value;
    else if (el.name === 'max_discount_per_visit') s[el.name] = el.value === '' ? null : Number(el.value);
    else s[el.name] = el.value === '' ? '' : Number(el.value);
  }
}

function toggleSections() {
  form.querySelectorAll('[data-when]').forEach((el) => {
    el.classList.toggle('is-off', !program.settings[el.dataset.when]);
    el.querySelectorAll('input').forEach((i) => { i.disabled = !program.settings[el.dataset.when]; });
  });
}

// ------------------------------------------------------------ live preview

function levelFor(tiers, n) {
  const sorted = [...tiers].sort((a, b) => a.min_visits - b.min_visits);
  let level = sorted[0];
  for (const t of sorted) if (Number(t.min_visits) <= n) level = t;
  return level;
}

function renderPreview() {
  const s = program.settings;
  const tiers = program.tiers.filter((t) => t.name && t.min_visits > 0);
  if (!tiers.length) { $('#preview').innerHTML = ''; return; }
  const lastLevelAt = Math.max(...tiers.map((t) => Number(t.min_visits)));
  const shown = Math.min(Math.max(lastLevelAt + 1, s.stamp_enabled ? Number(s.stamp_every) : 0, 6), 14);
  const rows = [];
  for (let n = 1; n <= shown; n++) {
    const level = levelFor(tiers, n);
    const levelPct = Number(level.discount_percent) || 0;
    const comeback = s.comeback_enabled && n > 1 ? Number(s.comeback_percent) || 0 : 0;
    const best = Math.max(levelPct, comeback);
    const why = best === 0 ? 'No discount' : comeback > levelPct ? 'comeback offer' : `${level.name} level`;
    const stamps = s.stamp_enabled ? n + (s.welcome_stamp ? 1 : 0) : 0;
    const free = s.stamp_enabled && Number(s.stamp_every) > 1 && stamps % Number(s.stamp_every) === 0;
    rows.push(html`<li class="${Number(level.min_visits) === n && n > 1 ? 'level-up' : ''}">
      <span class="pv-visit">${ordinal(n)} visit</span>
      <span class="pv-off">${best ? html`<strong>${best}% off</strong> <span class="muted">${why}</span>` : html`<span class="muted">${why}${n === 1 ? ', gets the card' : ''}</span>`}
        ${free ? html`<span class="badge warn">${s.stamp_reward || 'Free reward'}</span>` : ''}</span>
    </li>`);
  }
  $('#preview').innerHTML = html`<ol class="preview-list">${rows}</ol>
    ${s.min_bill_for_visit > 0 ? html`<p class="small muted" style="margin-top:12px">Bills under ₹${s.min_bill_for_visit} do not count.</p>` : ''}`;
}

// ------------------------------------------------------------ events

function changed() {
  readForm();
  toggleSections();
  renderPreview();
  $('#save-bar').hidden = JSON.stringify(program) === saved;
}

form.addEventListener('input', (e) => {
  const row = e.target.closest('.tier-row');
  if (row) {
    const t = program.tiers[Number(row.dataset.i)];
    const k = e.target.dataset.k;
    t[k] = k === 'name' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value);
  }
  changed();
});
form.addEventListener('change', changed);

$('#tiers').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  program.tiers.splice(Number(btn.dataset.remove), 1);
  renderTiers();
  changed();
});

$('#add-tier').addEventListener('click', () => {
  const last = program.tiers[program.tiers.length - 1];
  program.tiers.push({
    name: '',
    min_visits: (Number(last?.min_visits) || 1) + 3,
    discount_percent: Math.min((Number(last?.discount_percent) || 0) + 5, 90),
  });
  renderTiers();
  changed();
  $(`.tier-row[data-i="${program.tiers.length - 1}"] input`).focus();
});

$('#template').addEventListener('change', (e) => {
  const t = data.templates.find((x) => x.key === e.target.value);
  if (!t) return;
  program.settings = { ...program.settings, ...t.settings };
  program.tiers = structuredClone(t.tiers);
  fillForm();
  changed();
  toast(`${t.label} template filled in. Press Save rewards to use it.`);
  e.target.value = '';
});

$('#discard').addEventListener('click', () => {
  program = JSON.parse(saved);
  formError(form, null);
  fillForm();
  changed();
});

$('#save').addEventListener('click', async () => {
  formError(form, null);
  const button = $('#save');
  button.disabled = true;
  try {
    const result = await api.put('/program', { ...program.settings, tiers: program.tiers });
    program = normalize(result);
    saved = JSON.stringify(program);
    me.program = result;
    fillForm();
    changed();
    toast('Rewards saved. New bills use them from now on.');
  } catch (err) {
    formError(form, err.message);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toastError(err);
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('beforeunload', (e) => {
  if (JSON.stringify(program) !== saved) e.preventDefault();
});

fillForm();
renderPreview();
if (location.hash === '#offers') $('#offers').scrollIntoView();

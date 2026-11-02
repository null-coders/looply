// Customer form fields shared by the counter (new card) and the customer page (edit).
import { html } from './ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function customerFields(c = {}, { notes = false } = {}) {
  const [bm, bd] = c.birthday ? c.birthday.split('-').map(Number) : [0, 0];
  return html`
    <label class="field"><span>Name</span>
      <input class="input" name="name" value="${c.name || ''}" required maxlength="60" autocomplete="off"></label>
    <label class="field"><span>Mobile number</span>
      <input class="input" name="phone" value="${c.phone || ''}" inputmode="tel" required autocomplete="off" placeholder="98765 43210"></label>
    <fieldset class="field" style="border:0;padding:0;margin:0">
      <legend class="strong" style="margin-bottom:6px">Birthday <span class="hint">(optional, for a birthday offer)</span></legend>
      <div class="bday-grid">
        <select class="input" name="bday" aria-label="Birthday day">
          <option value="">Day</option>
          ${Array.from({ length: 31 }, (_, i) => html`<option value="${i + 1}" ${bd === i + 1 ? html`selected` : ''}>${i + 1}</option>`)}
        </select>
        <select class="input" name="bmonth" aria-label="Birthday month">
          <option value="">Month</option>
          ${MONTHS.map((m, i) => html`<option value="${i + 1}" ${bm === i + 1 ? html`selected` : ''}>${m}</option>`)}
        </select>
      </div>
    </fieldset>
    ${notes ? html`<label class="field"><span>Notes <span class="hint">(only you can see these)</span></span>
      <textarea class="input" name="notes" maxlength="300">${c.notes || ''}</textarea></label>` : ''}
    <label class="check">
      <input type="checkbox" name="consent" ${c.consent ? html`checked` : ''}>
      <span>Customer agrees to get offers from this shop on WhatsApp. <span class="muted">Ask them first. They can turn this off from their card.</span></span>
    </label>`;
}

export function readCustomerForm(form) {
  // form.elements.namedItem() is used because form.name would be the form's own name.
  const field = (n) => form.elements.namedItem(n);
  const day = field('bday').value;
  const month = field('bmonth').value;
  if ((day && !month) || (!day && month)) throw new Error('Choose both day and month for the birthday, or leave both empty.');
  return {
    name: field('name').value,
    phone: field('phone').value,
    birthday: day && month ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '',
    consent: field('consent').checked,
    notes: field('notes') ? field('notes').value : undefined,
  };
}

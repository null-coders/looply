// A tiny bar chart made with SVG (no chart library needed).
// Bars are stacked from the baseline; the top segment gets rounded ends.
// Hover or keyboard focus on a bar shows a tooltip with every value.
import { rupeesShort } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** A round step for the grid lines, e.g. 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw) {
  const exp = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= raw) return m * exp;
  return 10 * exp;
}

/** Path for a bar with rounded top corners (radius r) and a square bottom. */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * @param data   [{ label, title, segments: [{ name, value, className, text }] }]
 * @param opts   { height, format(value)->string, labelEvery, highlightLast, ariaLabel }
 */
export function barChart(data, opts = {}) {
  const width = Math.max(opts.width || 720, 280); // draw at the real size, so text is not scaled
  const height = opts.height || 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 48 };
  const format = opts.format || rupeesShort;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const totals = data.map((d) => d.segments.reduce((s, x) => s + x.value, 0));
  const top = Math.max(...totals, 0) || 400000;
  const step = niceStep(top / 4);
  const max = step * Math.max(1, Math.ceil(top / step));
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.max(Math.min(slot - 2, 34), 2); // 2px gap between bars at least
  const scale = (v) => (v / max) * innerH;
  const labelEvery = Math.max(opts.labelEvery || 1, Math.ceil(data.length / Math.max(Math.floor(innerW / 62), 1)));
  const focusable = data.length <= 31;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    role: 'img',
    'aria-label': opts.ariaLabel || 'Bar chart',
  });

  // Grid lines + y labels (recessive)
  for (let v = 0; v <= max + 1; v += step) {
    const y = pad.top + innerH - scale(v);
    svg.append(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: 'grid' }));
    const t = svgEl('text', { x: pad.left - 8, y: y + 4, 'text-anchor': 'end' });
    t.textContent = format(v);
    svg.append(t);
  }

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  data.forEach((d, i) => {
    const x = pad.left + i * slot + (slot - barW) / 2;
    const g = svgEl('g', { class: 'bar-group' });
    if (focusable) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${d.title}: ${d.segments.map((s) => `${s.name} ${s.text ?? format(s.value)}`).join(', ')}`);
    }
    // invisible hit area covering the whole column
    g.append(svgEl('rect', { x: pad.left + i * slot, y: pad.top, width: slot, height: innerH, fill: 'transparent' }));
    let base = pad.top + innerH;
    const visible = d.segments.filter((s) => s.value > 0);
    visible.forEach((s, si) => {
      const h = scale(s.value);
      const isTop = si === visible.length - 1;
      const gap = si > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const y = base - h;
      const path = svgEl('path', {
        d: isTop ? barPath(x, y + gap, barW, Math.max(h - gap, 0), 4) : `M${x},${base}V${y + gap}H${x + barW}V${base}Z`,
        class: s.className || 'bar',
      });
      if (opts.highlightLast && i !== data.length - 1) path.setAttribute('opacity', '0.55');
      g.append(path);
      base = y;
    });
    // Labels counted from the right, so the latest bar always has one.
    if ((data.length - 1 - i) % labelEvery === 0) {
      const t = svgEl('text', { x: x + barW / 2, y: height - 6, 'text-anchor': 'middle' });
      t.textContent = d.label;
      svg.append(t);
    }

    const show = () => {
      tip.replaceChildren();
      const title = document.createElement('div');
      title.className = 'tip-title';
      title.textContent = d.title;
      tip.append(title);
      for (const s of d.segments) {
        const row = document.createElement('div');
        row.className = 'tip-row';
        const key = document.createElement('i');
        key.className = `key ${s.className || 'bar'}`;
        const value = document.createElement('strong');
        value.textContent = s.text ?? format(s.value);
        const name = document.createElement('span');
        name.textContent = s.name;
        row.append(key, value, name);
        tip.append(row);
      }
      tip.hidden = false;
      const rect = svg.getBoundingClientRect();
      const px = ((x + barW / 2) / width) * rect.width;
      const left = Math.min(Math.max(px - tip.offsetWidth / 2, 0), rect.width - tip.offsetWidth);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(((base - 8) / height) * rect.height - tip.offsetHeight, 0)}px`;
      g.classList.add('active');
    };
    const hide = () => {
      tip.hidden = true;
      g.classList.remove('active');
    };
    g.addEventListener('pointerenter', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', show);
    g.addEventListener('blur', hide);
    svg.append(g);
  });

  // baseline
  svg.append(svgEl('line', {
    x1: pad.left, x2: width - pad.right, y1: pad.top + innerH, y2: pad.top + innerH, stroke: '#c9cddc',
  }));

  wrap.append(svg, tip);
  return wrap;
}

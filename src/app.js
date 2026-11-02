// The Express app. Used by server.js on your computer and by the Netlify
// function online (netlify/functions/api.js).
import './timezone.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { api } from './routes.js';
import { HttpError } from './utils.js';
import { explainDatabaseError } from './db.js';

// Netlify sends requests to the function as /.netlify/functions/api/...
// or as the original /api/..., so the API answers on both.
const API_PATHS = ['/api', '/.netlify/functions/api'];

// Only files from this site may run or load. Stops injected scripts (XSS).
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

/**
 * @param {object} options
 * @param {boolean} options.servePages  serve the HTML/CSS/JS files too (on your computer).
 *                                      Online, Netlify serves those files itself.
 */
export function createApp({ servePages = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Netlify's proxy: trust it, so https and the visitor's IP are seen correctly.
  if (!servePages || process.env.TRUST_PROXY) app.set('trust proxy', true);
  app.use(express.json({ limit: '100kb' }));

  // Basic security headers
  // (Online, Netlify adds the same headers to the pages, see netlify.toml.)
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': CSP,
    });
    next();
  });

  // Requests that change data must send JSON. A normal HTML form on another
  // website cannot do that, which protects shopkeepers from fake requests (CSRF).
  app.use(API_PATHS, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Requests must be sent as JSON.' });
    }
    next();
  });
  app.use(API_PATHS, api);
  app.use(API_PATHS, (req, res) => res.status(404).json({ error: 'Unknown API address.' }));

  if (servePages) {
    // Worked out here (not at the top) because the online function has no public/ folder.
    const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
    app.use(express.static(PUBLIC, { extensions: ['html'] }));
    app.get('/card/:token', (req, res) => res.sendFile(path.join(PUBLIC, 'card.html')));
    app.get('/join/:slug', (req, res) => res.sendFile(path.join(PUBLIC, 'join.html')));
    app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));
  }

  // One place that turns errors into friendly JSON messages
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request was not valid JSON.' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'The request is too big.' });
    }
    console.error(err);
    const setupHint = explainDatabaseError(err);
    if (setupHint) {
      return res.status(503).json({
        error: 'Looply cannot reach its database right now.',
        setupHint, // what the site owner should fix (no secrets inside)
      });
    }
    res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}

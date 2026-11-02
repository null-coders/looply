// The Looply API as a Netlify Function. Netlify serves the pages from
// public/ and sends every /api/... request here (see netlify.toml).
import serverless from 'serverless-http';
import { createApp } from '../../src/app.js';

export const handler = serverless(createApp({ servePages: false }));

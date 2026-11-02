// Talks to the server. Every call returns the JSON data or throws an Error
// with a message that can be shown to the user directly.

async function request(method, path, body) {
  const options = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('Cannot reach the Looply server. Check that it is running and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/auth') && !path.startsWith('/public')) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?next=${next}`;
    return new Promise(() => {}); // page is leaving
  }
  if (!response.ok) {
    // setupHint: what the site owner must fix (for example a missing database setting)
    const error = new Error([data.error || `Request failed (${response.status}).`, data.setupHint].filter(Boolean).join(' '));
    Object.assign(error, data, { status: response.status });
    throw error;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
};

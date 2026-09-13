import { safeErrorString } from '../../utils/safeString.js';

/**
 * Shared JSON parse for OrangeHRM token responses (errors may be objects).
 */
export async function parseTokenResponse(res) {
  const text = await res.text();
  let tr = {};
  try {
    tr = text ? JSON.parse(text) : {};
  } catch {
    tr = { raw: text };
  }
  const raw = tr.error_description ?? tr.error ?? tr.message ?? text ?? res.statusText;
  return { tr, errText: safeErrorString(raw) };
}

/**
 * Refresh OAuth access token (OrangeHRM / League OAuth2 style).
 */
export async function refreshHrmsAccessToken({ tokenUrl, clientId, clientSecret, refreshToken }) {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken),
    client_id: clientId,
    client_secret: clientSecret,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const attempts = [
    {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form,
      },
    },
    {
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: String(refreshToken),
        }),
      },
    },
  ];

  let lastErr = 'Token refresh failed';
  for (const { init } of attempts) {
    const r = await fetch(tokenUrl, init);
    const { tr, errText } = await parseTokenResponse(r);
    if (r.ok && tr.access_token) {
      return { ok: true, tr, errText: '' };
    }
    lastErr = errText || lastErr;
  }
  return { ok: false, tr: {}, errText: safeErrorString(lastErr) };
}

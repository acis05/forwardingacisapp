import crypto from 'crypto';
import axios from 'axios';
import { pool } from './db.js';

const ACCOUNT_BASE = 'https://account.accurate.id';
const AUTHORIZE_URL = `${ACCOUNT_BASE}/oauth/authorize`;
const TOKEN_URL = `${ACCOUNT_BASE}/oauth/token`;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} belum diisi di environment.`);
  return value;
}

function basicAuth() {
  return Buffer.from(`${required('ACCURATE_CLIENT_ID')}:${required('ACCURATE_CLIENT_SECRET')}`).toString('base64');
}

export function oauthConfig() {
  return {
    clientId: required('ACCURATE_CLIENT_ID'),
    redirectUri: required('ACCURATE_REDIRECT_URI'),
    scope: process.env.ACCURATE_OAUTH_SCOPE || 'sales_order_save'
  };
}

export async function createAuthorizationUrl() {
  const { clientId, redirectUri, scope } = oauthConfig();
  const state = crypto.randomBytes(32).toString('hex');
  await pool.query('DELETE FROM oauth_states WHERE expires_at < NOW() OR used_at IS NOT NULL');
  await pool.query(
    `INSERT INTO oauth_states(state, expires_at) VALUES ($1, NOW() + INTERVAL '10 minutes')`,
    [state]
  );

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

async function consumeState(state) {
  if (!state) return false;
  const r = await pool.query(
    `UPDATE oauth_states SET used_at=NOW()
     WHERE state=$1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING state`,
    [state]
  );
  return Boolean(r.rows[0]);
}

async function tokenRequest(form) {
  const res = await axios.post(TOKEN_URL, new URLSearchParams(form), {
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    validateStatus: () => true
  });
  if (res.status >= 400 || !res.data?.access_token) {
    throw new Error(`OAuth Accurate gagal (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function saveToken(data) {
  const expiresIn = Number(data.expires_in || 0);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  await pool.query(
    `INSERT INTO accurate_oauth(id, access_token, refresh_token, token_type, scope, expires_at, user_json, updated_at)
     VALUES (1,$1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (id) DO UPDATE SET
       access_token=EXCLUDED.access_token,
       refresh_token=COALESCE(EXCLUDED.refresh_token, accurate_oauth.refresh_token),
       token_type=EXCLUDED.token_type,
       scope=EXCLUDED.scope,
       expires_at=EXCLUDED.expires_at,
       user_json=EXCLUDED.user_json,
       updated_at=NOW()`,
    [data.access_token, data.refresh_token || null, data.token_type || 'bearer', data.scope || null, expiresAt, data.user || null]
  );
}

export async function exchangeAuthorizationCode(code, state) {
  if (!await consumeState(state)) throw new Error('OAuth state tidak valid atau sudah kedaluwarsa. Ulangi Connect Accurate.');
  const { redirectUri } = oauthConfig();
  const data = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
  await saveToken(data);
  return data;
}

export async function getOAuthRow() {
  const r = await pool.query('SELECT * FROM accurate_oauth WHERE id=1');
  return r.rows[0] || null;
}

export async function refreshAccessToken(refreshToken) {
  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  await saveToken(data);
  return data.access_token;
}

export async function getAccessToken() {
  const row = await getOAuthRow();
  if (!row?.access_token) throw new Error('Accurate belum terhubung. Klik Connect Accurate terlebih dahulu.');

  // Accurate recommends refreshing at expiry or at least one day before expiry.
  const refreshAt = row.expires_at ? new Date(row.expires_at).getTime() - 24 * 60 * 60 * 1000 : Infinity;
  if (Date.now() >= refreshAt) {
    if (!row.refresh_token) throw new Error('Access Token Accurate perlu diperbarui. Klik Reconnect Accurate.');
    return refreshAccessToken(row.refresh_token);
  }
  return row.access_token;
}

export async function oauthStatus() {
  const row = await getOAuthRow();
  if (!row?.access_token) return { connected: false };
  const user = row.user_json || {};
  return {
    connected: true,
    scope: row.scope,
    expiresAt: row.expires_at,
    user: { name: user.name || null, email: user.email || user.nickname || null }
  };
}

export async function disconnectOAuth() {
  await pool.query('DELETE FROM accurate_oauth WHERE id=1');
}

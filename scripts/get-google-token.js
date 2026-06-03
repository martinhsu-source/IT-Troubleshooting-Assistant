#!/usr/bin/env node
/**
 * One-time script to obtain a Google OAuth refresh token.
 * Uses only Node.js built-ins + fetch — no google-auth-library needed.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com → APIs & Services → Credentials
 *   2. Ensure an OAuth 2.0 Client ID (Web application type) exists
 *   3. Add http://localhost:3000 as an Authorized Redirect URI
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *
 * Run:
 *   node scripts/get-google-token.js
 */

import http from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const lines = readFileSync(resolve(__dirname, '..', '.env'), 'utf8').split('\n');
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      process.env[key] = val;
    }
  } catch { /* .env not found */ }
}

loadEnv();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3000';
const SCOPE         = 'https://www.googleapis.com/auth/spreadsheets.readonly';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env\n');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n─────────────────────────────────────────────────');
console.log('  Google OAuth Token Setup');
console.log('─────────────────────────────────────────────────');
console.log('\n1. Open this URL in your browser (sign in with your company account):\n');
console.log('   ' + authUrl.toString());
console.log('\n2. After authorizing, you will be redirected to localhost:3000');
console.log('   (the page may look broken — that is OK)');
console.log('\n3. Waiting for callback on http://localhost:3000 ...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.end('<h2>No authorization code. Please try again.</h2>');
    return;
  }

  res.end(`
    <html><body style="font-family:sans-serif;padding:40px">
      <h2>✅ Authorization successful!</h2>
      <p>You can close this tab and check the terminal.</p>
    </body></html>
  `);

  server.close();

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const data = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error('❌ Token exchange failed:', data.error, '—', data.error_description);
      process.exit(1);
    }

    if (!data.refresh_token) {
      console.log('\n⚠️  No refresh_token in response.');
      console.log('   This can happen if the account already granted access before.');
      console.log('   To force a new token:');
      console.log('   1. Go to https://myaccount.google.com/permissions');
      console.log('   2. Remove access for your OAuth app, then re-run this script.\n');
      process.exit(1);
    }

    console.log('─────────────────────────────────────────────────');
    console.log('  ✅  Refresh token obtained!');
    console.log('─────────────────────────────────────────────────\n');
    console.log('Add this to your .env file:\n');
    console.log('  GOOGLE_REFRESH_TOKEN=' + data.refresh_token);
    console.log('\nAlso update Vercel Environment Variables:');
    console.log('  Key:   GOOGLE_REFRESH_TOKEN');
    console.log('  Value: ' + data.refresh_token);
    console.log('\n─────────────────────────────────────────────────\n');
  } catch (err) {
    console.error('❌ Unexpected error:', err.message);
  }

  process.exit(0);
}).listen(3000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('❌  Port 3000 is already in use. Stop any dev server first, then re-run.');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

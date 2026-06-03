#!/usr/bin/env node
/**
 * One-time script to obtain Google OAuth refresh token.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com → APIs & Services → Credentials
 *   2. Create an OAuth 2.0 Client ID (type: Web application)
 *   3. Add redirect URI: http://localhost:3000
 *   4. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file
 *
 * Run:
 *   node scripts/get-google-token.js
 *
 * Then open the URL shown, authorize with your company Google account,
 * and the refresh token will be printed to the console.
 */

import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { parse } from 'url';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency needed)
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) {
        process.env[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
      }
    }
  } catch {
    // .env not found, rely on existing env vars
  }
}

loadEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env\n');
  process.exit(1);
}

const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  prompt: 'consent', // forces refresh_token to be returned
});

console.log('\n─────────────────────────────────────────────────');
console.log('  Google OAuth Token Setup');
console.log('─────────────────────────────────────────────────');
console.log('\n1. Open this URL in your browser (sign in with your company account):\n');
console.log('   ' + authUrl);
console.log('\n2. After authorizing, you will be redirected to localhost:3000');
console.log('   (the page may look broken — that is OK)');
console.log('\n3. Waiting for callback on http://localhost:3000 ...\n');

const server = http.createServer(async (req, res) => {
  const { query } = parse(req.url, true);

  if (!query.code) {
    res.end('<h2>No code found. Try again.</h2>');
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
    const { tokens } = await client.getToken(query.code);
    if (!tokens.refresh_token) {
      console.log('⚠️  No refresh_token returned. This can happen if the account was');
      console.log('   already authorized before. To force a new token:');
      console.log('   1. Go to https://myaccount.google.com/permissions');
      console.log('   2. Remove access for your app, then run this script again.\n');
      process.exit(1);
    }

    console.log('─────────────────────────────────────────────────');
    console.log('  ✅  Refresh token obtained!');
    console.log('─────────────────────────────────────────────────\n');
    console.log('Add this line to your .env file:\n');
    console.log('  GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\nAlso add it to Vercel Environment Variables:\n');
    console.log('  Key:   GOOGLE_REFRESH_TOKEN');
    console.log('  Value: ' + tokens.refresh_token);
    console.log('\n─────────────────────────────────────────────────\n');
  } catch (err) {
    console.error('❌ Token exchange failed:', err.message);
  }

  process.exit(0);
}).listen(3000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('❌  Port 3000 is already in use. Stop the dev server first, then re-run this script.');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

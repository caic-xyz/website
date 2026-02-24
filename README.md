# Website

Cloudflare Workers project converted to `pnpm`.

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm run dev` | Start local development server |
| `pnpm run deploy` | Deploy to Cloudflare |
| `pnpm exec wrangler types` | Generate TypeScript types (run after changing bindings) |

## Secrets

The `/admin/waitlist` route is protected by Google OAuth. Before deploying, configure these secrets:

| Secret | Description |
|--------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `SESSION_SECRET` | Random string (32+ chars) used to sign session cookies |
| `ALLOWED_EMAILS` | Comma-separated list of Google emails permitted to access the admin page |

Set each secret with:

```sh
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put ALLOWED_EMAILS
```

The Google OAuth client must have `https://<your-domain>/auth/callback` as an authorized redirect URI.

## Project Structure

- `public/index.html`: Static assets.
- `wrangler.jsonc`: Cloudflare Workers configuration.

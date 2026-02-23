# Website

Cloudflare Workers project converted to `pnpm`.

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install dependencies |
| `pnpm run dev` | Start local development server |
| `pnpm run deploy` | Deploy to Cloudflare |
| `pnpm exec wrangler types` | Generate TypeScript types (run after changing bindings) |

## Project Structure

- `public/index.html`: Static assets.
- `wrangler.jsonc`: Cloudflare Workers configuration.

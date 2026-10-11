# Family Tree

A password-protected family tree. Add people, connect parents, partners and children, and store personal details and a photo for each person. Light and dark mode included.

- **`web/`**: the page, hosted on GitHub Pages. Uses [family-chart](https://github.com/donatso/family-chart) to draw the tree.
- **`worker/`**: a small Cloudflare Worker API that checks the password and reads/writes the `familytreedb` D1 database.

The password only lives on Cloudflare as a secret. It never appears in this (public) repository.

## Run locally

```bash
npm install
npm run db:migrate:local
```

Create `.dev.vars` (it is git-ignored) with:

```
APP_PASSWORD='your password'
ALLOWED_ORIGINS=http://localhost:5500
```

Then start both servers in separate terminals and open http://localhost:5500:

```bash
npm run dev:api
npm run dev:web
```

## Deploy

1. Log in to the Cloudflare account that owns `familytreedb`: `npx wrangler login`
2. Create the table in the real database: `npm run db:migrate:remote`
3. Store the password as a secret: `npx wrangler secret put APP_PASSWORD`
4. Deploy the API: `npm run deploy:api`. Copy the `https://family-tree-api.<something>.workers.dev` URL it prints into `web/config.js`.
5. Commit and push to `main`.
6. On GitHub, under **Settings → Pages**, set **Source** to **GitHub Actions** (one time only). The workflow in `.github/workflows/pages.yml` publishes `web/` to https://richnak2.github.io/family-tree/.

To change the password later, run step 3 again. Everyone gets logged out.

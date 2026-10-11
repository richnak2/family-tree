// Address of the Cloudflare Worker API (see README).
// The workers.dev URL is the one `npm run deploy:api` prints.
// If you use a custom domain instead, also add it to connect-src in index.html.
window.FAMILY_TREE_CONFIG = {
  apiBase: ['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:8787'
    : 'https://family-tree-api.richnak-ondrej.workers.dev',
};

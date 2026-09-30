# Prospect Radar

Mobile lead finder on Cloudflare Workers. `src/` holds the source; `python3 build.py` bundles it into `worker.js`, which Cloudflare deploys (`npx wrangler deploy`) on every push to `main`.

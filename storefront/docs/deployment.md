# GitHub and Vercel deployment

Repository: https://github.com/ArijitChowdhury-Algolia/jewellerytv. Vercel project: algolia/jewellerytv. Production alias: jewellerytv.vercel.app.

## Project configuration

- Root directory: storefront
- Framework: Vite
- Node runtime:24.x
- Install: npm ci
- Build: npm run build
- Static output: dist
- Node function: api/[...path].ts, maximum duration180 seconds
- SPA rewrites preserve direct category, product and search links.
- Vercel Authentication: All Deployments. Protects the production alias and generated deployment URLs. Host/Origin validation is an additional boundary, not authentication.

## Server environment

Set ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY and APP_ALLOWED_HOSTS in Production and Preview. APP_ALLOWED_HOSTS includes jewellerytv.vercel.app. The function also trusts the exact Vercel-provided deployment and production hostnames. It does not trust arbitrary forwarded-host values.

Set BRIEF_V2_ENABLED=true and JTV_BRIEF_AGENT_ID together to enable the published brief interpreter. When enabled, interpreter failures stop the affected turn with a recoverable retry; they do not silently skip preference updates. JTV_CONCIERGE_AGENT_ID optionally routes to an isolated published concierge candidate for validation. Omit it to use the existing main agent. No raw agent snapshot belongs in the deployment.

Rollback: redeploy the previous protected deployment and restore its environment values. Disabling BRIEF_V2_ENABLED restores the legacy API route but also removes automatic same-turn brief enforcement; do not present that mode as equivalent. Preserve per-tab saved state and private evaluation evidence.

Never expose credentials in VITE variables, commit .env files, or upload local research/evidence. The application uses process.env in the cloud. Local startup retains its parent .env.local fallback.

## Release checks

Run npm ci, npm run typecheck, npm test and npm run build from a clean source export. The build compiles the server with NodeNext resolution and imports the emitted entry point in native Node, catching extensionless ESM imports and missing JSON import attributes before deployment. Scan the outgoing tree/history for secrets. Verify GitHub Actions against the pushed commit. Then deploy and verify:

1. Unauthenticated access to production and generated deployment URLs is protected.
2. Authenticated /api/health succeeds.
3. Catalogue queries, exact product URLs and facets work.
4. Chat streams a real response and product cards navigate locally.
5. No API key is present in browser requests or the built frontend.

No deployment step writes to the production catalogue or changes the main concierge configuration. Runtime conversations can update the provider's usage/history according to its existing settings.

Rollback through Vercel's previous deployment controls. Never rewrite Git history as deployment cleanup.

## Diagram rendering

The architecture SVG is self-contained, uses standard Arial/Helvetica fonts and no external assets. No PNG fallback is needed for GitHub's SVG rendering. The README image and hosted workflow are checked after publication.

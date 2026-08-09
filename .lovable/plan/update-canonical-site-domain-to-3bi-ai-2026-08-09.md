Update canonical site domain to 3bi.ai

The project's official domain is now `3bi.ai`. Replace all hardcoded `agent-relay-console.lovable.app` references with `https://3bi.ai` so SEO, docs, and crawler directives stay consistent.

Scope

1. `src/lib/site.ts`
   - Change `SITE_URL` from `https://agent-relay-console.lovable.app` to `https://3bi.ai`.
   - Keep `SITE_NAME` as `Agent Relay Console` unless instructed otherwise.
   - This automatically updates `og:image`, `og:url`, canonical links, and JSON-LD across every public page.

2. `src/routes/sitemap[.]xml.ts`
   - Change `BASE_URL` to `https://3bi.ai`.
   - Sitemap entries remain `/`, `/docs`, `/pricing`, `/terms`, `/refunds`, `/privacy`.

3. `public/robots.txt`
   - Update `Sitemap:` to `https://3bi.ai/sitemap.xml`.
   - Leave all `Disallow` rules unchanged.

Verification

- Run `tsgo --noEmit` to ensure no type errors from the change.
- Request the production `/sitemap.xml` and `/robots.txt` after the next publish to confirm the domain is correct.
- Note: social platforms cache previews; shared links may need a refresh in their debugger to pick up the new `og:url`/`og:image`.

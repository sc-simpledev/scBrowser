# scTerra AI server

The hosted option behind scTerra's AI features: people without their own API key use this
server, which calls AI providers with your keys and enforces limits per IP address.
It's a small TypeScript service that speaks the OpenAI chat format, so the browser
treats it like any other provider. Message contents are never logged or stored.

It runs on either platform from the same code in `src/`:

- **Cloudflare Workers:** `worker.ts`, set up in `wrangler.toml`, packages in `package.json`.
- **Deno Deploy:** `main.ts`, set up in `deno.json`.

## Deploying on Cloudflare Workers

From this folder, with Node 22 or later:

```bash
npm install
npx wrangler login
npx wrangler secret put API_KEY_1
npx wrangler deploy
```

`wrangler login` opens Cloudflare in the browser; a free account is enough to start.
`secret put` asks for the value, so keys never go in a file or the repository. Add the other
variables (`MODEL_1` and so on, below) the same way, or in the Cloudflare dashboard under
**Workers & Pages**, the `scterra-ai` Worker, **Settings**, **Variables and Secrets**.
`keep_vars = true` in `wrangler.toml` stops a deploy from wiping variables set there.
Changing a secret or variable takes effect straight away, with no redeploy.

The deploy prints the address, such as `https://scterra-ai.<your-subdomain>.workers.dev`.
Check it with `curl https://scterra-ai.<your-subdomain>.workers.dev/health`, which should
answer `{"ok":true}`. Without `API_KEY_1` and `MODEL_1` it answers 500, `not_set_up`.

Differences from Deno Deploy:

- **Limits are always shared** between instances, through one Durable Object called `Limits`
  (in `worker.ts`, kept in its own SQLite storage). `USE_KV` isn't used. The concurrency limit
  is shared too, rather than per instance. Every chat request checks with that one object, which
  lives near where it was first used, so far-away visitors wait a little longer for the first word.
- **Visitor addresses** come from Cloudflare's `CF-Connecting-IP` header, which visitors can't
  forge. Leave `TRUSTED_PROXY_HOPS` at 0.
- **Reports** show up in the Worker's **Logs** tab (Workers Logs is on in `wrangler.toml`). The
  limit of 30 reports an hour per address is per instance, as it was on Deno, and Workers runs
  more, shorter-lived instances, so it's looser there.
- **Cost:** a reply mostly waits on the AI provider, which doesn't count as CPU time. Check
  Cloudflare's current Workers and Durable Objects limits for the free plan against your traffic.

To deploy on each push instead, connect the repository under the Worker's **Settings**,
**Build**, with `server` as the root directory and `npx wrangler deploy` as the deploy command.

### Moving the browser to it

The browser's address is `HOSTED_AI_URL` in `packages/shared/src/ai.ts`, and it includes
`/v1`. Once the Worker answers `/health`, change it from
`https://sc-delta-ai.scspacedev.deno.net/v1` to `https://scterra-ai.<your-subdomain>.workers.dev/v1`
and ship a browser release. Versions already installed keep using the Deno address, so leave
the Deno Deploy app running until people have updated.

### Testing

`npm run typecheck` checks `worker.ts`. `npm test` runs the Worker in `wrangler dev` on this
machine, against fake AI providers that also run locally, so no real provider is called and
nothing is deployed. It covers both route formats, failover, the limits in the Durable Object
and reports. `npx wrangler deploy --dry-run --outdir dist` builds without uploading. The shared
code's own tests run with Deno: `deno test --allow-env`.

## Deploying on Deno Deploy

Deno Deploy builds from the root of the repository, so set this up in
[console.deno.com](https://console.deno.com) under **Edit build config**:

| Setting | Value |
|---|---|
| Framework preset | No Preset |
| Install command | Empty |
| Build command | Empty |
| Runtime configuration | Dynamic |
| Dynamic Entrypoint | `server/main.ts` |

Add the variables below as secrets or plain text before pressing **Create App**.

To share limits across instances, go to **Databases**, press **Provision Database**, choose
Deno KV, press **Assign** next to it and pick the app, then set `USE_KV=true`. Without it,
limits are kept per instance and reset when an instance restarts.

Once it's deployed, the browser reads the app's address from `HOSTED_AI_URL` in
`packages/shared/src/ai.ts`.

## Reports

`POST /v1/reports` takes crash reports and usage stats from people who turned them on in
scTerra's settings. Only known fields are kept, and each one is written as a line of JSON to the
server log, without the sender's address. Find them in the Deno Deploy logs, or the Worker's
Logs tab on Cloudflare. Each address can send 30 an hour, counted per instance.

## AI routes

Each numbered set of variables is one route. Numbers can have gaps.

| Variable | Required | Meaning |
|---|---|---|
| `API_KEY_1` | yes | The key; apps never see it |
| `MODEL_1` | yes | Model name for that provider, such as `claude-opus-5-5` |
| `REASONING_1` | no | Effort such as `low`, `medium` or `high`. Left out, the model's default applies |
| `BASE_URL_1` | no | Provider address. Left out, Anthropic's API is used |
| `WEIGHTING_1` | no | Share of traffic, default 1. `3` gets three times the traffic of `1`; `0` switches it off |
| `FORMAT_1` | no | `anthropic` or `openai`. Worked out from `BASE_URL_1` if left out |

Add `API_KEY_2`, `MODEL_2` and so on for more. With one route it's always used. With two
or more, each request goes to a random route by weight, and if that route fails before
sending any text, the next one takes over. Give keys with higher provider limits a higher
weight.

## Limits

| Variable | Default | Meaning |
|---|---|---|
| `REQUESTS_PER_MINUTE` | 10 | Per IP address |
| `REQUESTS_PER_DAY` | 100 | Per IP address |
| `TOKENS_PER_DAY` | 200000 | Per IP address |
| `GLOBAL_TOKENS_PER_DAY` | 5000000 | Across everyone; the cap on what a day can cost |
| `CONCURRENT_PER_IP` | 2 | Requests at once, per IP address; per instance on Deno. A reply that never finishes frees its slot after 15 minutes |
| `MAX_INPUT_CHARS` | 300000 | Per request |
| `MAX_OUTPUT_TOKENS` | 8000 | Per reply |
| `MAX_BODY_BYTES` | 1000000 | Per request |
| `TRUSTED_PROXY_HOPS` | 0 | Proxies in front of the server; see below. Leave at 0 on Workers |
| `USE_KV` | off | Deno only: `true` shares limits between instances with Deno KV |

## Before going live

- **Proxies:** leave `TRUSTED_PROXY_HOPS` at 0 unless the server is behind a proxy you
  control. Otherwise anyone can forge `X-Forwarded-For` and dodge the limits. Behind a
  proxy, set it to the number of proxies, or every visitor looks like one address.
- **Budget:** set `GLOBAL_TOKENS_PER_DAY` to what you're willing to spend per day. As
  this is free usage, a cheaper `MODEL_1` stretches it much further.
- **Abuse:** IP limits slow people down but don't stop someone with many addresses, or
  someone using this as a free AI API from outside the browser. Add sign-in before
  relying on it at scale.
- **Several instances:** on Deno, use `USE_KV=true`; its concurrency limit is always per
  instance. On Workers, limits are always shared.

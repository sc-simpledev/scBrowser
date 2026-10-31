# scDelta AI server

The hosted option behind scDelta's AI features: people without their own API key use this
server, which calls AI providers with your keys and enforces limits per IP address.
It's a small Deno TypeScript service that speaks the OpenAI chat format, so the browser
treats it like any other provider. Message contents are never logged or stored.

## Deploying on Deno Deploy

In [console.deno.com](https://console.deno.com), create an app from this repository, with
`server` as the app directory and `main.ts` as the entry point, then add the variables below.
To share limits across instances, attach a Deno KV database and set `USE_KV=true`. Without
it, limits are kept per instance and reset when an instance restarts.

Once it's deployed, the browser needs the app's URL as its hosted AI address.

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
| `CONCURRENT_PER_IP` | 2 | Requests at once, per IP address, per instance |
| `MAX_INPUT_CHARS` | 300000 | Per request |
| `MAX_OUTPUT_TOKENS` | 8000 | Per reply |
| `MAX_BODY_BYTES` | 1000000 | Per request |
| `TRUSTED_PROXY_HOPS` | 0 | Proxies in front of the server; see below |
| `USE_KV` | off | `true` shares limits between instances with Deno KV |

## Before going live

- **Proxies:** leave `TRUSTED_PROXY_HOPS` at 0 unless the server is behind a proxy you
  control. Otherwise anyone can forge `X-Forwarded-For` and dodge the limits. Behind a
  proxy, set it to the number of proxies, or every visitor looks like one address.
- **Budget:** set `GLOBAL_TOKENS_PER_DAY` to what you're willing to spend per day. As
  this is free usage, a cheaper `MODEL_1` stretches it much further.
- **Abuse:** IP limits slow people down but don't stop someone with many addresses, or
  someone using this as a free AI API from outside the browser. Add sign-in before
  relying on it at scale.
- **Several instances:** use `USE_KV=true`. The concurrency limit is always per instance.

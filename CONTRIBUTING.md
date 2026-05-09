# Contributing

Thanks for improving Agent Mission Control.

Before opening a pull request:

1. Run `npm test`.
2. Keep the dashboard local-first and read-only by default.
3. Avoid adding telemetry, external network calls, or hosted services unless
   they are optional and clearly documented.
4. Do not commit personal agent state, screenshots with private text, local
   absolute paths, API keys, cookies, databases, or JSONL rollout logs.
5. When adding a provider, expose the same normalized thread shape used by the
   existing adapters and keep provider-specific parsing out of `public/app.js`
   where possible.

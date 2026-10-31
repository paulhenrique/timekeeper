# Timekeeper

A shared stage timer for talks, meetups and conferences.

Create a session, build the agenda (“Opening, 10 min”, “Keynote, 30 min”…), and share **one link**:
open it on your phone to **control** the timer, and open the same link on the stage screen in
**presentation mode** so the speaker sees the countdown — big, readable, and impossible to stop
by accident.

- **Control mode:** agenda editor, ▶ play / ❚❚ pause, previous / next step, ±1 min, restart
  step, quick messages to the speaker (“Five minutes left”, “Please wrap up”…) or free text,
  and a live preview of the stage screen.
- **Presentation mode:** “current › up next” and the clock, nothing else. The clock turns amber
  in the last minute; at zero it **keeps counting overtime in pulsing red** with “Time’s up”.
  It asks the browser to keep the screen on (Screen Wake Lock, like a video player), and
  leaving it requires pressing and holding the corner button, so a stray tap on stage does
  nothing.
- **Volatile by design:** no accounts, no database to manage. A session lives in Redis and
  vanishes after a few hours with nobody using it.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpaulhenrique%2Ftimekeeper)

## How it works

- Plain HTML, CSS and JavaScript plus a few [Vercel Functions](https://vercel.com/docs/functions)
  (Node, CommonJS). **No framework, no build step, no npm dependencies.**
- Each session is one key in [Upstash Redis](https://upstash.com/) (`tk:session:<id>`), talked to
  over its REST API. Session IDs are 10 random characters (no look-alikes like `0/o` or `1/l`).
- Every screen polls its session every 2 seconds and corrects its own clock against the server
  time, so all screens show the same second. Responses are ordered by a state version, so a slow
  poll can never undo a newer action.
- Whoever has the session link can control it. IDs are random and sessions are short-lived, so
  share the link only with your crew.

```
index.html            landing page: "Create a session"
session.html          /s/<id>, both modes (rewrite in vercel.json)
assets/
  strings.js          every user-facing string (translate here)
  core.js             time math, clock formatting, server sync (browser + Node)
  session.js          control mode, presentation mode, wake lock, hold-to-exit
  landing.js
  styles.css
api/
  sessions/index.js   GET  /api/sessions        -> { ttlSec }
                      POST /api/sessions        -> { id, ttlSec }   (rate limited per IP)
  sessions/[id].js    GET  /api/sessions/:id    -> { state, serverNow, ttlSec }
                      POST /api/sessions/:id    { action, ... } -> same
  _timer.js           the timer rules (pure reducer: play, pause, next, adjust, notify…)
  _store.js           Upstash REST client, in-memory fallback for local dev/tests
  _session.js         IDs, TTL, request helpers
scripts/dev-server.js local server that behaves like Vercel (no install needed)
test/                 node:test suites
```

## Deploy your own

1. Click **Deploy with Vercel** above (or import this repository in Vercel). No build settings
   are needed: framework preset **Other**, everything else empty.
2. In the new project: **Storage → Create Database → Upstash for Redis** (the free plan is
   plenty) and connect it to the project for all environments. This adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`.
3. **Redeploy** (environment variables only reach new deployments).

Until Redis is connected, the app tells you so instead of silently failing.

### Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | — | Upstash Redis REST endpoint (added by the Vercel integration). `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. |
| `SESSION_TTL_HOURS` | `12` | A session vanishes after this long with no screen open and no change. |
| `CREATE_LIMIT_PER_HOUR` | `30` | Sessions one IP can create per hour, so a single visitor can’t drain your free quota. |

### Cost

Each open screen makes one small request every 2 seconds (about 1,800 per hour; the stage
preview inside control mode reuses the control screen’s data and adds none). A typical event
with a control phone and one stage screen stays far inside the free tiers of Vercel and
Upstash. Hidden control tabs slow down to one request every 10 seconds. Session creation is
rate limited per IP (per /64 for IPv6).

## Local development

```sh
npm run dev     # http://localhost:3000 (this machine only), in-memory storage, no install needed
npm test        # node --test
```

Node 18+ is enough. `vercel dev` works too if you prefer it.

## Translating

All text is in [`assets/strings.js`](assets/strings.js). Translating the app means translating that
one object. A language switcher is a welcome contribution.

## Contributing

Issues and pull requests are welcome. Please keep the spirit of the project: no build step, no
runtime dependencies, small and readable files. Run `npm test` before opening a PR.

## License

[MIT](LICENSE). Originally built for the [DevItape](https://devitape.com.br) community events.

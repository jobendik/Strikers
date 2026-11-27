# Browser gameplay checks

`play.cjs` drives the real game in headless Chromium through `window.__strikers`
and steps the simulation deterministically (frame-rate independent), then asserts
on outcomes: scripted keyboard control, a mocked gamepad, a penalty shoot-out.

```bash
npx vite --port 5173 --strictPort &
npm run test:browser            # = NODE_PATH=$(npm root -g) node simtest/browser/play.cjs
```

Playwright is expected to be resolvable (it is pre-installed globally in the cloud
sandbox; locally `npm i -D playwright && npx playwright install chromium`). Not part
of `npm run test` because it needs a browser and a running server. Takes ~1–2 min
under software rendering.

# Iron Log

A single-page workout/bodyweight tracker PWA. No build step, no dependencies:
`index.html` loads `app.css` and `app.js` directly, with Firebase for auth + sync.

- `app.js` — all state, rendering (hand-rolled `h()` helper), charts (canvas), storage
- `app.css` — all styling
- `index.html` — entry point; bump the `?v=` query on `app.css`/`app.js` when either changes,
  so the installed PWA picks up the new file

## Layouts

There are two, split at a 1000px breakpoint, and a change to one often affects the other:

- **Desktop (≥1000px)** — no tab bar. All sections visible at once as columns
  (`.dash`): Lifting | Progress | Body Weight | Running at ≥1400px, collapsing to
  three columns below that. One shared range picker lives in the header.
- **Mobile (<1000px)** — tab bar (Weight / Lifting / Running), one section at a time,
  with Log/Progress sub-tabs inside Lifting. Each section renders its own range picker.

`state.desktop` / `state.wide` track the breakpoints and re-render on change.

No rounded corners anywhere — this is deliberate. Don't reintroduce `border-radius`.

## Verify UI changes by looking at them

Any edit to `app.css`, `app.js`, or `index.html` can change what renders. Before
reporting such a change as done:

```bash
python -m http.server 8777
```

Open `http://localhost:8777/index.html` in the Browser pane and screenshot **both**
layouts — `resize_window` to 1440x900 and to the mobile preset (375x812) — then
confirm the change looks right in each. Stop the server afterwards.

Charts only draw when the page has data and the Browser pane is visible. To see them,
seed data in memory rather than writing to IndexedDB: assign to `state.bodyWeight` /
`state.runs` / `state.history` via `javascript_tool`, then call `render()`.

A `PostToolUse` hook in `.claude/settings.json` posts this reminder automatically when
a UI file is edited.

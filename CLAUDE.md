# Mosgolf GPS app — working notes

Personal golf GPS web app for ONE course (Mosgolf, Iceland). Two users, Android
phones on the course, all UI text Icelandic. The owner is NOT a coder: explain
plainly, make changes yourself, never ask them to hand-edit code beyond single
obvious values.

## Commands
- `npm run dev` — vite dev server (preview launch.json runs it on port 5199)
- `npm run build` — must pass clean before every commit
- `npm run lint` — baseline is **53 pre-existing errors** (react/prop-types
  blanket + unused `err` in startPiP). A task must add NOTHING new.
- `npm run bake:greens` — scripts/greens.geojson → src/greenData.js
- `npm run bake:features` — scripts/fariways.geojson (sic, typo'd filename) +
  sand.geojson + aims.geojson → src/featureData.js
- `npm run deploy` — THE USER runs this themselves (gh-pages -d dist)

## Standing rules (every task)
- Never change Icelandic UI strings unless the task is about wording.
- Surgical diffs; no reformatting; no TypeScript; no new frameworks; no new
  runtime dependencies; no new network calls (weather is the only one).
- Android is the target; iOS quirks out of scope.
- Leaflet divIcons live at module scope or in useMemo — NEVER inline in JSX.
- Finish every task: build clean, lint baseline-clean, verify in the preview
  browser when observable, plain-language file-by-file summary, short commit.
- GolfBox form-post and PiP code are fragile by nature — don't refactor unasked.
- If a request is ambiguous or could break on-course use, ask before coding.

## Architecture
- Deliberately one big src/App.jsx (~1950 lines): design tokens (makeTheme),
  map helper components, module-scope helpers, then the App component holding
  ALL state. A split into containers is planned (see git history / ask user).
- Styling = inline style objects from makeTheme(dark). No CSS frameworks.
- src/utils.js — getElevation (bilinear over baked DEM), distance, bearing.
- Data files: courseData.js (HAND-maintained: tees/greens/pars/rank stroke
  index + courseMeta par 71 / CR 68.3 / slope 124), greenData.js +
  elevationData.js + featureData.js (ALL AUTO-GENERATED — never hand-edit,
  regenerate via bake scripts). Don't modify or shrink the DEM grid.
- Weather: ONE Open-Meteo fetch (wind + gusts + temp), 10-min refresh +
  visibilitychange, failure-silent.

## Feature logic worth remembering
- "Plays like": slope via distance-dependent descent angle; superlinear
  headwind / cosine crosswind; temperature from an **8°C Icelandic baseline**.
  Returns null beyond 300 m (club rec falls back to raw distance there).
- Club rec (Pokinn): smallest enabled club covering the shot; up to 3 m over
  counts as full swing if the front edge is reachable; driver (id 'dr') only
  within 10 m of the tee; longest club for anything out of range; 2 m
  hysteresis cache keyed on bag/onTee.
- Stat sheet ("Skrá gögn sjálfur", key statSheet): slides up when leaving a
  hole with score>0 and no sheet; sheet = null | 'skipped' | partial object.
- Snjallskrá (key snjallskra): Skrá högg records GPS mark (live view) or the
  tap marker (tee view, manual:true); Víti records a drop (drop:true = swing
  into trouble + penalty = 2 strokes); long-press Skrá högg = undo last mark;
  faint dashed trail + faint length chips per segment.
- Rounds: ONE schema (comment block in App.jsx, schemaVersion 1). Saved to
  'myRounds' (cap 50, newest first). shots[] strings derived at save time —
  NEVER guess missing data ("no info" / "putt" / "in penalty area" / "relief").
- Exports: JSON download + AI coaching prompt (clipboard) both embed
  EXPORT_README; prompt adds course facts, stroke index, dogleg shapes (from
  baked aim points), course handicap from the Forgjöf setting (WHS formula).
- Android back button: ONE history entry kept while any overlay is open;
  popstate closes the topmost layer; X-closes consume the entry.

## localStorage keys
Live round (NEVER break on deployed phones): currentHoleIndex, myScores,
myPutts, myMatch, mySheets, myMarks. Settings: trackScore, trackPutts,
trackGame, statSheet, snjallskra, simpleView, darkMode, showClubRec, myBag,
myHandicap, gbUser, gbPass. Archive: myRounds. Defunct (ignore, don't delete):
trackShots, statsView. New data goes in NEW keys only; never migrate
destructively. All reads via loadJSON with shape validation.

## Git / deploy
- Work on **main** only. gh-pages = built dist pushed by `npm run deploy`
  (auto-generated, never touch). ui-redesign is an old fully-merged branch.
- No service worker. Phones get updates via normal HTTP cache (~10 min on
  GitHub Pages). Clearing "cached images and files" is safe; clearing "site
  data/cookies" would erase rounds — warn the user.

## Preview-testing quirks
- .claude/launch.json runs dev on port 5199 (user's own server owns 5173).
  App URL is http://localhost:5199/local-golf-app/ (vite base path).
- Starting a new preview server makes the old page reload mid-session
  (transient state lost) — re-seed localStorage and re-open overlays.
- Mock GPS via navigator.geolocation.watchPosition override; real tap =
  mousedown + mouseup + click (a bare .click() is swallowed after long-press).
- SHOW_GREEN_OUTLINES module const is a verification-only switch; ships false.

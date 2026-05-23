# Claude Code instructions for this repo

## Spec docs are durable; chat history is not

Two specs live under `specs/`:

- `PROJECT_BRIEF.md` — what we're building, the editorial stance, schema, page
  layouts, open questions
- `EPISODE_INGESTION.md` — the step-by-step process for taking a YouTube video
  ID and producing a committed episode entry

**Update the relevant spec in the same commit as any change to the process or
direction it describes.** Concretely:

- Changing the data model (a new field on episodes, a new role in taxonomies,
  etc.) → update `PROJECT_BRIEF.md`'s Data Model section
- Changing the visual/editorial stance (color theme, title rewriting rules,
  promotion handling, card anatomy) → update the corresponding section of
  `PROJECT_BRIEF.md`
- Changing the workflow that produces episodes (new script, different data
  source, automated step that used to be manual, new caveat) → update
  `EPISODE_INGESTION.md`
- Resolving an open question → move it out of the Open Questions list with the
  decision recorded in the relevant section

The brief and the ingestion doc are the handoff between sessions. If they're
not current, future sessions lose context.

## Project conventions

- Use `nvm use` (`.nvmrc` pins Node LTS) before running any `npm` script
- Python tooling lives in `.venv` (`./.venv/bin/python ...`); install with
  `python3 -m venv .venv && .venv/bin/pip install opencv-python`
- All raw/regeneratable data goes under `data/_*` (gitignored). Curated data
  at the top level of `data/` is committed
- Portraits at `public/portraits/{guestId}.{jpg,@2x.jpg}` are committed; the
  alts (`-2`, `-3`) are also committed so we can swap without re-extracting
- Watch the dev server at `http://localhost:3000`; restart it (`pkill -f
  "nuxt dev" && npm run dev`) only when `nuxt.config.ts` or `package.json`
  changes — most file changes hot-reload

## Code quality

The codebase should stay easy to navigate and read. Optimize for the next
person opening a file cold.

- **Keep files small.** If a single file grows past ~300 lines, consider
  splitting. Vue components especially — pull out subcomponents, composables,
  or move logic into `~/composables/` or `~/utils/`.
- **One responsibility per file.** Don't pile auth logic into a page
  component; don't put data-fetching helpers in a UI file.
- **Descriptive names over comments.** A function called `appearanceCountFor`
  doesn't need a docstring; one called `compute` does. Rename rather than
  document.
- **Comment WHY, not WHAT.** If a non-obvious constraint forced a decision
  (browser quirk, performance, contract), say so in a brief comment. Never
  narrate code that already explains itself.
- **Magic numbers go to named constants** at the top of the file or in a
  shared config — especially for animation timings, scoring weights, layout
  breakpoints.
- **Match the existing pattern.** If similar code already exists, use the
  same shape and naming. Don't introduce a second way to do the same thing
  unless the new way replaces the old.
- **Accessible by default.** Semantic HTML over divs (`<button>` for
  buttons, `<a>` for links). `aria-label` for icon-only controls. Visible
  focus states. Respect `prefers-reduced-motion`.

## Avoid

- Committing `.env`, anything under `data/_*`, or `node_modules/`
- Hardcoding "the latest" anything (font, model, color) — link to the
  taxonomies/config files instead
- Skipping the manual portrait verification step in the ingestion workflow.
  Face detection finds a face, not the right person

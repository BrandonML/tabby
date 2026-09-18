# Tabby — design handoff: tagline placement + settings polish + interaction pass

**Repo:** BrandonML/tabby · **branch:** main · **all changes live in `extension/`**

These are **approved design decisions**, specified as deltas against the real files in this
repo. This is not a "recreate the mockup in your framework" handoff — the mockups were made by
editing the actual `newtab.html` / `newtab.css` / `options.html`, so every value below is meant
to be applied directly to those files. Vanilla JS/HTML/CSS, no framework, no build step, no new
dependencies.

`Tabby Mockups.dc.html` in this folder is the visual reference. Open it in a browser to see each
change rendered. It uses sample card data in place of a live RescueGroups response; ignore the
grey outer chrome, badges, and annotation panels — those are presentation scaffolding, not part
of the extension.

**Fidelity: high.** Colors, sizes, spacing, and easing below are final. Use them as written.

## What was decided

| # | Item | Issue | Files |
|---|---|---|---|
| 1 | Settings view spacing + floating label + input group (option 30b) | #30 | `options.html`, `newtab.css` |
| 2 | Focus-visible rings + hover transitions (option 2d) | — | `newtab.css` |
| 3 | Drop the un-loaded Inter from the font stack (option 2c/1) | #42 | `newtab.css` |
| 4 | Tagline inline beside the wordmark (option 2a) | #25 | `newtab.html`, `newtab.css` |

**Explicitly out of scope — do not implement:**
- Dark mode / `prefers-color-scheme` (discussed, deferred)
- Self-hosting Public Sans or any new webfont (rejected in favor of item 3)
- Any change to the card layout, and the adoption-fee chip question (being decided separately)
- The `.shell { margin: 8vh auto }` responsive-clamp change — that is being filed as its own
  issue (#45) with its own testing plan. Leave `.shell` alone here.

Existing CSS custom properties (`--paper`, `--wall`, `--ink`, `--ink-soft`, `--moss`,
`--moss-dark`, `--stamp`, `--card-edge`, `--font-display`, `--font-mono`) are unchanged — use the
tokens, not raw hex, anywhere a token already exists.

**Global instructions for these changes:**
- If the specific instructions, implementation, methodology of an item aren't optimal, or incorrect, or don't accomplish the desired resolution, inform the user and discuss how best to approach the desired outcome.
- Where necessary, add or update tests.
- Use the Chrome extension, or similar connectors/MCP's to test the changes in the browser. If a new MCP or connector is required to accomplish this, inform the user.
- Once completed, delete the project directory entirely from the repo, before merging to main.
- Ensure the 3 GH issues associated with this project are properly linked to a specific commit, or to the branch, and that they are marked closed when merging to main.
- As always, if you disagree with anything in this project or have suggested modifications, speak up before proceeding.

---

## 1 · Settings view — issue #30, option 30b

Closes all four points in issue #30, plus a subhead and a hint line that do the spacing work with
content instead of pure margin. `options.html` reuses `newtab.css`; there is still no
`options.css` and this change does not add one.

### 1a · `options.html`

The location panel's heading gains a subhead, and the zip field is restructured into a floating
label + input group. Target structure:

```html
<section class="location-panel" id="location-panel">
  <h1>Your Location</h1>
  <p class="panel-sub">Tabby uses this to find adoptable cats nearest to you.</p>

  <form ...>
    <div class="geo-row">
      <button type="button" id="use-location">Use my location</button>
    </div>

    <p class="or-divider"><span></span>or<span></span></p>

    <div class="zip-field-block">
      <div class="zip-field">
        <div class="form-floating">
          <input id="zip" type="text" inputmode="numeric" placeholder=" ">
          <label for="zip">Zip code</label>
        </div>
        <button type="submit" id="save-zip">Save</button>
      </div>
      <p class="field-hint">Optional — skip this if you use your location.</p>
    </div>
  </form>
</section>
```

Four things matter structurally, and the floating label silently breaks if any are missed:

1. **`placeholder=" "`** — a single space, not empty, not removed. The whole pattern keys off
   `:not(:placeholder-shown)`. An empty or absent placeholder means the label never floats.
2. **The `<label>` comes *after* the `<input>`**, not before. The CSS uses the `~` sibling
   combinator; a label above the input cannot be selected.
3. **`.form-floating` wraps only the input + label**, and is itself a flex child of `.zip-field`
   alongside the Save button. Don't collapse these into one element.
4. The old static `<label>` above the input — including its `(optional)` span — is **removed**.
   That word now lives in `.field-hint` below the group.

Keep the `id="zip"` and the Save button's existing id/handler wiring exactly as they are — the
JS that reads and saves the zip is unchanged. Add `for="zip"` on the label if it isn't there.

### 1b · `newtab.css`

Spacing fixes (#30 points 1 and 2):

```css
.location-panel h1 { margin: 0 0 6px; }        /* was 0 0 12px */

.panel-sub {
  margin: 0 0 24px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.location-panel form { margin-top: 0; }        /* was 18px — .panel-sub now carries the gap */

.or-divider { margin: 18px 0; }                /* was 8px 0 — #30 point 2, now symmetric */

.field-hint {
  margin: 8px 2px 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}
```

Input group (#30 point 4) — one outline around both controls, one seam between them:

```css
.zip-field {
  display: flex;
  align-items: stretch;
  gap: 0;                                  /* was 8px — the gap is what read as two controls */
  overflow: hidden;                        /* clips the button's square corners to the radius */
  border: 1px solid var(--card-edge);
  border-radius: 8px;
  background: var(--paper);
}

.zip-field:focus-within { box-shadow: 0 0 0 3px rgba(63, 93, 66, .22); }

.zip-field .form-floating { flex: 1; }

.zip-field input {
  height: 58px;
  border: 0;
  background: transparent;
  outline: none;                            /* the ring lives on .zip-field, see below */
}

.zip-field button {
  border: 0;
  border-left: 1px solid var(--card-edge);
  border-radius: 0;
  padding: 0 22px;
  background: #eae3cf;
  color: var(--moss-dark);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
}
```

Two notes on the group:

- `height: 58px` on the input assumes the existing `* { box-sizing: border-box }` reset in
  `newtab.css`. It is there today. If it ever goes away, the floating-label padding pushes the
  field to ~90px.
- Save is deliberately a **quiet inset segment**, not a second solid moss block. "Use my
  location" is the panel's primary action; two filled green buttons made them compete. `#eae3cf`
  is a one-off tint here — if you'd rather it be a token, `--paper-sunk` is a reasonable name.
- `.zip-field` owns the focus ring via `:focus-within`, which is why the input sets
  `outline: none`. This one spot intentionally overrides the global `:focus-visible` rule from
  item 2 — a ring around the input alone would cut through the middle of the joined control.

Floating label (#30 point 3) — this is the Bootstrap 5.3 `.form-floating` pattern, reduced to
just what the zip field needs. **Do not add Bootstrap as a dependency**; these rules are the
entire borrowed surface, restyled to Tabby's tokens:

```css
.form-floating { position: relative; }

.form-floating > input {
  padding: 1rem .75rem;
  font: inherit;
  font-size: 16px;                          /* keep 16px — prevents mobile zoom-on-focus */
  line-height: 1.25;
  color: var(--ink);
}

.form-floating > label {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  height: 100%;
  padding: 1rem .75rem;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-soft);
  pointer-events: none;                     /* clicks pass through to the input */
  border: 1px solid transparent;
  transform-origin: 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity .1s ease-in-out, transform .1s ease-in-out;
}

.form-floating > input:focus,
.form-floating > input:not(:placeholder-shown) {
  padding-top: 1.625rem;
  padding-bottom: .625rem;
}

.form-floating > input:focus ~ label,
.form-floating > input:not(:placeholder-shown) ~ label {
  opacity: .65;
  transform: scale(.85) translateY(-.5rem) translateX(.15rem);
}
```

**Acceptance check:** empty field shows "Zip code" at rest size, vertically centered. On focus,
the label scales down and rises, the input text shifts down, and a soft moss ring appears around
the *whole* group including Save. Blur with a value entered keeps the label floated. Blur empty
returns it to rest. Clicking the label focuses the input. Input and Save read as one control with
a single dividing seam.

**Testing:** Ensure input, validation, functionality, save event (hides fields and shows a message to the user that the location is being saved), etc. all continue to work properly and as expected. If needed, add automated tests.

---

## 2 · Focus rings + hover transitions — option 2d

No markup changes at all. Appended to `newtab.css`, applies to `options.html` too.

```css
/* transitions */
button,
.profile,
a {
  transition: background-color .12s ease, color .12s ease, box-shadow .12s ease;
}

@media (prefers-reduced-motion: reduce) {
  button, .profile, a { transition: none; }
}

/* focus rings */
:focus-visible {
  outline: 2px solid var(--moss);
  outline-offset: 2px;
  border-radius: 3px;
}

.share-menu-item:focus-visible {
  outline: none;
  background: var(--wall);
  box-shadow: inset 0 0 0 2px var(--moss);
}
```

Three deliberate choices:

- `:focus-visible`, not `:focus` — mouse clicks on buttons shouldn't leave a ring behind.
- Share-menu items get an **inset** ring instead. They sit flush inside a padded rounded
  container, so an outset ring with offset gets clipped by the parent and looks broken.
- Only `background-color`, `color`, and `box-shadow` transition. Not `all` — `all` would animate
  the floating label's transform and the chips' rotation, and would fight the label's own faster
  `.1s` transition.

The existing hover rules stay as they are; they just ease now instead of snapping. `2d` in the
mockup has a before/after bench — hover and Tab through both columns to compare.

**Acceptance check:** Tab through the new tab page — wordmark actions, card links, View profile,
Share, then the share menu items — and every stop shows a visible moss ring. Same through the
settings panel. Hovers fade rather than snap. With "reduce motion" on at the OS level, hovers go
back to instant and nothing else changes.

---

## 3 · Drop Inter from the font stack — issue #42- option 2c, option 1

One line. `newtab.css` declares `font-family: Inter, ui-sans-serif, system-ui, sans-serif`, but
Inter is never loaded — only `fraunces.woff2` ships. So virtually every user already renders the
system face; the CSS is just describing something that doesn't happen.

```css
/* in :root — replace the existing declaration */
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
```

Decision made against the alternatives: shipping Inter costs ~28KB on a page that loads on every
new tab, to look like every other SaaS dashboard, and it works against the warm paper feel
Fraunces establishes. Self-hosting Public Sans was the runner-up and was declined for now.
`--font-display` (Fraunces) and `--font-mono` are untouched.

**Do not** add a Google Fonts `<link>` anywhere. The extension CSP blocks remote font loads, and
under MV3 it would fail silently.

**Acceptance check:** no visual change on Mac or Windows — that's the point. Confirm the wordmark
and the cat's name still render in Fraunces, and all meta/distance/updated rows still render in
the mono stack.

---

## 4 · Tagline beside the wordmark — issue #25, option 2a

The tagline currently sits inside `<footer class="footer">`, stacked above the "Built by Brandon"
credit and the social links row, where it reads as the first item in a link list. It moves up
next to the wordmark.

**The constraint that drove this option:** the header stays a single row. Tabby, the tagline,
"Explore another area" and "Settings" all remain aligned on one line. Earlier options that
stacked the tagline under the wordmark or centered the masthead were rejected specifically
because they broke that alignment. Do not reintroduce a stacked header.

### 4a · `newtab.html`

Wrap the wordmark, a hairline divider, and the moved tagline in a `.brand` flex container as the
header's first child. `.header-actions` stays the second child, unchanged.

```html
<header>
  <div class="brand">
    <p class="wordmark">Tabby</p>
    <span class="brand-rule" aria-hidden="true"></span>
    <p class="tagline">One cat at a time.</p>
  </div>
  <div class="header-actions">
    <!-- unchanged -->
  </div>
</header>
```

Remove `<p class="tagline">One cat at a time.</p>` from `<footer class="footer">`. The footer
keeps the credit line and the social links row exactly as they are. Keep the trailing period —
it's still set as a sentence here.

`.brand-rule` is decorative, hence `aria-hidden="true"`.

### 4b · `newtab.css`

```css
.brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.brand-rule {
  width: 1px;
  height: 13px;
  background: var(--card-edge);
  align-self: center;                       /* baseline alignment would hang it low */
}

.tagline {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 14px;                          /* was 13px in the footer */
  color: var(--ink-soft);
  margin: 0;
}

@media (max-width: 460px) {
  .brand-rule, .tagline { display: none; }
}
```

Delete the old `.footer .tagline` rule.

`align-items: baseline` on `.brand` is what keeps the wordmark and the italic tagline sharing a
baseline; the divider opts out with `align-self: center` so it reads as centered on the cap
height rather than hanging below. The 460px query is there because the header row is the one
place this can crowd — below that width the tagline and rule drop out and the header returns to
exactly today's layout.

**Acceptance check:** at normal widths, header is one row: `Tabby | One cat at a time.` on the
left, the two action buttons right-aligned, all on a shared baseline. Footer now starts with
"Built by Brandon". Narrow the window below 460px and the tagline and divider disappear cleanly
with no wrap or overflow.

---

## Suggested commit split

Four independent commits, in this order — each is separately revertable and none depends on
another:

1. `Drop un-loaded Inter from the body font stack` (item 3 — one line, zero risk, lands first)
2. `Add focus-visible rings and hover transitions` (item 2)
3. `Improve settings view spacing and join zip input with Save (#30)` (item 1 — closes #30)
4. `Move tagline beside the wordmark (#25)` (item 4 — closes #25)

Item 1 and item 2 touch adjacent concerns: if you land item 2 first, the `.zip-field:focus-within`
ring in item 1 is the intentional local override of the global `:focus-visible` rule. Order as
listed and it reads correctly in the diff.

Issue #30 is fully closed by item 1. Issue #25 is fully closed by item 4. Issue #42 is fully closed by item 3.

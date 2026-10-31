# Animation inventory and WebKit audit

Scope: the client at `e787c44`, plus the welcome, SVG-drawing and reduced-motion fixes in this working tree. This includes a source/browser-support audit and actual Linux WebKit 27.2 runtime checks. It is not a claim that every animation has passed on native macOS.

## Findings

1. **Welcome: confirmed application bug, not WebKit.** `QuestCard` anchored the greeting to `#task-list`, which is absent in a fresh empty home, then fell back to the dock itself. The working-tree fix centers it in the window when there is no list. A real Chromium geometry check fails before the fix and passes afterward. WebKit also verifies the centered greeting and lower dock.
2. **Edit checkmark: a known WebKit SVG hazard matches our code.** `task-save-draw` animates a negative `stroke-dashoffset` with the one-value `stroke-dasharray: 24`. WebKit bug [249307](https://bugs.webkit.org/show_bug.cgi?id=249307) documents incorrect negative offsets with odd-length dash arrays; an explicit `24 24` pattern avoids it without changing the intended drawing direction. The engine fix landed in WebKit main in May 2026, but that does not establish which system WebKit is on the test Mac. This is a strong candidate for the reported double-looking draw, not a confirmed diagnosis on that Mac. Actual Chromium and WebKit editor-save probes start the draw exactly once. WebKit also passes a save that moves the edited row to the top of Updated order; that refresh does not replay the draw.
3. **Completion drawing: the longer solid check is not fully hidden at the start.** P0/P1 done glyphs use the bare check, which is about 22.6 units long; the old `20 20` dash/gap pattern leaves its tip visible before the draw begins. The dash pattern was also supplied only at the first keyframe, so the final value fell back to `none`. The fix uses `32 32` at both endpoints with an initial offset of 32, covering the longer check and its round stroke caps. A rendered-stroke regression covers the actual solid done glyph and the circled completion-toast glyph in Chromium and WebKit. WebKit reproduces the old solid-check defect: its start is not fully hidden and its reveal is not monotonic. The corrected pattern passes both checks. This is an application-level defect, not evidence that WebKit lacks SVG animation support, and does not yet explain every part of the reported Mac completion difference.
4. **Completion is a sequence, not one effect.** It combines the glyph/check drawing, sheen, a 320 ms linger, a 300 ms row exit, a 250 ms flying check, a header bump and a count roll. Linux WebKit passes single completion, three-task completion, count changes, cleanup, undo during exit and sampled SVG flight transforms. The headless run is not a frame-rate benchmark. Visual smoothness, clipping and compositing still need an actual Mac pass. There is no evidence yet that the whole sequence needs replacement.
5. **Theme reveal intentionally differs on older engines.** Same-document View Transitions require Safari 18+. The code feature-detects them and switches themes immediately when unavailable. That is a supported fallback, not a broken task animation.
6. **Reduced motion had a confirmed status-stroke leak, now fixed.** WebKit observed `task-completion-check` starting even under Reduce Motion: the disabling `[data-status-enter] *` rule was less specific than the normal done/canceled path and paused-line rules. Explicit `path` and `line` selectors now win the cascade. The rerun confirms completion changes state/count without flight, sheen, glyph pop, check draw or row slide. Shared popup/toast entry/exit transitions, loading pulses/spinners and the theme-picker overlay are still not consistently motion-gated. Those are separate accessibility follow-ups, not the original report's cause: Reduce Motion was disabled on the test Mac.

**Recommendation:** keep the native WebKit shell and retest the completion sequence on the Mac with these two small SVG fixes. Shipping Chromium is an app-shell migration with a larger distribution and maintenance cost, not an appropriate first fix for these findings.

## Compatibility baseline and limits

The Mac build requires macOS 13.5+, but uses the system WebKit, not a browser engine shipped with the app. Safari release numbers below are compatibility references, not proof of the exact WKWebView revision on a particular machine.

- Tailwind 4's stated Safari baseline is **16.4**. `@property` is available from 16.4; `color-mix()` from 16.2; `:has()` and unprefixed mask compositing from 15.4. The normal framework features are not inherently Chromium-only.
- `Element.animate()` and `Animation.finished` are available from Safari 13.1. The `pseudoElement` option is available from 14; the theme reveal additionally needs View Transitions from 18.
- SVG `transform-box: fill-box` is available from Safari 11. CSS transforms and their origins are supported, but transformed SVGs still merit visual checks.
- Individual `rotate`/`translate` properties are available from Safari 14.1. Perspective and 3D transforms are supported. Layer flattening, masking, blur and blend-mode rendering are visual/performance risks, not missing-API findings.
- `box-decoration-break` has prefixed/partial Safari support. The cancel strike uses `slice`; inspect wrapped titles on the actual engine rather than assuming a pixel-identical result.
- `@starting-style` requires Safari 17.5, but the toast uses Base UI's **data attributes**, not the CSS at-rule. There is no dependency on that newer feature for its entry.
- `vite.config.ts`'s `safari13` target controls compilation; it does not polyfill browser rendering features or lower Tailwind's CSS requirements.

Support versions were checked against MDN browser-compat-data 8.1.7 and WebKit release notes. API support does not certify timing, rasterization or compositing.

## Complete custom CSS inventory

All **29 authored keyframes** live in [`src/styles.css`](../src/styles.css). All instantiate and produce finite computed samples in Linux WebKit. That mechanical check does not verify every originating workflow or its visual appearance. “Supported” means the primitives meet the baseline, not that this audit verified the animation on native macOS.

| Experience | Keyframes | WebKit assessment |
| --- | --- | --- |
| Edited-row accent sweep | `task-save-sweep` | Supported background-position animation; gradients/color mixing meet the baseline. |
| Save checkmark appearance and disappearance | `task-save-tick` | Supported opacity/scale; inspect alongside the SVG draw, not as a separate save. |
| Save checkmark stroke | `task-save-draw` | Explicit even dash/gap pattern applied for the known WebKit hazard, finding 2. Mac confirmation pending. |
| New-row landing | `task-save-slam` | Supported transform, opacity and background; per-keyframe easing. |
| Neighbor-row jolt | `task-save-jolt` | Supported transform; `:has()` meets the baseline. |
| New-task plus riding the landing | `task-save-ride` | Supported transform/opacity; coordinated with the landing. |
| New-task ring burst | `task-save-burst` | Supported pseudo-element transform/opacity. |
| Trailing facts stepping aside | `task-save-make-room` | Supported opacity. |
| Task sliding out of a view | `task-list-exit` | Supported translate/opacity; overflow clips the departing row. |
| Cancellation strike-through | `task-title-strike` | Supported background-size; wrapped inline fragments need visual checking. |
| Status/priority/effort entrance and completion-toast pop | `task-completion-pop` | Supported SVG/HTML transforms; uses explicit fill-box and center origin. |
| Done/canceled glyph and completion-toast stroke | `task-completion-check` | Pattern now stays constant and covers the longer solid check, finding 3. Mac confirmation pending. |
| Rising done count, new number | `task-count-roll-in` | Supported translate/opacity inside a clipped inline container. |
| Rising done count, old number | `task-count-roll-out` | Supported translate/opacity; hidden with reduced motion. |
| Completion sheen and batch wave | `task-completion-sheen` | Supported box-shadow/color mixing; 90 ms staggering is application timing. |
| In-progress glyph turning into place | `task-status-turn` | Supported rotation/scale; overshooting cubic-bezier is valid. |
| Paused glyph bars raising | `task-status-raise` | Supported SVG line scaling with explicit fill-box/center. |
| Welcome card entrance, hold and descent | `quest-card-welcome` | Supported variable-based transforms; empty-home anchor fixed separately. |
| Welcome greeting becoming a quest | `quest-greeting-fade` | Supported opacity; timed independently from the card. |
| Welcome hand wave | `quest-wave` | Supported rotation with an authored wrist origin. |
| Welcome dimmed background | `quest-spotlight` | Supported opacity/color mixing. |
| Completed quest leaving | `quest-card-leave` | Supported translate/opacity. |
| Reduced-motion quest exit | `quest-card-fade` | Supported opacity-only alternative. |
| Quest trophy celebration | `quest-trophy-pop` | Supported scale/rotation/opacity. |
| Quest sparks, including finale's second wave | `quest-spark` | Supported variable-based transforms; second wave uses individual `rotate`. |
| Quest reward glow | `quest-card-glow` | Supported box-shadow; finale intentionally repeats it twice. |
| Finale's learning ring burst | `learn-ring-burst` | Supported SVG transform/opacity/stroke width; inspect center/origin. |
| Finale's learning track settling | `learn-track-settle` | Supported SVG stroke opacity. |
| Header Help reward pop | `quest-help-pop` | Supported transform/color. |

The learning-progress ring also transitions `stroke-dasharray` over 600 ms in `LearnIcon.tsx`/`styles.css`. Its explicit two-number, nonnegative pattern does **not** have the save checkmark's negative-offset hazard. Quest steps and recap keys additionally use the shared `enter` animation for fade/slide/zoom.

## JavaScript-driven motion inventory

There are **seven direct Web Animations call sites**, plus the Motion-driven theme picker.

| Experience and source | Mechanism | WebKit assessment |
| --- | --- | --- |
| Completed check flying to done count, `useDoneFlights.ts:flyCheck` | Cloned SVG, 41 explicit transform/opacity keyframes, 250 ms; cleanup through `Animation.finished`. | Supported API. Check the complete trajectory, SVG sizing/origin, inherited styling and clipping on the Mac. There is a duplicate-flight guard for optimistic/confirmed updates. |
| Done-count icon bump, `useDoneFlights.ts:bumpCount` | SVG scale keyframes, 220 ms. | Supported API; no explicit origin on this icon, so include it in the visual check. |
| Newly typed category/tag/date becoming a pill, `ClassificationPills.tsx` | Measured text position to final pill position, transform/opacity, 280 ms. | Supported API. Canvas font metrics and layout measurements can differ between engines. |
| Removed pill closing its gap, `ClassificationPills.tsx` | Opacity, scale and negative `marginInlineEnd`, 160 ms. | Supported logical margin/API; forces layout while animating. Test wrapped tags too. |
| Filter/category ghost travelling, `categoryFlight.ts:flyGhost` | Fixed HTML clone, transform/opacity, 280 ms. | Supported API; intermediate frames omit transform and rely on interpolation. Worth testing the handover, not currently a confirmed defect. |
| Destination category badge appearing, `categoryFlight.ts:flyCategoryToFilter` | Delayed opacity handover. | Supported API; relies on the next animation frame after filtering. |
| Theme revealing from chosen card, `theme/reveal.ts` | View Transition plus circular clip-path on a pseudo-element, 750 ms. | Safari 18+ enhancement, with an immediate-switch fallback. |
| Theme ring turning, flinging and appearing, `theme-picker/picker.tsx` | Motion `animate`, spring/inertia motion values; full perspective/translate3d/rotateY transforms. | No Chromium-only primitive found. Test stacking, drag/fling and frame rate on actual WebKit. Reduced motion removes turn/fling/open springs. |
| Front theme card tilt, glare, rim and shadow, `theme-picker/picker.tsx`, `material/sheen.tsx` | Motion springs/derived values; 3D transforms, masked gradients, blur and blending. | Supported primitives, but the highest compositing/performance risk in the app. Reduced motion disables interactive tilt. |

Other `requestAnimationFrame` calls coordinate focus, scrolling, measurements, refresh preservation or staged mounting. They do not introduce another independently authored motion effect. List/editor scrolling does not request smooth scrolling.

## Shared component motion inventory

These use Tailwind, tw-animate-css and Base UI rather than the custom keyframes above. The audit includes the **used** effects, not unused utilities offered by the packages.

| Experience | Sources | Mechanism and assessment |
| --- | --- | --- |
| Dialog/command-palette/settings/theme overlays | `ui/dialog.tsx`, `theme-picker/picker.tsx` | Shared `enter`/`exit`: fade and scale, plus backdrop blur where supported. Core primitives meet the baseline; test opening/closing and rapid reopening on WebKit. |
| Popovers and selects | `ui/popover.tsx`, `ui/select.tsx` | Shared `enter`/`exit`: fade/scale/directional slide and measured transform origin. Supported; check collision/repositioning while open. |
| Menus and submenus | `ui/dropdown-menu.tsx`, `ui/context-menu.tsx` | Same fade/scale/slide family. Supported; Base UI owns mount/unmount timing. |
| Normal and anchored feedback tooltips | `ui/tooltip.tsx`, `variants/tooltip.tsx` | Same family, anchored to controls. Supported; check quick keyboard-driven changes as well as hover. |
| Toast stack entering, leaving, expanding and swiping | `ui/toast.tsx`, `TaskToaster.tsx` | Transform/opacity/height transitions and CSS variables; Base UI data attributes drive states. Supported, but layering and interruption need a Mac pass. Completion icons use the custom SVG effects above. |
| Editor action/description entrances | `TaskComposer.tsx` | Shared `enter`: fade/short slide, motion-safe gated. Supported. |
| Quest steps, success icons and recap keys | `QuestCard.tsx` | Shared `enter`: fade/slide/zoom, motion-safe gated. Supported; new step keys deliberately remount to replay. |
| Pending status, unloaded images and theme search caret | `TaskRow.tsx`, `AttachmentRow.tsx`, `theme-picker/picker.tsx` | Tailwind `pulse` opacity loop. Supported; reduced-motion follow-up applies. |
| Loading toast icon | `ui/toast.tsx` | Tailwind `spin` rotation loop. Supported; reduced-motion follow-up applies. |
| Buttons, tabs, badges, inputs, checkbox, task hover, breadcrumbs and quest dots | `ui/*`, `TaskRow.tsx`, `QuestCard.tsx` | Short color/opacity/shadow/transform transitions; no missing WebKit capability found. Keyboard list selection explicitly disables row transitions. |
| Theme preview press feedback | `theme-picker/preview-card.tsx` | Scale, brightness and shadow transitions. Supported; inspect alongside 3D compositing. |
| Theme application suppressing ordinary transitions | `theme/provider.tsx` | Temporary `transition: none !important` during the palette switch. Intentional: avoids every control easing to its new colors separately. |

## What to verify on the Mac

Use a disposable Tasks home and record the macOS version and a short screen recording if a step differs. Do not reset the owner's normal home just to replay onboarding.

1. Fresh empty home: welcome centered, greeting held, then one descent to the quest dock. Existing-task home: greeting over the list. Reduced motion: greeting stays in the dock.
2. Edit an existing task several times, both in Created order and Updated order: one sweep and one left-to-right check draw per save, no second draw on refresh/reorder.
3. Complete one task: check draws once, sheen plays, row lingers and exits, flying check reaches the header, count rises once. Repeat with an existing nonzero done count and in a view that keeps Done rows visible.
4. Complete a batch: wave/exit/count timing remains coordinated. Undo or reverse before a flight lands: no orphan check or stuck count. Repeat at normal and increased text size.
5. Start, pause, cancel, change priority and effort: glyphs animate from their own centers; wrapped cancellation strike remains legible.
6. Create a task: one landing/plus/ring sequence, with neighboring rows settling back.
7. Type/remove category, tags and date; select a category from a row and start a task within that category: one handover each, no stranded ghost.
8. Finish a quest and the last quest: trophy/sparks/recap/help ring; the finale's second wave and double glow are intentional.
9. Open/close menus, popovers, tooltips, settings and toasts quickly; change themes through the ring and confirm. Older engines may switch themes without the circular reveal.
10. Repeat representative cases with Reduce Motion enabled and with the window resized. Check final state and focus, not just the moving frames.

## Evidence and remaining gap

- Empty-home welcome: real Chromium fail-before/pass-after regression in `scripts/check-ui.mjs`.
- Editor save: a real Chromium probe observes **one** `task-save-draw` start and a single progressive path draw, not duplicate save dispatch. The even-pattern compatibility fix is applied; the affected Mac still needs to confirm the result.
- Solid done glyph and completion-toast check: the actual Chromium stroke probe verifies a fully hidden start, progressive reveal without erasure, and a fully drawn end. The old solid-check pattern fails this check; the new pattern passes. These checks now live in `scripts/check-ui.mjs`.
- WebKit: after the owner installed the host libraries, **18 runtime audit groups pass in Playwright WebKit 27.2** on Linux, with no uncaught browser errors. The engine is newer than some supported Macs, so this does not reproduce every historical WebKit defect. No test dependency was added to the project.
- Runtime coverage: centered welcome; all 29 keyframes mechanically instantiated/sampled; two repeated saves; Updated-sort save/reorder; single completion/flight/count/cleanup; solid and circled stroke drawing with old-pattern comparison; pill arrival/removal; category/filter/editor handovers; new-task landing/plus/ring; dialog open/close; 3D theme selection; reduced-motion welcome; 390 px layout; three-task completion; undo before flight launch; reduced-motion completion. Quest trophy/finale effects were mechanically sampled, not driven through every quest to their natural trigger.
- Temporary reproducible probe and artifacts: `/tmp/tasks-webkit-check-UYF3oi/run-audit.mjs`, `audit-body.mjs`, `results.json`, `welcome-webkit.png`, `theme-webkit.png` and `narrow-webkit.png`. Run `node /tmp/tasks-webkit-check-UYF3oi/run-audit.mjs` from this repo while that temporary tooling remains available. This is not a committed WebKit CI suite; `scripts/check-ui.mjs` retains the Chromium regressions.
- Required local checks pass: `pnpm check`, `pnpm lint`, `kit check`, and all 1,431 tests with `VITEST_MAX_WORKERS=4 pnpm test`.
- The broader `pnpm test:ui` run stops at its unchanged first editor focus-ring assertion: the title input reports a 0 px ring while the test expects 2 px. That unrelated assertion was not weakened and the UI styling was not changed to satisfy it. The focused animation probes above pass independently; the full UI run is not a pass.
- Native macOS: the first packaged app launches, per the owner. Native animation acceptance remains open.
- The Linux WebKit pass does not certify macOS WKWebView compositing, native frame cadence, every shared-popup interaction, or the oldest supported system WebKit. Rebuild and repeat the Mac checklist above on the affected machine.

Sources: [WebKit negative-offset report and comments](https://bugs.webkit.org/rest/bug/249307/comment), [WebKit fix](https://github.com/WebKit/WebKit/pull/63602), [Safari 16.4 features](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), [Safari 18 View Transitions](https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/), [Tailwind browser baseline](https://tailwindcss.com/docs/compatibility), [MDN browser-compat-data](https://github.com/mdn/browser-compat-data).

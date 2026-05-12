# Screenshots for the project README

Drop screenshots here using these exact filenames so the project README
(`README.md`) picks them up:

| File | What to capture |
| --- | --- |
| `feed-mobile.png` | The public `/feed` page on a mobile viewport (375px-ish), signed in, with several real recipe cards visible. |
| `recipe-detail.png` | A `/r/[id]` detail page showing the photo carousel, title, ingredients, and the first step. |
| `cook-mode.png` | `/r/[id]/cook` mid-recipe — big-text step, servings scaler visible, dot indicators showing progress. |

How to take them on the device-toolbar in DevTools:

1. `pnpm dev`, sign in, seed a few recipes (`pnpm db:seed` works).
2. Chrome DevTools → toggle device toolbar → choose iPhone 14 Pro (or
   any narrow-ish profile) at 100% zoom.
3. Capture with `Cmd-Shift-P` → "Capture screenshot" (whole viewport)
   or "Capture full size screenshot" for long pages.
4. Crop to remove the URL bar / chrome and save as PNG into this
   folder.

Resize each one to a max width of ~760px before committing (≈3× the
240px display width, so it still looks crisp on retina). The current
PNGs hover around 40 KB each — well under the 100 KB budget.

`scripts/crop-readme-screenshot.ts` does the crop + downscale in one
shot if you've captured a full-page mobile screenshot already:

```bash
pnpm tsx scripts/crop-readme-screenshot.ts \
  /tmp/feed-full.png docs/screenshots/feed-mobile.png 1600
```

# Sound sources

The raw material the UI sound kit is built from. `node scripts/gen-sfx.js`
assembles these into `assets/sfx` (bundled for the APK) and `public/sfx`
(served by the web build); nothing here ships as-is.

Every file is **CC0 / public domain** — free for commercial use, no attribution
required, and none of it is registered with Content ID. That matters because the
app goes to a store: only CC0 or equally unencumbered audio belongs in this
folder. If you add a sound, record where it came from and its licence here.

| File | Source | Licence |
|---|---|---|
| `whoosh-air.wav` | "Fast Whoosh" — videoeditingsfx.com free pack | CC0 |
| `gate-sword.wav` | "Sword draw unsheathe" — freesound.org/s/581594 | CC0 |
| `tick.wav` | `tick_002` — Kenney "Interface Sounds" pack (kenney.nl) | CC0 |

Every sound on that site downloads directly as `https://videoeditingsfx.com/sounds/<slug>.mp3`
(the slug is the one in its `/sfx/<slug>` page URL), so trying a different take is a
one-line curl. Alternates auditioned for this kit: `swish-1`, `swish-3`,
`simple-whoosh-1`, `swoosh-quick-low` (whooshes); `ui-sound-4`, `ui-sound-6`,
a stone door (freesound.org/s/833925), a temple gong (s/803159), a shrine gong (s/364847), a low church bell (s/554655), an anvil (s/434339) and thunder (s/361772) — all CC0 field recordings auditioned for the gate; `ui_tick_001`, `ui_tick_004`, `select_007`, `click_002` from the Kenney pack (charge ticks).

The three videoeditingsfx sounds were downloaded as MP3, decoded to 16-bit mono 44.1kHz WAV and
silence-trimmed at both ends (ffmpeg) before landing here — so the build script
can treat every source the same way.

Swapping a sound is a file drop: replace one of these WAVs (same name, same
format) and re-run the build. To audition something new first, put the MP3
through:

    ffmpeg -i new.mp3 -ac 1 -ar 44100 assets/sfx-src/whoosh-air.wav

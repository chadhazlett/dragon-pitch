# Dragon Pitch 🐉🎹

An absolute-pitch (perfect-pitch) training game for Ronin. Hear a piano note, name it, and
battle through 8 escalating dragon bosses. Runs entirely in the browser — no internet needed once
loaded — so it works on a Chromebook or on a phone in the car.

## How to play

1. Tap **Tap to Start** (this unlocks the piano sound — browsers require one tap before audio).
2. Pick a player name (each player keeps their own stars and history on that device).
3. A piano note plays **cold** (no reference). Tap the note button you think it is.
   - **🔊 Hear the note** replays it as many times as you like.
   - Get it right → you damage the dragon and earn ⭐. Get it wrong → the game tells you how many
     steps off you were ("just 1 too high!"), replays the right note, and you lose a heart.
4. Empty the dragon's health bar to defeat it and unlock the next one.

**Difficulty** grows two ways, set by the boss ladder:
- **Note set:** white keys only → more notes → all 12 (sharps appear as buttons turn up).
- **Octave range:** starts in one octave near middle C, widens to several octaves.

The boss ladder: Ender Dragon → Mother Wither Storm → God Dragon → Titan Dragon → Water Dragon →
Soulfire Dragon → Glacier Dragon → Gold Dragon (final, with beat-the-clock).

**Grown-up menu (☰):** see per-note accuracy stats, turn on **Free Practice** to pick exactly which
notes/octaves to drill (and optional beat-the-clock), **Export/Import** progress as a file (to move a
player from the Chromebook to the phone, since saves are per-device), switch players, or restart a dragon.

## Run it locally

The game must be served over `http://` (not opened as a `file://` path) so the service worker and audio
load correctly:

```bash
cd absolutepitch
python3 -m http.server 8123
# then open http://localhost:8123 in a browser
```

## Deploy to GitHub Pages

```bash
cd absolutepitch
git init
git add .
git commit -m "Dragon Pitch"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / `(root)` → Save.** After a minute the game is live at
`https://<your-username>.github.io/<repo>/`.

On the phone you can open that URL and use **Add to Home Screen** to get a full-screen, app-like icon
that also works offline.

## What's inside

| File | Purpose |
|------|---------|
| `index.html` | Screens: splash, profile picker, game, menu/win modals |
| `styles.css` | Kid-friendly, big touch targets, responsive (phone + Chromebook) |
| `app.js` | Game loop, boss ladder, scoring, feedback, `localStorage` saves, export/import |
| `vendor/Tone.js` | [Tone.js](https://tonejs.github.io) (MIT) — drives the sampled piano |
| `assets/piano/*.mp3` | Salamander Grand Piano samples (CC-BY 3.0); see `assets/piano/LICENSE.txt` |
| `assets/theend.png` | Background photo of Minecraft's "The End"; see Credits below |
| `sw.js`, `manifest.json`, `icons/` | PWA: offline caching + installable app |

## Tuning (for a grown-up editing the code)

All knobs live near the top of `app.js`:
- `BOSSES` — each dragon's note set, octaves, health, and beat-the-clock flag.
- `MAX_HEARTS` — lives per dragon before it flies off (progress/stars are kept).
- `CLOCK_MS` — beat-the-clock time window.
- Star rewards (`onCorrect`, streak bonus, `+5` boss bonus in `winBoss`).

## Credits

- **Background image:** Minecraft "The End" dimension, image via
  [g-portal.com](https://www.g-portal.com/en/blog/minecraft-dimensions-en).
  Minecraft is a trademark of Mojang / Microsoft. Used here for a personal, non-commercial
  learning game.
- **Piano sound:** Salamander Grand Piano by Alexander Holm (CC-BY 3.0) — see `assets/piano/LICENSE.txt`.
- **Audio engine:** [Tone.js](https://tonejs.github.io) (MIT).
- **Dragon sprites:** original pixel art generated for this project.

## Notes

- Saves are **per device** by design (no login/cloud). Use Export/Import to copy a player between
  devices. Cloud sync could be added later if needed.
- Ronin names the **note** (pitch class) regardless of octave. A future "name the octave" advanced mode
  could be added.
- We deliberately use original emoji/CSS dragon art and the boss *names* only — no copyrighted images.

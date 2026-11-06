# FencingPool Web

Fencing tournament manager that runs as a normal website on **GitHub Pages**
(free, always on, no server). Up to 265 fencers: serpentine pools of 7, FIE
ranking (V/M, indicator, touches scored), adjustable 20-30% cut, fixed Table of
256 with byes, direct elimination to the champion. Built for phones.

Several referees score at the same time: each bout is saved with a version
number, so if two people save the same bout the second one is refused and sees
the new score. Nobody overwrites anybody.

## Step 1 - Put it online (GitHub Pages)

1. On github.com create a repository named `FencingPool` (Public).
2. **Add file > Upload files**: upload `index.html`, `engine.js`, `store.js`, `config.js`, `README.md`.
3. **Settings > Pages > Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`, Save.
4. After ~1 minute your site is `https://YOUR-NAME.github.io/FencingPool/`.

You can already use it: it starts in **test mode** (works on one phone only).

## Step 2 - Let many referees share scores (free Firebase database)

GitHub Pages cannot store shared scores by itself, so we add a free database.
No credit card needed (Spark plan).

1. Go to https://console.firebase.google.com, sign in with Google, **Create a project** (turn Google Analytics off).
2. **Build > Realtime Database > Create database**. Pick any location. Choose **Start in locked mode**.
3. Open the **Rules** tab, replace everything with this, then **Publish**:
```
{
  "rules": {
    ".read": false,
    ".write": false,
    "t": {
      "$code": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```
   (Only people who know a tournament's secret 8-letter code can read or change it; the list of tournaments cannot be browsed.)
4. **Project settings (gear) > Your apps > Web (`</>`)**: register an app, then copy the `firebaseConfig` values.
5. On GitHub open `config.js` > pencil icon, replace `null` with your config (see the example inside), **Commit**. Wait 1 minute and reload the site. The header now says "live".

## Using it at the event

1. Open your site, type the tournament name, tap **Create tournament**.
2. Tap **Share link** and send it to the referees (WhatsApp etc.). The code is inside the link.
3. Paste fencers (one per line, best seed first), **Add fencers**, **Start pools**.
4. Referees type their name at the top, open a pool, enter both scores, tap **Save**.
5. When all pool bouts are done, set the cut % (default 20) and tap **Finish pools**.
6. Bracket tab: score the current round (to 15, no ties). Results tab shows the champion.

Anyone with the link can score, so share it only with referees.

## Rules implemented

| Topic | Implementation |
|---|---|
| Pools | serpentine by seed; 7 per pool, 6 only when needed (265 = 37x7 + 1x6) |
| Pool bout | to 5 touches / 3 min; a tie counts as a double defeat (epee) |
| Ranking | V/M, then Indicator (TG-TR), then Touches Scored; last tie -> better seed |
| Cut | bottom 20-30% (rounded down) |
| Bracket | 256 slots, matrix 1v256, 2v255..., top seeds get byes |
| DE | to 15 touches; enter the final score after priority |
| Rounds | 256, 128, 64, 32, 16, Quarterfinals, Semifinals, Final; both semifinal losers share 3rd |

Check the pool bout orders in `engine.js` against the current FIE rulebook before
an official event. Club/country separation in pools is not implemented.

## For developers

`engine.js` rules (pure functions) - `store.js` storage + actions (Local and Firebase) - `index.html` screen.
Tests: `node --test tests/engine.test.js` (Node 18+).

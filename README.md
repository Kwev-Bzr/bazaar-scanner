# Bazaar Scanner

A Twitch extension for [The Bazaar](https://playthebazaar.com). Viewers hover
over any item on the streamer's board and read its full description, in their
own language. A search panel gives them the whole catalogue, board or not.

Available in English, French, German, Spanish, Italian, Portuguese, Korean and
Chinese.

**[Download the installer →](https://github.com/Kwev-Bzr/bazaar-scanner/releases)**

## Why

On my streams, viewers kept asking what this or that item does. Answering
every time breaks the flow of a run, and newcomers end up lost. With the
extension, they just hover the card.

## For streamers

Run the installer. It sets up the companion app and the game mod, finding your
game folder on its own. Then open Bazaar Scanner: on first launch, the window
offers to log you in to Twitch. Finally, activate the extension on your
channel.

The app's **Run** page shows what your viewers can hover: a summary of the run,
what faces you, your board, your stash, your skills, and a run log. The menu on
the left leads to the settings:

- **Layout**, if the game does not fill your whole OBS scene, so the hover
  zones line up with your layout;
- **Delay**, if a tournament requires a broadcast delay. When streaming
  normally there is nothing to set: the extension follows each viewer's player;
- **Diagnostics**, to check everything at a glance, and copy it all as text
  when you ask for help.

A light appears at the bottom left when a new version is published.

Placement, size, theme and font belong to each viewer, who sets them from the
extension's own menu.

The app must be running while you stream: the extension only shows what the app
sends it, and displays nothing at all when it is closed.

## For viewers

Hovering a card shows its sheet: translated description, per-tier values or
the current run's values, coloured keywords, enchantment variants. A click pins
it, with one button per enchantment.

A drawer shows the streamer's stash, and a row at the top or bottom of the video the
result of each day of the run. Hovering the victory counter, prestige gauge,
income or bank explains them with the game's own text.

Two buttons sit at the bottom right of the player:

- the **magnifier** searches the whole catalogue, including card text, with
  filters by hero, card type, size, rarity and effect;
- the **options** menu sets the display language, the theme, where the sheet
  appears, its text size and its font, the stash drawer and the win count.

Those preferences are kept in the browser and follow the viewer from one
channel to the next.

## What the mod does, and does not

The extension needs to know what is on the board, and only the game knows that.
A BepInEx mod supplies it.

Once per second, it reads the streamer's board, stash, skills and hero by
reflection, along with the facing row: the opponent's board during a fight,
and the cards a shop or an event puts on the table. It writes them to a JSON
file, which is what the companion app broadcasts. Nothing else is read.

Reading the facing row is new in 2.0; version 1.0.0 only read the streamer's
own side. Everything captured is on the streamer's screen at the moment it is
read, so viewers see nothing they could not see by watching the stream. Cards
still hidden from the player, such as an unrevealed hand or an unopened chest,
are not read.

It does **not** write to the game, patch any code, hook game logic, intercept
network traffic, or send any input.

To regenerate the card pages after a game update, I use a routine that
enumerates the game's card catalogue. It only exists in my development build:
the mod distributed to streamers doesn't contain it. In the source, it sits
with my diagnostic probes behind the `SONDES` compilation symbol, which the
distributed build doesn't define.

The full technical description is in
[docs/TECHNICAL-DISCLOSURE.md](docs/TECHNICAL-DISCLOSURE.md) (French version:
[docs/DIVULGATION-TECHNIQUE.md](docs/DIVULGATION-TECHNIQUE.md)).

## How it works

```
The Bazaar                    the game
    |
    |  read-only reflection, once per second
    v
BepInEx mod  ------------->  board_state.json      on the streamer's disk
    |
    v
Companion app  ----------->  Twitch PubSub          card ids only, ~1 KB/s
    |                              |
    |  requests a short-lived      v
    |  token, 3x per hour     Extension              in the viewer's player
    v                              |
Relay (Cloudflare Worker)          |  fetches card text and artwork
                                   v
                            Static hosting
```

The message sent to Twitch carries positions, shortened card identifiers and
rarities, the counters the game always shows (victories, prestige, day, each
day's result), where the game sits inside the streamer's scene, and the
tournament delay the streamer declared:

```json
{"v":4,"lang":"fr","h":"Vanessa","b":[{"s":0,"n":2,"id":"a05d23cb","e":"Golden","q":"G"}],
 "k":[{"s":0,"id":"73722d74","q":"D"}],"vi":5,"pr":15,"j":9,"hj":"vdvvdvvv"}
```

Descriptions and artwork are fetched by the extension from static hosting, not
by the app. This keeps the app light and its bandwidth close to zero, since
Twitch delivers the same message to every viewer, whether there are ten of
them or thirty thousand.

## Delays

The opponent's board is held back for ten seconds from the start of a fight
between players, and two seconds against a monster. Everything else (the
streamer's own board, stash, skills, shops and events) is sent without delay,
since it is already on screen.

The extension also waits for each viewer's own player delay, so a card never
appears before it is visible in their video. For tournaments, the streamer can
set a delay in the app, applied before anything is sent.

## The relay, and why it exists

A Twitch extension has a single signing secret. If every streamer's copy signed
its own messages, that secret would have to ship inside the executable, and an
executable can be decompiled. Anyone could then broadcast fake boards on any
user's channel.

So the secret lives in a Cloudflare Worker instead. Streamers authenticate with
Twitch, the relay derives a personal token from their channel id by HMAC, and
hands out a Twitch token valid for 25 minutes. The app then talks to Twitch
directly.

There's no database. Tokens are derived rather than stored, and the relay
recomputes them to check them. Each streamer makes about three relay calls an
hour, so Cloudflare's free tier is enough for several thousand users.

## Privacy

The extension doesn't collect anything about viewers. There are no trackers or
ad cookies, and it never asks for their Twitch identity. A viewer's browser
only keeps their display preferences (language, placement, size, theme, font,
stash drawer, win count) and whether they've seen the first-visit hint.

The companion app only sends the layout of the run. Health, gold, combat state
and personal data are never sent. Its Twitch authorisation identifies the
channel, and you can revoke it at any time from your Twitch account settings.

Full text: [privacy policy](https://bazaar-scanner.pages.dev/confidentialite.html)
· [terms of use](https://bazaar-scanner.pages.dev/cgu.html)

## Layout

```
mod/          BepInEx plugin (C#)
app/          companion app (Node, packaged as a single .exe)
relay/        Cloudflare Worker
extension/    Twitch extension; src/ is generated from overlay.html
docs/         technical disclosure, privacy policy, terms
```

A French version of this file is in [LISEZMOI.md](LISEZMOI.md).

The companion app builds into the executable that the installer ships, so anyone
can rebuild it from this source and compare:

```
cd app && bash build.sh
```

## Game data

Card descriptions, translations and artwork belong to the game's publisher and
are not redistributed here.

The extension fetches them from static hosting. Those pages are generated ahead
of time from a local installation of the game, by tools kept outside this
repository. Nothing is read from a viewer's or a streamer's machine.

## About

Bazaar Scanner is an independent community project, built with the agreement of
the game's developers. It has no official connection to Tempo Storm or to
Twitch.

## Licence

MIT. See [LICENSE](LICENSE).

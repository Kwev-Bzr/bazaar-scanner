# Bazaar Scanner

A Twitch extension for [The Bazaar](https://playthebazaar.com). Viewers hover
over any item on the streamer's board and read its full description, in their
own language. A search panel gives them the whole catalogue, board or not.

Available in English, French, German, Spanish, Italian, Portuguese, Korean and
Chinese.

**[Download the installer →](https://github.com/Kwev-Bzr/bazaar-scanner/releases)**

## Why this exists

Viewers spend half the stream asking what items do. That breaks the streamer's
flow and leaves newcomers behind. Hovering answers the question without anyone
having to ask it.

## For streamers

Run the installer. It sets up the companion app and the game mod, finding your
game folder on its own. Then open Bazaar Scanner, click **Connect with Twitch**,
and activate the extension on your channel.

If the game does not fill your whole OBS scene, use **Calibrate** so the hover
zones line up with your layout. You can also declare your broadcast delay, so
the cards stay in step with what your viewers actually see.

Placement, size, colour and font belong to each viewer, who sets them from the
extension's own menu.

The app must be running while you stream: the extension only shows what the app
sends it, and displays nothing at all when it is closed.

## For viewers

Hovering a card shows its sheet: translated description, per-tier values,
coloured keywords, enchantment variants.

Three buttons sit at the bottom right of the player:

- the **magnifier** searches the whole catalogue, with filters by hero, card
  type, size, rarity and effect;
- the **options** menu sets where the sheet appears, its text size, its colour
  and its font;
- the **globe** changes the display language.

Those preferences are kept in the browser and follow the viewer from one
channel to the next.

## What the mod does, and does not

The extension needs to know what is on the board, and only the game knows that.
A BepInEx mod supplies it.

Once per second, it reads the streamer's board, stash, skills and hero by
reflection, along with the facing row — the opponent's board during a fight,
and the cards a shop or an event puts on the table. It writes them to a JSON
file, which is what the companion app broadcasts. Nothing else is read.

Reading the facing row is new in 2.0; version 1.0.0 only read the streamer's
own side. Everything captured is on the streamer's screen at the moment it is
read, so viewers see nothing they could not see by watching the stream. Cards
still hidden from the player — an unrevealed hand, an unopened chest — are not
read.

It does **not** write to the game, patch any code, hook game logic, intercept
network traffic, or send any input.

The mod contains one further routine, **off by default**, which enumerates the
game's card catalogue. It only runs when an empty file named
`extraire-catalogue` is placed next to the DLL, which the installer never
creates. It exists so the maintainer can regenerate the card pages after a game
update; streamers have no use for it, and it stays dormant on their machines.

The full technical description is in
[docs/DIVULGATION-TECHNIQUE.md](docs/DIVULGATION-TECHNIQUE.md).

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

The message sent to Twitch carries positions and card identifiers, where the
game sits inside the streamer's scene, and the broadcast delay the streamer
declared:

```json
{"v":2,"lang":"fr","b":[{"s":0,"n":2,"id":"a05d23cb-...","e":"Golden","q":"Gold"}],
 "k":[{"s":0,"id":"73722d74-...","q":"Diamond"}],"d":30}
```

Descriptions and artwork are fetched by the extension from static hosting, not
by the app. That is what keeps the app tiny and the bandwidth near zero: the
same message serves one viewer or thirty thousand, because Twitch does the
fan-out.

## Delays

The opponent's board is held back for ten seconds from the start of a fight
between players, and two seconds against a monster. Everything else — the
streamer's own board, stash, skills, shops and events — is sent without delay,
since it is already on screen.

A streamer who broadcasts on a delay declares it in the app, and that delay adds
to the hold.

## The relay, and why it exists

A Twitch extension has a single signing secret. If every streamer's copy signed
its own messages, that secret would have to ship inside the executable — and an
executable can be decompiled. Anyone could then broadcast fake boards on any
user's channel.

So the secret lives in a Cloudflare Worker instead. Streamers authenticate with
Twitch, the relay derives a personal token from their channel id by HMAC, and
hands out a Twitch token valid for 25 minutes. The app then talks to Twitch
directly.

No database: tokens are derived, not stored, so the relay recomputes them to
verify. Three relay calls per hour per streamer, which fits several thousand
users inside Cloudflare's free tier.

## Privacy

The extension collects nothing about viewers. No trackers, no advertising
cookies, no identity request. The only things kept in a viewer's browser are
their display preferences: language, placement, size, colour, font, and whether
they have seen the first-visit hint.

The companion app sends the board and nothing else — not combat state, not
health, not resources, not personal data. Its Twitch authorisation identifies
the channel and can be revoked at any time from Twitch account settings.

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
repository — nothing is read from a viewer's or a streamer's machine.

## About

Bazaar Scanner is an independent community project, built with the agreement of
the game's developers. It has no official connection to Tempo Storm or to
Twitch.

## Licence

MIT. See [LICENSE](LICENSE).

# Bazaar Scanner — technical description

This document sets out exactly what the tool reads from the game, what it does
with it, and what it never touches.

It is written for anyone who wants to check for themselves: a streamer wary of
what runs on their machine, a developer of the game, or anyone reading the
source.

A French version is in [DIVULGATION-TECHNIQUE.md](DIVULGATION-TECHNIQUE.md).

## In one sentence

A read-only BepInEx mod samples what is on the streamer's screen once per
second and passes it to a Twitch extension, so that viewers can read the
translated description of cards they are already looking at.

## Architecture

Three components:

1. **BepInEx mod** (`BazaarScannerBridge`, C#, BepInEx 5.4.23.5), loaded into
   the game process. Writes a JSON file inside its own folder.
2. **Companion application** (Node.js), which reads that file and broadcasts it
   on the channel's Twitch PubSub topic.
3. **Twitch extension**, which shows a card's sheet when a viewer hovers over
   it in the video player.

## What the mod reads

A MonoBehaviour `Update()` method, throttled to **one read per second**, by
reflection over already-instantiated objects.

### Access points

- `Data.Run.Player.Hand` — the player's board
- `Data.Run.Player.Stash` — their stash
- `Data.Run.Player.Skills` — their skills
- `Data.Run.Player.Hero` — their hero
- `Data.Run.Player.Socket` — socket effects
- `Data.Run.Opponent` — whatever faces the player

### The facing row

Since version 2.0, the mod also samples what faces the player: the opponent's
board during a fight, the items a shop offers, the choices an event presents.

**This is a change from version 1.0, which read only the player's own side.**
All of it is on the streamer's screen at the moment it is read: the mod reveals
nothing a viewer could not see by watching the stream.

Nothing hidden from the player is read — not an opponent's hand before it is
revealed, not the contents of an unopened chest, not the outcome of a fight in
progress.

The extension additionally holds the opponent's board back for ten seconds at
the start of a fight between players, and two seconds against a monster, so
that the broadcast never runs ahead of what viewers see.

### Fields sampled, per card

| Field | Source |
|---|---|
| `Template.Id` | card identifier |
| `Template.InternalName` | internal name |
| `Template.Localization.Title` | localised title |
| `Size`, `Tier`, `Enchantment` | state of the owned copy |
| `Socket` | position |
| `Template.ArtKey` | artwork reference |
| `SocketEffects` | musical notes, stove, cooler |

### Card definitions

The mod holds a routine, **off by default**, which enumerates the game's
catalogue and serialises each card's text to a local file.

It only runs when an empty file named `extraire-catalogue` sits next to the
DLL, which the installer never creates. It exists so the tool's author can
regenerate the card pages after a game update; it is of no use to a streamer
and stays dormant on their machine.

What it captures is **static content** — identical for every player — not
information about a run.

### Database

The tool extracts `TheBazaar_Data/StreamingAssets/GameData.db.zip`, shipped
with the game, into its own folder and opens it **read-only** (SQLite). The
game's own file is never modified.

## What the mod does NOT do

- **No writes to the game.** No memory modification, no state alteration, no
  value handed back to the game.
- **No code patching.** No Harmony, no hooks on game logic. Reflection reads
  only.
- **No network interception.** No packet reading, no proxy.
- **No hidden information.** Everything sampled is already drawn on the
  player's screen, and therefore already visible to their viewers.
- **No automation.** The mod sends no input to the game, clicks nothing,
  recommends no play.
- **No writes outside its own folder.** The two files it produces live in
  `BepInEx/plugins/BazaarScannerBridge/`.

## What leaves the streamer's machine

At most once per second, a message of roughly 2 to 4 KB is broadcast on the
channel's Twitch topic:

```json
{"v":2,"lang":"fr",
 "b":[{"s":0,"n":2,"id":"<TemplateId>","e":"Golden","q":"Gold"}],
 "k":[{"s":0,"id":"<TemplateId>","q":"Diamond"}],
 "f":[{"s":3,"n":2,"id":"<TemplateId>"}],
 "d":30}
```

That is: position, size, identifier, enchantment and tier, for the board, the
stash, the skills and the facing row; plus the broadcast delay the streamer
declared.

No combat state, no health, no resources, no personal data.

Descriptions and artwork are served separately from public static hosting. They
are derived from `GameData.db`, that is, from the game's own data.

## Distribution

The tool ships to streamers as a Windows installer. The mod is compiled by the
author. The Twitch extension is published, and submitted to Twitch review at
each version.

The source for all of it — mod, application, extension, relay — is public:
https://github.com/Kwev-Bzr/bazaar-scanner

## Contact

Any question or objection from the game's developers will be handled without
delay, including the removal of any feature that proves troublesome.

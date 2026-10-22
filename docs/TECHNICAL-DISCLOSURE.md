# Bazaar Scanner - technical description

Version 3.0 - updated 12 October 2026

This document sets out exactly what the tool reads from the game, what it does
with it, and what it never touches.

It's here for anyone who wants to check for themselves, whether a streamer
wondering what runs on their machine or one of the game's developers.

A French version is in [DIVULGATION-TECHNIQUE.md](DIVULGATION-TECHNIQUE.md).

## In one sentence

A read-only BepInEx mod samples what is on the streamer's screen once per
second and passes it to a Twitch extension, so that viewers can read the
translated description of cards they are already looking at.

## No data is kept

Bazaar Scanner keeps nothing about anyone. I run no server that records
anything, no database and no analytics, and I don't sell or share any data.
The point is to show cards, not to track players.

In practice:

- **Viewers**: the extension doesn't know their Twitch identity and sends
  nothing about them. Only their display preferences (language, size,
  theme…) stay in their own browser.
- **Streamers**: the relay that issues the Twitch token computes it on the fly
  and stores it nowhere. It has no database and no log. Everything that gets
  written stays on the streamer's PC (the app's settings, the history of the
  current run, the mod's files in the game folder), and none of it leaves
  their machine.
- **Runs**: the message sent over Twitch is broadcast live to viewers, then
  replaced by the next one. I keep no copy of it, and no run history is built
  anywhere other than on the streamer's PC.

Card sheets and artwork are served by Cloudflare, which, like any host, may
keep its own technical logs. Those requests carry no identifier: they ask for
a card, not for a person.

## Architecture

Three components:

1. **BepInEx mod** (`BazaarScannerBridge`, C#, BepInEx 5.4.23.5), loaded into
   the game process. Writes a JSON file inside its own folder.
2. **Companion application** (Node.js), which reads that file and broadcasts it
   on the channel's Twitch PubSub topic.
3. **Twitch extension**, which shows a card's sheet when a viewer hovers over
   it in the video player.

## What the mod reads

A MonoBehaviour `Update()` method, throttled to **one read per second**, using
reflection on objects the game has already created.

### Access points

- `Data.Run.Player.Hand`: the player's board
- `Data.Run.Player.Stash`: their stash, including while the chest is closed
- `Data.Run.Player.Skills`: their skills
- `Data.Run.Player.Hero`: their hero
- `Data.Run.Player.Socket`: socket effects
- `Data.Run.Opponent`: whatever faces the player, and the opponent's skills
  during a fight
- the number of victories, the remaining prestige and its maximum, the
  current day and the game mode (normal, ranked or tournament), always shown
  on the game's screen
- `Application.version`: the game's version number, read once at startup for
  the app's Diagnostics page. It is never sent to Twitch.

On the main menu, the game keeps the last run in memory, but its hero reads
"Common". The application treats that state as "not in a run": it then sends
no day and no counters, and the extension hides the win count row and the
help areas.

### The facing row

The mod reads whatever faces the player: the opponent's board during a fight,
their skills, the items a shop offers, an event's choices. All of it is on the
streamer's screen when it is read: the mod reveals nothing a viewer could not
see by watching the stream.

Nothing hidden from the player is read: not the opponent's hand before it is
revealed, not the contents of an unopened chest, not the outcome of a fight
in progress.

The extension also holds back the opponent's board for ten seconds at the
start of a fight between players, and two seconds against a monster, so that
the broadcast never runs ahead of what viewers see.

### Fields read, per card

| Field | Source |
|---|---|
| `Template.Id` | card identifier |
| `Template.InternalName` | internal name |
| `Template.Localization.Title` | localised title |
| `Size`, `Tier`, `Enchantment` | state of this copy |
| `Socket` | position |
| `Template.ArtKey` | artwork reference |
| `SocketEffects` | notes, furnace, cooler |
| `Attributes`: `CritChance`, `Multicast`, `CooldownMax`, `AmmoMax` | current crit chance, Multicast, cooldown and ammo |
| `Tags` (compared with the template's) | tags gained during the run |
| `Quests` | this copy's quest progress |
| tooltip values | the numbers the game's own tooltip shows |

### New in 3.0: a card's current values

A card changes over a run: its damage grows, so does its crit chance, a quest
progresses, some items gain or lose Multicast during a fight. The game shows
these values in the card's tooltip when the streamer hovers it.

So that the sheet shows the same thing, the mod reads crit chance, Multicast,
cooldown and ammo from the card's attributes, its quest progress, and the numbers in
its tooltip. For the latter, it calls the functions the game itself uses to
prepare that tooltip (`CardTooltipData.CreateCardTooltipData`, then
`Resolve()` on each value) and keeps only the resulting numbers. These
functions build text; they change neither the card nor the run.

These are exactly the values the player sees by hovering the card in game.

An event's choices work a little differently: their value depends on the run,
such as "gain 2 prestige for each player fight you have lost this run". For
these, the mod computes the value the way the game does, from the same run
counter the game uses for that tooltip (here, player fights lost), multiplied
by the number written in the card. It only reads that counter.

### Card definitions

To regenerate the card sheets after a game update, I use a routine that walks
the game's catalogue and saves each card's text to a local file.

It only exists in my own development build of the mod. **The mod distributed
to streamers doesn't contain it**, nor any of the diagnostic probes I use
while developing.

What it reads is **static**, identical for every player, and not run
information.

### Database

The tool extracts `TheBazaar_Data/StreamingAssets/GameData.db.zip`, shipped
with the game, into its own folder, and opens it **read-only** (SQLite). The
game's own file is never modified.

## What the mod does not do

- **It doesn't write to the game.** Memory and game state are left untouched,
  and no value is passed back to the game.
- **It doesn't patch any code.** There's no Harmony and no hook on game logic,
  only reads through reflection, plus the tooltip-building calls described
  above.
- **It doesn't intercept network traffic**, read packets or go through a
  proxy.
- **It doesn't read anything hidden.** Everything it reads is already on the
  player's screen, or in the tooltip they get by hovering a card.
- **It doesn't play for you.** It sends no input to the game, clicks nothing
  and never suggests a move.
- **It stays in its own folder.** The files it creates all live in
  `BepInEx/plugins/BazaarScannerBridge/`.
- **Its load doesn't grow over time.** It only keeps the current read in
  memory, and limits what it writes to the BepInEx log: an error that keeps
  happening is logged three times, then once every two hundred times.

## What leaves the streamer's machine

At most once per second, a message of at most 5 KB is broadcast on the
channel's Twitch PubSub topic. When nothing changes, it is re-sent every two
seconds for viewers who join midway:

```json
{"v":4,"lang":"fr","h":"Vanessa",
 "b":[{"s":0,"n":2,"id":"1a2b3c4d","e":"Golden","q":"G",
       "cc":25,"mc":2,"qp":"3/5","jv":"a1=12"}],
 "k":[{"s":0,"id":"5e6f7a8b","q":"D"}],
 "r":[{"s":0,"id":"9c0d1e2f","q":"S"}],
 "f":[{"s":3,"n":2,"id":"3a4b5c6d","e":"Shiny"}],
 "vi":5,"pr":15,"px":20,"m":"r","j":9,"hj":"vdvvdvvv",
 "d":300}
```

That is, for the board (`b`), skills (`k`), stash (`r`) and facing row (`f`,
`fk`): each card's position, size, shortened identifier, enchantment and
rarity; for items, their crit chance (`cc`), Multicast (`mc`), cooldown
(`cd`), ammo (`am`), tags gained during the run (`ta`), quest progress (`qp`) and tooltip values (`jv`). Plus the hero being played (`h`), the number
of victories (`vi`), remaining prestige and its maximum (`pr`, `px`), ranked
or tournament mode (`m`), the current day (`j`) and the result of each day already played
(`hj`, one letter per day: win, loss, death averted), worked out from
victories and prestige, the
language, where the game sits in the streamer's scene (`c`), and the broadcast
delay they declared (`d`).

Health, resources (gold, income, level) and personal data are not part of it. Victories
and prestige are the ones the game's screen always shows; nothing is said
about a fight in progress.

If the streamer sets a tournament delay, the application holds each message
back for that long before sending it.

Card descriptions and artwork are served separately from public static
hosting. They are derived from `GameData.db`, that is, from the game's own
data.

The message is kept as short as possible: a card identifier cut to its first
eight characters, rarity as one letter, size and crit chance left out when
they hold the default value. An ordinary message weighs 1 to 3 KB.

## What else the extension receives

Apart from the message above, the extension only downloads public, static
files from `bazaar-scanner.pages.dev`: card sheets, their artwork, and display
settings (themes, interface text, slot layout, and the help text for the
victory counter, prestige, income and bank, taken from the game's own
tooltips). These are JSON data and
images; no code is loaded remotely. Fonts come from Google Fonts, through a
fixed link written into the extension.

## What else the application does

- **Published version.** At startup, then every six hours, it reads the
  public index on `bazaar-scanner.pages.dev` to find out whether a newer
  version exists. If so, a light says so in its window. This request carries
  no identifier.
- **Update.** Only if the streamer clicks that light and confirms, the
  application downloads the latest installer from the public GitHub
  repository's releases page. It runs it only if its SHA-256 fingerprint
  matches the one published with the version number, and never while the game
  is open. Windows then asks for permission to install, as with a manual
  installation. Nothing is downloaded or installed without that click.
- **Diagnostics.** Its Diagnostics page gathers local information: DLL and
  game versions, mod file dates, the last read of the game, relay status,
  number of messages sent and any rejection by Twitch, size of the last
  message. None of it is sent anywhere; the "Copy diagnostics" button puts it
  on the streamer's clipboard, for them to use as they see fit.
- **Local window.** Its window is a page served on `127.0.0.1`. It only
  accepts requests addressed to that address, and actions that read or change
  the configuration require a secret drawn at each launch. The application
  stops when its last window closes.

## Distribution

The tool is distributed to streamers as a Windows installer, which supports
both the Steam version of the game and the Tempo launcher. The mod is compiled
by the author. Uninstalling removes the mod from both. The Twitch extension is
published and goes through Twitch's review for every version.

The source for everything (mod, application, extension, relay) is public:
https://github.com/Kwev-Bzr/bazaar-scanner

## Contact

Any question or objection from the game's developers will be handled without
delay, including removing a feature that causes concern.

BAZAAR SCANNER 3.0
==================

Lets your viewers hover the cards of your run during your stream and read
what they do, in their own language.

Bazaar Scanner works with The Bazaar installed by Steam as well as by the
Tempo launcher. Setup will ask which one you use, and can handle both if
you switch between them.

ANTIVIRUS NOTICE: setup places winhttp.dll in the game folder. That file
belongs to BepInEx, the mod loader, and carries the name of a system
component so that Windows loads it when the game starts. Because malware
uses the same technique, some antivirus products flag it. The installer is
not digitally signed either, which triggers a SmartScreen warning. Both
alerts are expected. The source code is published:
https://github.com/Kwev-Bzr/bazaar-scanner


SETUP
-----

1. THE MOD

   Setup places BepInEx in the game folder, and the BazaarScannerBridge.dll
   mod in:

     <game>\BepInEx\plugins\BazaarScannerBridge\

   Without it, the tool sees nothing.

2. THE TOOL

   Start Bazaar Scanner. On first launch, the window asks you to log in to
   Twitch: click CONNECT, authorise in your browser, and you're done. There's
   nothing to copy or type.

   The game folder is detected automatically in most cases.

3. THE TWITCH EXTENSION

   From your channel's extension manager, install Bazaar Scanner and
   activate it in an Overlay slot.


USING IT
--------

Start the tool before or during your run, it doesn't matter. It must keep
running for the whole stream: the extension only shows what it sends.

Closing the window closes the tool.


THE WINDOW
----------

The menu on the left leads to six pages.

  RUN
     What your viewers can hover: a summary of the run (one dot per day,
     hero, wins, losses, prestige, mode), what faces you, your board, your
     stash and your skills. Below, the run log lists new runs, each day's
     result and skills that move up a rarity.

  TWITCH ACCOUNT
     The connected channel, and the button to log in.

  GAME FOLDER
     Steam or Tempo launcher, and the folder of each. A light shows whether
     the mod is installed in the selected game.

  LAYOUT
     If the game does not fill your whole OBS scene. Paste a screenshot of
     your OBS PREVIEW (Ctrl+V), place the rectangle over your item row, then
     SAVE. CANCEL goes back to the saved layout.

  DELAY
     The stream delay. By default, cards appear for each viewer at the same
     moment as in their video: leave it on "No delay". If you delay your
     stream yourself in OBS, for a tournament or so that an opponent cannot
     watch your run, choose the same delay here: 1, 5, 10 or 30 minutes, or
     Custom, in seconds.

  DIAGNOSTICS
     Everything to check when nothing works: versions, mod, Twitch relay,
     messages sent. COPY DIAGNOSTICS copies it as text, to paste in a message
     if you ask for help.

At the bottom left:

  - a gold "Update" light, only when a newer version is published. One
    click opens the download page;
  - the status light, with its details underneath;
  - the window's language.


THE STATUS LIGHT
----------------

  green   everything works
  orange  waiting: game not running, no run in progress, or Twitch not
          connected yet
  red     connection problem, the reason is shown underneath


WHAT YOUR VIEWERS SEE
---------------------

Hovering a card
   The card sheet appears: translated description, per-tier values or the
   current run's values, coloured keywords, enchantment variants.

Clicking a card
   The sheet stays in place, with one button per enchantment. Click again,
   or anywhere else, to release it.

Stash drawer
   The ten slots of your stash, even with the chest closed.

Win count
   A row at the top or bottom of the video: the result of each day played.

The game's counters
   Hovering the victory counter, prestige gauge, income or bank explains
   them, with the game's own text.

Magnifier button
   Search across the full catalogue, including card text, with filters by
   hero, type, size, rarity and effect.

Options button
   Display language (among eight), theme, sheet placement, size and font,
   stash, win count. These settings belong to the viewer.


WHAT IS SENT
------------

The layout of your run: the cards on your board, in your stash and among
your skills, and whatever faces you, with their place, rarity, enchantment
and the values the game shows in their tooltip. Plus the counters the game
always shows on screen: victories, prestige, current day, each day's result,
mode.

Health, gold and personal data are never sent. Everything that goes out is
already visible on your viewers' screens.

The extension also downloads card descriptions from
bazaar-scanner.pages.dev. That data is public and identical for everyone;
it holds nothing about you.

The Twitch authorisation only identifies your channel. It gives no access
to your account, your chat or your revenue, and can be revoked at any time
from your Twitch account settings.

Your token can only broadcast to your own channel.


FILES
-----

  BazaarScanner.exe       the application
  interface.html          its window
  config.ini              created on first run, holds your settings
  partie-en-cours.json    the history of the current run, so it survives
                          a restart of the tool


COMMON PROBLEMS
---------------

  "Game not found"
     Open GAME FOLDER and enter the game folder manually. It's the one
     containing TheBazaar.exe.

  "Waiting for the game" while the game is running
     The mod isn't installed, or not in the right place. Open DIAGNOSTICS:
     the "DLL version" line should read 3.0.0. If not, run setup again.

  "DLL version" reported as out of date
     The game mod is older than the tool. Run setup again.

  "Interrupted"
     The line under the status light gives the reason. A network problem
     clears up on its own once the connection is back.

  Nothing shows on stream
     Check that the extension is activated in an Overlay slot on your
     channel, and that the tool's status light is green.

  Need help
     Open DIAGNOSTICS, click COPY DIAGNOSTICS, and paste the text in your
     message.

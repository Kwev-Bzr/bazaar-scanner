BAZAAR SCANNER
==============

Lets your viewers hover the cards on your board during your stream and read
what they do, in their own language.

IMPORTANT: Bazaar Scanner only works with the STEAM version of the game.
It reads The Bazaar from the Steam folder and cannot work with an
installation from anywhere else.

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

   BepInEx must be installed in the game folder, and BazaarScannerBridge.dll
   placed in:

     <game>\BepInEx\plugins\BazaarScannerBridge\

   Without it, the tool sees nothing.

2. THE TOOL

   Run BazaarScanner.exe. A small window opens.
   Click SETUP, then CONNECT WITH TWITCH: your browser opens, you authorise,
   and that's it. Nothing to copy, nothing to type.

   The game folder is detected automatically in most cases.

3. THE TWITCH EXTENSION

   From your channel's extension manager, install Bazaar Scanner and activate
   it in an Overlay slot.


USING IT
--------

Start the tool before or during your run, it doesn't matter. The window shows
your board and your skills, so you can check at a glance that what is being
broadcast matches your game.

Closing the window closes the tool.


SETTINGS
--------

The CONFIGURATION window holds the settings sent to the extension:

  Stream delay
     Offset, in seconds, between what you see and what your viewers see.

     Low-latency streams need about 2 seconds; otherwise count 30. Buttons
     offer the common values; "Custom" applies the number of seconds typed
     in the adjacent box.

  Interface language
     Eight languages are available. Viewers may switch on their side
     without affecting anyone else.


WHAT YOUR VIEWERS SEE
---------------------

Hovering a card
   The card sheet appears: translated description, per-tier values,
   coloured keywords, enchantment variants.

Magnifier button
   Search across the full catalogue. Viewers can look up any item or skill,
   even one not on the board, with filters by hero, type, size, rarity and
   effect.

Options button
   Card placement, text size, colour and font. These settings belong to the
   viewer; the streamer has no say in them.

Globe button
   Display language.

A short hint appears on the first visit and can be reopened from the
options menu.


THE INDICATOR
-------------

  green   everything works
  orange  waiting: game not running, no run in progress, or Twitch not
          connected yet
  red     connection problem, the reason is shown underneath


WHAT IS SENT
------------

Only your board layout: which items, where, at what tier and with which
enchantment. Nothing else.

No combat state, no health, no gold, no personal data. Everything sent is
already visible on your viewers' screens.

The extension also downloads card descriptions from
bazaar-scanner.pages.dev. That data is public and identical for everyone;
it holds nothing about you.

The Twitch authorisation only identifies your channel. It gives no access to
your account, your chat or your revenue, and can be revoked at any time from
your Twitch account settings.

Your token can only broadcast to your own channel.


FILES
-----

  BazaarScanner.exe   the application
  interface.html      its window
  config.ini          created on first run


COMMON PROBLEMS
---------------

  "Game not found"
     Open SETUP and enter the game folder manually. It's the one containing
     TheBazaar_Data.

  "Waiting for the game" while the game is running
     The mod isn't installed, or not in the right place. Check that
     BazaarScannerBridge.dll sits in BepInEx\plugins\BazaarScannerBridge\

  "Interrupted"
     The line under the indicator gives the reason. A network problem clears
     up on its own once the connection is back.

  Nothing shows on stream
     Check that the extension is activated in an Overlay slot on your channel,
     and that the tool's indicator is green.

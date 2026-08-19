BAZAAR SCANNER
==============

Lets your viewers hover the cards on your board during your stream and read
what they do, in their own language.


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

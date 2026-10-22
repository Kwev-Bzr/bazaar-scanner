/* Twitch exige que la page confirme son chargement, faute de quoi le
   gestionnaire d'extensions affiche un écran d'attente indéfini. Aucune
   donnée n'est lue ni écrite : cette page ne fait qu'expliquer.

   Dans un fichier à part : la politique de sécurité des extensions
   hébergées refuse les scripts écrits dans la page. */
if (window.Twitch && window.Twitch.ext) {
  window.Twitch.ext.onAuthorized(function () { /* rien à charger */ });
}

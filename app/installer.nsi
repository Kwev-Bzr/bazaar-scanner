; ─────────────────────────────────────────────────────────────
;  BAZAAR SCANNER, Installateur Windows (v1.1)
;  - Choix du dossier d'installation de l'outil
;  - Choix du dossier du jeu The Bazaar (écrit dans config.ini)
;  - Installe BepInEx 5.4.23.5 dans le jeu (optionnel)
;  - Installe le mod + traductions FR dans BepInEx\plugins (optionnel)
;  - Installe le dossier assets (items_map, skills_map, images...)
;  - Copie automatiquement les fichiers placés À CÔTÉ du setup :
;      BazaarScannerBridge.dll, assets\, ngrok.exe
; ─────────────────────────────────────────────────────────────
Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"
!include "FileFunc.nsh"
${StrStr}
${StrTok}
${StrRep}

Name "Bazaar Scanner"
OutFile "BazaarScanner_setup.exe"
InstallDir "$PROGRAMFILES64\Bazaar Scanner"
; Version installée, passée par build.sh depuis le fichier VERSION.
!ifndef VERSION_APP
  !define VERSION_APP "0.0.0"
!endif

InstallDirRegKey HKLM "Software\BazaarScanner" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

Var GameDir        ; dossier employé par les sections d'installation
Var SteamDir       ; The Bazaar installé par Steam
Var TempoDir       ; The Bazaar installé par le client Tempo
Var Source         ; « steam », « tempo » ou « les deux »

; Les boutons de la page de choix.
Var RadioSteam
Var RadioTempo
Var RadioDeux

; Ce que l'assistant écrira dans config.ini.
Var CfgSteam
Var CfgTempo
Var Retenue        ; « steam » ou « tempo » : ce que l'application lira

; Une installation RÉELLEMENT trouvée, par opposition à un chemin seulement
; proposé par défaut. C'est elle qui décide du bouton présélectionné.
Var SteamTrouve
Var TempoTrouve

; Mode « mise à jour » (/MAJ) : lancé par l'application elle-même, sans pages.
; Il reprend le dossier de l'outil et les chemins du jeu déjà configurés.
Var Maj
Var MajDir
Var MajSteam
Var MajTempo

; ── Apparence ──
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC

; ── Pages de l'assistant ──
!define MUI_WELCOMEPAGE_TITLE "$(TITRE_BIENVENUE)"
!define MUI_WELCOMEPAGE_TEXT "$(TEXTE_BIENVENUE)"
!define MUI_PAGE_CUSTOMFUNCTION_PRE PasserSiMaj
!insertmacro MUI_PAGE_WELCOME

; À lire AVANT l'installation : le LISEZMOI est affiché dans l'assistant
!define MUI_PAGE_HEADER_TEXT "$(TITRE_LISEZMOI)"
!define MUI_PAGE_HEADER_SUBTEXT "$(SOUS_LISEZMOI)"
!define MUI_LICENSEPAGE_TEXT_TOP "$(HAUT_LISEZMOI)"
!define MUI_LICENSEPAGE_TEXT_BOTTOM " "
!define MUI_LICENSEPAGE_BUTTON "Suivant >"
!define MUI_PAGE_CUSTOMFUNCTION_PRE PasserSiMaj
!insertmacro MUI_PAGE_LICENSE "LISEZMOI.txt"

!define MUI_PAGE_CUSTOMFUNCTION_PRE PasserSiMaj
!insertmacro MUI_PAGE_COMPONENTS

; Page 1 : dossier d'installation de l'outil
!define MUI_PAGE_HEADER_TEXT "$(TITRE_DOSSIER_APP)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(HAUT_DOSSIER_APP)"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "$(DEST_APP)"
!define MUI_PAGE_CUSTOMFUNCTION_PRE PasserSiMaj
!insertmacro MUI_PAGE_DIRECTORY

; Page 2 : Steam, client Tempo, ou les deux ?
Page custom PageSource PageSourceLeave

; Page 3 : dossier du jeu Steam, sautée si le joueur n'emploie pas Steam
!define MUI_PAGE_HEADER_TEXT "$(TITRE_DOSSIER_STEAM)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(HAUT_DOSSIER_STEAM)"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "$(DEST_JEU)"
!define MUI_DIRECTORYPAGE_VARIABLE $SteamDir
!define MUI_PAGE_CUSTOMFUNCTION_PRE   PreDossierSteam
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckSteamDir
!insertmacro MUI_PAGE_DIRECTORY

; Page 4 : dossier du jeu Tempo, sautée si le joueur n'emploie pas Tempo
!define MUI_PAGE_HEADER_TEXT "$(TITRE_DOSSIER_TEMPO)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(HAUT_DOSSIER_TEMPO)"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "$(DEST_JEU)"
!define MUI_DIRECTORYPAGE_VARIABLE $TempoDir
!define MUI_PAGE_CUSTOMFUNCTION_PRE   PreDossierTempo
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckTempoDir
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\BazaarScanner.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(LANCER)"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LISEZMOI.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(VOIR_LISEZMOI)"
!define MUI_PAGE_CUSTOMFUNCTION_PRE PasserSiMaj
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; L'anglais EN PREMIER : NSIS retient la première langue déclarée comme
; langue par défaut. Le français reste proposé pour qui le préfère.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"

; ── Textes, dans les deux langues ──
LangString TITRE_BIENVENUE   ${LANG_ENGLISH} "Welcome to the Bazaar Scanner setup"
LangString TITRE_BIENVENUE   ${LANG_FRENCH}  "Bienvenue dans l'installation de Bazaar Scanner"

LangString TEXTE_BIENVENUE   ${LANG_ENGLISH} "This wizard will install Bazaar Scanner, the Twitch extension for The Bazaar, along with BepInEx and the mod it needs inside the game.$\r$\n$\r$\nIt works with the game installed by Steam as well as by the Tempo launcher. You will be asked which one you use.$\r$\n$\r$\nPlease close the game and OBS before continuing."
LangString TEXTE_BIENVENUE   ${LANG_FRENCH}  "Cet assistant va installer Bazaar Scanner, l'extension Twitch pour The Bazaar, ainsi que BepInEx et le mod nécessaires côté jeu.$\r$\n$\r$\nIl fonctionne avec le jeu installé par Steam comme par le client Tempo. Il vous sera demandé lequel vous utilisez.$\r$\n$\r$\nFermez le jeu et OBS avant de continuer."

LangString REMPLACER_VERSION ${LANG_ENGLISH} "Bazaar Scanner is already installed.$\r$\n$\r$\nThe previous version will be removed before the new one is installed. Your settings and the game folder are kept.$\r$\n$\r$\nContinue?"
LangString REMPLACER_VERSION ${LANG_FRENCH}  "Bazaar Scanner est déjà installé.$\r$\n$\r$\nLa version précédente va être retirée avant l'installation de la nouvelle. Vos réglages et le dossier du jeu sont conservés.$\r$\n$\r$\nContinuer ?"

LangString TITRE_LISEZMOI    ${LANG_ENGLISH} "Please read before installing"
LangString TITRE_LISEZMOI    ${LANG_FRENCH}  "À lire avant l'installation"

LangString SOUS_LISEZMOI     ${LANG_ENGLISH} "What this installer does, and what you will need."
LangString SOUS_LISEZMOI     ${LANG_FRENCH}  "Ce que fait l'installateur, et ce dont vous aurez besoin."

LangString HAUT_LISEZMOI     ${LANG_ENGLISH} "Read this information, then click Next."
LangString HAUT_LISEZMOI     ${LANG_FRENCH}  "Prenez connaissance de ces informations, puis cliquez sur Suivant."

LangString TITRE_DOSSIER_APP ${LANG_ENGLISH} "Where to install Bazaar Scanner"
LangString TITRE_DOSSIER_APP ${LANG_FRENCH}  "Dossier d'installation de Bazaar Scanner"

LangString HAUT_DOSSIER_APP  ${LANG_ENGLISH} "Choose the folder where Bazaar Scanner will be installed."
LangString HAUT_DOSSIER_APP  ${LANG_FRENCH}  "Choisissez le dossier où installer Bazaar Scanner."

LangString DEST_APP          ${LANG_ENGLISH} "Bazaar Scanner folder"
LangString DEST_APP          ${LANG_FRENCH}  "Dossier de Bazaar Scanner"

LangString DEST_JEU          ${LANG_ENGLISH} "Game folder"
LangString DEST_JEU          ${LANG_FRENCH}  "Dossier du jeu"

LangString LANCER            ${LANG_ENGLISH} "Launch Bazaar Scanner"
LangString LANCER            ${LANG_FRENCH}  "Lancer Bazaar Scanner"

LangString VOIR_LISEZMOI     ${LANG_ENGLISH} "Show the readme"
LangString VOIR_LISEZMOI     ${LANG_FRENCH}  "Afficher le fichier LISEZMOI"

; ── Page : quelle version du jeu ? ──
LangString TITRE_SOURCE      ${LANG_ENGLISH} "Which version of the game do you use?"
LangString TITRE_SOURCE      ${LANG_FRENCH}  "Quelle version du jeu utilisez-vous ?"

LangString SOUS_SOURCE       ${LANG_ENGLISH} "The Bazaar can be installed by Steam or by the Tempo launcher."
LangString SOUS_SOURCE       ${LANG_FRENCH}  "The Bazaar peut être installé par Steam ou par le client Tempo."

LangString HAUT_SOURCE       ${LANG_ENGLISH} "Tell us which version of the game you use, so the mod is installed in the right place."
LangString HAUT_SOURCE       ${LANG_FRENCH}  "Indiquez quelle version du jeu vous utilisez afin d'installer le mod au bon endroit."

LangString SOURCE_STEAM      ${LANG_ENGLISH} "Steam"
LangString SOURCE_STEAM      ${LANG_FRENCH}  "Steam"

LangString SOURCE_TEMPO      ${LANG_ENGLISH} "Tempo launcher"
LangString SOURCE_TEMPO      ${LANG_FRENCH}  "Client Tempo"

LangString SOURCE_DEUX       ${LANG_ENGLISH} "Both"
LangString SOURCE_DEUX       ${LANG_FRENCH}  "Les deux"

LangString NOTE_SOURCE       ${LANG_ENGLISH} "Choosing “Both” installs the mod in each folder. You can then switch from one to the other on the fly, in the companion app settings."
LangString NOTE_SOURCE       ${LANG_FRENCH}  "« Les deux » installe le mod dans chaque dossier. Vous pourrez passer au vol de l'un à l'autre dans les options de l'application compagnon."

LangString TITRE_DOSSIER_STEAM ${LANG_ENGLISH} "The Bazaar folder - Steam"
LangString TITRE_DOSSIER_STEAM ${LANG_FRENCH}  "Dossier de The Bazaar - Steam"

LangString HAUT_DOSSIER_STEAM  ${LANG_ENGLISH} "The folder holding TheBazaar.exe, as installed by Steam. It has been detected; change it only if it is wrong."
LangString HAUT_DOSSIER_STEAM  ${LANG_FRENCH}  "Le dossier qui contient TheBazaar.exe, tel que Steam l'a installé. Il a été détecté ; ne le changez que s'il est faux."

LangString TITRE_DOSSIER_TEMPO ${LANG_ENGLISH} "The Bazaar folder - Tempo launcher"
LangString TITRE_DOSSIER_TEMPO ${LANG_FRENCH}  "Dossier de The Bazaar - Client Tempo"

LangString HAUT_DOSSIER_TEMPO  ${LANG_ENGLISH} "The folder holding TheBazaar.exe, as installed by the Tempo launcher. It has been detected; change it only if it is wrong."
LangString HAUT_DOSSIER_TEMPO  ${LANG_FRENCH}  "Le dossier qui contient TheBazaar.exe, tel que le client Tempo l'a installé. Il a été détecté ; ne le changez que s'il est faux."

LangString PAS_LE_JEU        ${LANG_ENGLISH} "TheBazaar.exe is not in that folder.$\r$\n$\r$\nPick the folder holding TheBazaar.exe. Setup cannot continue otherwise."
LangString PAS_LE_JEU        ${LANG_FRENCH}  "TheBazaar.exe ne se trouve pas dans ce dossier.$\r$\n$\r$\nChoisissez le dossier qui contient TheBazaar.exe. L'installation ne peut pas continuer autrement."

LangString APP_OUVERTE       ${LANG_ENGLISH} "Bazaar Scanner is still running.$\r$\nClose it, then click Retry."
LangString APP_OUVERTE       ${LANG_FRENCH}  "Bazaar Scanner est encore ouvert.$\r$\nFermez-le, puis cliquez sur Réessayer."

LangString JEU_OUVERT        ${LANG_ENGLISH} "The Bazaar seems to be running.$\r$\nClose the game before continuing, otherwise the mod cannot be installed."
LangString JEU_OUVERT        ${LANG_FRENCH}  "The Bazaar semble ouvert.$\r$\nFermez le jeu avant de continuer, sinon le mod ne pourra pas être installé."

LangString DESC_APP          ${LANG_ENGLISH} "The BazaarScanner.exe application and its window. Installed in the folder you choose."
LangString DESC_APP          ${LANG_FRENCH}  "L'application BazaarScanner.exe et sa fenêtre. Installée dans le dossier de votre choix."

LangString DESC_BEPINEX      ${LANG_ENGLISH} "The BepInEx framework, required by the mod. Uncheck it if you already have it."
LangString DESC_BEPINEX      ${LANG_FRENCH}  "Le socle BepInEx, nécessaire au mod. Décochez-le si vous l'avez déjà."

LangString DESC_MOD          ${LANG_ENGLISH} "The mod that reads your board. Installed in the game folder."
LangString DESC_MOD          ${LANG_FRENCH}  "Le mod qui lit votre plateau. Installé dans le dossier du jeu."

LangString SUPPRIMER_CONFIG  ${LANG_ENGLISH} "Also delete your settings (Twitch token and calibration)?"
LangString SUPPRIMER_CONFIG  ${LANG_FRENCH}  "Supprimer aussi vos réglages (jeton Twitch et calibrage) ?"

;  ── Mode « mise à jour » ──────────────────────────────────────────────
; Les pages de l'assistant ne paraissent pas : tout est déjà connu.
Function PasserSiMaj
  StrCmp $Maj "1" 0 +2
    Abort
FunctionEnd

; Les chemins du jeu tels que l'application les emploie AUJOURD'HUI : le
; streamer a pu les changer depuis sa fenêtre après l'installation, et seul
; config.ini en garde la trace.
Function LireCheminsConfig
  StrCpy $MajSteam ""
  StrCpy $MajTempo ""
  ClearErrors
  FileOpen $0 "$MajDir\config.ini" r
  IfErrors fin_lecture
  boucle_lecture:
    ClearErrors
    FileRead $0 $1
    IfErrors fin_fichier
    ${StrRep} $1 $1 "$\r" ""
    ${StrRep} $1 $1 "$\n" ""
    StrCpy $2 $1 11
    StrCmp $2 "STEAM_PATH=" 0 +3
      StrCpy $MajSteam $1 "" 11
      Goto boucle_lecture
    StrCmp $2 "TEMPO_PATH=" 0 boucle_lecture
      StrCpy $MajTempo $1 "" 11
      Goto boucle_lecture
  fin_fichier:
    FileClose $0
  fin_lecture:
  ; Un chemin qui ne contient plus le jeu ne compte pas.
  StrCmp $MajSteam "" +3
    IfFileExists "$MajSteam\TheBazaar.exe" +2
      StrCpy $MajSteam ""
  StrCmp $MajTempo "" +3
    IfFileExists "$MajTempo\TheBazaar.exe" +2
      StrCpy $MajTempo ""
FunctionEnd

; L'application se ferme d'elle-même juste après avoir lancé la mise à jour.
; On attend que son exécutable soit libéré : tant qu'elle tourne, Windows
; refuse de le remplacer.
Function AttendreFermetureApp
  StrCpy $3 0
  attente_app:
    IfFileExists "$MajDir\BazaarScanner.exe" 0 app_fermee
    ClearErrors
    FileOpen $4 "$MajDir\BazaarScanner.exe" a
    IfErrors 0 app_libre
    IntOp $3 $3 + 1
    IntCmp $3 40 0 0 app_bloquee
    Sleep 250
    Goto attente_app
  app_bloquee:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(APP_OUVERTE)" IDRETRY recommencer_app
    Quit
  recommencer_app:
    StrCpy $3 0
    Goto attente_app
  app_libre:
    FileClose $4
  app_fermee:
FunctionEnd

; Teste si une racine Steam ($0) contient The Bazaar ; remplit $SteamDir si oui
Function CheckSteamRoot
  IfFileExists "$0\steamapps\common\The Bazaar\TheBazaar.exe" 0 +2
    StrCpy $SteamDir "$0\steamapps\common\The Bazaar"
FunctionEnd

; Cherche The Bazaar installé par le client Tempo.
;
; Le client se loge dans AppData\Roaming sous un nom qui varie avec la version
;, « Tempo Launcher - Beta », « Tempo Launcher - Internal Staging »). On balaie
; donc tout ce qui commence par « Tempo Launcher », et on retient le dossier le
; plus récemment modifié : c'est celui que le joueur emploie.
Function DetecterTempo
  StrCpy $TempoDir ""
  StrCpy $R5 ""        ; candidat de repli, si aucun client public n'est trouvé

  FindFirst $R1 $R2 "$APPDATA\Tempo Launcher*"
  boucle_tempo:
    StrCmp $R2 "" fin_tempo
    StrCmp $R2 "." suivant_tempo
    StrCmp $R2 ".." suivant_tempo

    StrCpy $R3 "$APPDATA\$R2\game\buildx64"
    IfFileExists "$R3\TheBazaar.exe" 0 suivant_tempo

      ; Les environnements de développement, « Internal Staging », ne sont
      ; pas ceux des joueurs. On les garde en repli, sans les préférer.
      ${StrStr} $R4 $R2 "Internal"
      StrCmp $R4 "" 0 repli_tempo
      ${StrStr} $R4 $R2 "Staging"
      StrCmp $R4 "" 0 repli_tempo

        StrCpy $TempoDir $R3
        Goto fin_tempo        ; un client public suffit

      repli_tempo:
        StrCmp $R5 "" 0 suivant_tempo
          StrCpy $R5 $R3

    suivant_tempo:
      FindNext $R1 $R2
      Goto boucle_tempo
  fin_tempo:
    FindClose $R1
    StrCmp $TempoDir "" 0 +2
      StrCpy $TempoDir $R5
FunctionEnd

; ── Page : Steam, client Tempo, ou les deux ? ──
Function PageSource
  StrCmp $Maj "1" 0 +2
    Abort
  !insertmacro MUI_HEADER_TEXT "$(TITRE_SOURCE)" "$(SOUS_SOURCE)"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "$(HAUT_SOURCE)"
  Pop $1

  ${NSD_CreateRadioButton} 10u 34u 90% 12u "$(SOURCE_STEAM)"
  Pop $RadioSteam
  ${NSD_CreateRadioButton} 10u 50u 90% 12u "$(SOURCE_TEMPO)"
  Pop $RadioTempo
  ${NSD_CreateRadioButton} 10u 66u 90% 12u "$(SOURCE_DEUX)"
  Pop $RadioDeux

  ; On propose ce qui a été TROUVÉ sur la machine, non ce qui est simplement
  ; proposé par défaut : sans quoi « Les deux » l'emportait toujours.
  ${If} $SteamTrouve != ""
  ${AndIf} $TempoTrouve != ""
    ${NSD_SetState} $RadioDeux ${BST_CHECKED}
  ${ElseIf} $TempoTrouve != ""
    ${NSD_SetState} $RadioTempo ${BST_CHECKED}
  ${Else}
    ${NSD_SetState} $RadioSteam ${BST_CHECKED}
  ${EndIf}

  ${NSD_CreateLabel} 0 86u 100% 30u "$(NOTE_SOURCE)"
  Pop $2

  nsDialogs::Show
FunctionEnd

Function PageSourceLeave
  ${NSD_GetState} $RadioSteam $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Source "steam"
    Return
  ${EndIf}

  ${NSD_GetState} $RadioTempo $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Source "tempo"
    Return
  ${EndIf}

  StrCpy $Source "les deux"
FunctionEnd

; ── Pages de dossier : chacune ne paraît que si elle sert ──
Function PreDossierSteam
  StrCmp $Maj "1" 0 +2
    Abort
  StrCmp $Source "tempo" 0 +2
    Abort          ; sautée
FunctionEnd

Function PreDossierTempo
  StrCmp $Maj "1" 0 +2
    Abort
  StrCmp $Source "steam" 0 +2
    Abort
FunctionEnd

; Le dossier doit contenir le jeu : sans lui, le mod serait posé dans le vide
; et le streamer resterait devant une fenêtre muette sans comprendre pourquoi.
; On refuse donc de continuer, au lieu de laisser passer sur un avertissement.
Function CheckSteamDir
  IfFileExists "$SteamDir\TheBazaar.exe" ok
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(PAS_LE_JEU)"
    Abort
  ok:
FunctionEnd

Function CheckTempoDir
  IfFileExists "$TempoDir\TheBazaar.exe" ok
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(PAS_LE_JEU)"
    Abort
  ok:
FunctionEnd

Function .onInit
  ; ── Mise à jour lancée par l'application ? ──
  StrCpy $Maj ""
  ReadRegStr $MajDir HKLM "Software\BazaarScanner" "InstallDir"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/MAJ" $R1
  IfErrors pas_de_maj
    ; Sans installation connue ni jeu retrouvé, l'assistant normal reprend
    ; la main : mieux vaut quelques pages qu'une installation au hasard.
    StrCmp $MajDir "" pas_de_maj
    Call LireCheminsConfig
    StrCmp "$MajSteam$MajTempo" "" pas_de_maj
    StrCpy $Maj "1"
    Call AttendreFermetureApp
  pas_de_maj:

  ; ── Version déjà installée ──
  ; On désinstalle avant de réinstaller : sans cela, les fichiers d'une
  ; ancienne version subsistent à côté des nouveaux.
  ReadRegStr $R9 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "UninstallString"
  StrCmp $R9 "" pasDeVersion

  ReadRegStr $R8 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayVersion"
  ; En mise à jour, le streamer a déjà confirmé dans l'application.
  StrCmp $Maj "1" +2
    MessageBox MB_YESNO|MB_ICONQUESTION "$(REMPLACER_VERSION)" IDNO pasDeVersion

  ReadRegStr $R7 HKLM "Software\BazaarScanner" "InstallDir"
  ; « _? » garde le désinstallateur en place le temps qu'il finisse.
  ExecWait '"$R9" /S _?=$R7'
  Delete "$R7\Uninstall.exe"

pasDeVersion:

  ; ── Détection automatique des deux installations ──
  StrCpy $SteamDir ""
  StrCpy $TempoDir ""
  Call DetecterTempo

  ; Racine Steam : registre utilisateur puis machine
  ReadRegStr $R0 HKCU "Software\Valve\Steam" "SteamPath"
  ${StrRep} $R0 $R0 "/" "\"
  StrCmp $R0 "" +2
    StrCpy $0 $R0
  StrCmp $R0 "" 0 +2
    ReadRegStr $R0 HKLM "SOFTWARE\WOW6432Node\Valve\Steam" "InstallPath"
  StrCmp $R0 "" no_steam
  StrCpy $0 $R0
  Call CheckSteamRoot
  StrCmp $SteamDir "" 0 detect_done

  ; Bibliothèques secondaires : steamapps\libraryfolders.vdf
  ClearErrors
  FileOpen $R1 "$R0\steamapps\libraryfolders.vdf" r
  IfErrors no_steam
  vdf_loop:
    FileRead $R1 $R2
    IfErrors vdf_close
    ${StrStr} $R3 $R2 '"path"'
    StrCmp $R3 "" vdf_loop
    ${StrTok} $R4 $R2 '"' '3' '0'
    ${StrRep} $R4 $R4 "\\" "\"
    StrCmp $R4 "" vdf_loop
    StrCpy $0 $R4
    Call CheckSteamRoot
    StrCmp $SteamDir "" vdf_loop vdf_close
  vdf_close:
    FileClose $R1
  no_steam:

  ; Ce qui a été trouvé, avant que les replis ne brouillent la distinction.
  StrCpy $SteamTrouve ""
  StrCmp $SteamDir "" +2
    StrCpy $SteamTrouve "1"
  StrCpy $TempoTrouve ""
  StrCmp $TempoDir "" +2
    StrCpy $TempoTrouve "1"

  ; Repli si rien trouvé : chemin Steam classique
  StrCmp $SteamDir "" 0 detect_done
    StrCpy $SteamDir "C:\Program Files (x86)\Steam\steamapps\common\The Bazaar"
  detect_done:

  ; Un chemin proposé pour Tempo même sans détection, plutôt qu'un champ vide.
  StrCmp $TempoDir "" 0 +2
    StrCpy $TempoDir "$APPDATA\Tempo Launcher\game\buildx64"

  ; Dossier d'installation par défaut : celui d'où l'installateur est lancé
  ; (sauf réinstallation : le chemin déjà enregistré est conservé)
  ReadRegStr $0 HKLM "Software\BazaarScanner" "InstallDir"
  StrCmp $0 "" 0 +2
    StrCpy $INSTDIR "$EXEDIR"

  ; La désinstallation qui précède efface la clé lue ci-dessus : le dossier
  ; déjà employé, relevé avant elle, est donc repris ici. Sans cela, une
  ; réinstallation proposait le dossier de l'installateur.
  StrCmp $MajDir "" +2
    StrCpy $INSTDIR $MajDir

  ; En mise à jour : les chemins du jeu de config.ini, sans rien demander.
  StrCmp $Maj "1" 0 fin_onInit
    StrCpy $SteamDir $MajSteam
    StrCpy $TempoDir $MajTempo
    StrCpy $Source "steam"
    StrCmp $MajSteam "" 0 source_steam
      StrCpy $Source "tempo"
      Goto fin_onInit
    source_steam:
    StrCmp $MajTempo "" fin_onInit
      StrCpy $Source "les deux"
  fin_onInit:
FunctionEnd

; En mise à jour, l'application est rouverte à la fin. Par l'Explorateur :
; lancée directement, elle hériterait des droits d'administrateur de
; l'installateur, ce qu'elle n'a pas à avoir.
Function .onInstSuccess
  StrCmp $Maj "1" 0 +2
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\BazaarScanner.exe"'
FunctionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 1, Application (obligatoire)
; ─────────────────────────────────────────────────────────────
Section "Bazaar Scanner" SecMain
  SectionIn RO

  ; Ce qui part dans config.ini : un chemin par version employée, vide pour
  ; l'autre. « SOURCE » désigne celle que l'application lit au démarrage ;
  ; le streamer peut ensuite basculer depuis la fenêtre.
  StrCpy $CfgSteam ""
  StrCpy $CfgTempo ""

  StrCmp $Source "tempo" 0 +2
    StrCpy $CfgTempo $TempoDir
  StrCmp $Source "steam" 0 +2
    StrCpy $CfgSteam $SteamDir
  StrCmp $Source "les deux" 0 +3
    StrCpy $CfgSteam $SteamDir
    StrCpy $CfgTempo $TempoDir

  ; « SOURCE » désigne la version que l'application lira au démarrage. Elle
  ; ne peut valoir « les deux » : quand le joueur emploie l'une et l'autre,
  ; Steam l'emporte, étant la plus répandue.
  StrCpy $Retenue "steam"
  StrCmp $CfgSteam "" 0 +2
    StrCpy $Retenue "tempo"

  StrCpy $GameDir $CfgSteam
  StrCmp $GameDir "" 0 +2
    StrCpy $GameDir $CfgTempo

  SetOutPath "$INSTDIR"

  ; Trois fichiers suffisent : l'exécutable, sa fenêtre, et les notices.
  ; config.ini est créé au premier lancement, ou ci-dessous avec le chemin
  ; du jeu confirmé dans cet assistant.
  File "BazaarScanner.exe"
  File "interface.html"
  File "LISEZMOI.txt"
  File "README.txt"
  File "icon.ico"

  ; ── config.ini ──
  ; BAZAAR_PATH est TOUJOURS réécrit avec le dossier confirmé ici : un fichier
  ; laissé par un essai précédent figerait sinon une valeur fausse pour
  ; toujours, même après que l'utilisateur a corrigé le chemin dans l'assistant.
  ; Le jeton Twitch, lui, est conservé, le perdre obligerait à se reconnecter.
  ; En mise à jour, config.ini est laissé tel quel : ses chemins viennent
  ; de lui, et la source choisie dans l'application (Steam ou Tempo) doit
  ; survivre à la mise à jour.
  StrCmp $Maj "1" 0 +3
    SetAutoClose true
    Goto config_fini
  IfFileExists "$INSTDIR\config.ini" maj_chemin creer_config

  creer_config:
    FileOpen $0 "$INSTDIR\config.ini" w
    FileWrite $0 "# Bazaar Scanner, configuration$\r$\n"
    FileWrite $0 "#$\r$\n"
    FileWrite $0 "# RELAY_TOKEN : rempli automatiquement par « Se connecter avec Twitch ».$\r$\n"
    FileWrite $0 "# STEAM_PATH  : The Bazaar installé par Steam.$\r$\n"
    FileWrite $0 "# TEMPO_PATH  : The Bazaar installé par le client Tempo.$\r$\n"
    FileWrite $0 "# SOURCE      : celle des deux que l'application lit, steam ou tempo.$\r$\n"
    FileWrite $0 "# BAZAAR_PATH : recopie de la source retenue ; l'application la tient à jour.$\r$\n"
    FileWrite $0 "# CADRE       : renseigné par le bouton Calibrer, pas à la main.$\r$\n"
    FileWrite $0 "$\r$\n"
    FileWrite $0 "RELAY_TOKEN=$\r$\n"
    FileWrite $0 "TWITCH_NOM=$\r$\n"
    FileWrite $0 "STEAM_PATH=$CfgSteam$\r$\n"
    FileWrite $0 "TEMPO_PATH=$CfgTempo$\r$\n"
    FileWrite $0 "SOURCE=$Retenue$\r$\n"
    FileWrite $0 "BAZAAR_PATH=$GameDir$\r$\n"
    FileWrite $0 "CADRE=$\r$\n"
    FileClose $0
    Goto config_fini

  maj_chemin:
    FileOpen $0 "$INSTDIR\config.ini" r
    FileOpen $1 "$INSTDIR\config.ini.tmp" w
    StrCpy $6 0
    boucle_config:
      FileRead $0 $3
      IfErrors fin_boucle_config
      ; Les quatre clés de chemin sont réécrites : un essai précédent
      ; figerait sinon une valeur fausse pour toujours.
      StrCpy $4 $3 11
      StrCmp $4 "STEAM_PATH=" 0 +3
        StrCpy $7 1
        Goto boucle_config
      StrCmp $4 "TEMPO_PATH=" 0 +3
        StrCpy $8 1
        Goto boucle_config

      StrCpy $4 $3 7
      StrCmp $4 "SOURCE=" 0 +3
        StrCpy $9 1
        Goto boucle_config

      StrCpy $4 $3 12
      StrCmp $4 "BAZAAR_PATH=" 0 garder_ligne
        StrCpy $6 1
        Goto boucle_config
      garder_ligne:
        FileWrite $1 $3
        Goto boucle_config
    fin_boucle_config:
      FileClose $0
      ; Les valeurs confirmées dans l'assistant, écrites une seule fois.
      FileWrite $1 "STEAM_PATH=$CfgSteam$\r$\n"
      FileWrite $1 "TEMPO_PATH=$CfgTempo$\r$\n"
      FileWrite $1 "SOURCE=$Retenue$\r$\n"
      FileWrite $1 "BAZAAR_PATH=$GameDir$\r$\n"
      FileClose $1
    Delete "$INSTDIR\config.ini"
    Rename "$INSTDIR\config.ini.tmp" "$INSTDIR\config.ini"
  config_fini:

  ; ── Raccourcis ──
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\Bazaar Scanner"
  CreateShortcut "$SMPROGRAMS\Bazaar Scanner\Bazaar Scanner.lnk" "$INSTDIR\BazaarScanner.exe" "" "$INSTDIR\icon.ico"
  CreateShortcut "$DESKTOP\Bazaar Scanner.lnk" "$INSTDIR\BazaarScanner.exe" "" "$INSTDIR\icon.ico"

  ; ── Désinstallateur et registre ──
  WriteRegStr HKLM "Software\BazaarScanner" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\BazaarScanner" "SteamDir" "$CfgSteam"
  WriteRegStr HKLM "Software\BazaarScanner" "TempoDir" "$CfgTempo"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayName" "Bazaar Scanner"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "Publisher" "Kwev"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayVersion" "${VERSION_APP}"
SectionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 2, BepInEx, dans le dossier du jeu
; ─────────────────────────────────────────────────────────────
Section "BepInEx" SecBepInEx
  ; N'écrase jamais une installation plus récente : d'autres mods peuvent
  ; en dépendre, et les écraser les casserait.
  SetOverwrite ifnewer

  ; Les deux installations en reçoivent une copie le cas échéant : le streamer
  ; qui bascule de l'une à l'autre en direct n'a rien à réinstaller.
  StrCmp $CfgSteam "" +3
    SetOutPath "$CfgSteam"
    File /r "bepinex_payload\*.*"

  StrCmp $CfgTempo "" +3
    SetOutPath "$CfgTempo"
    File /r "bepinex_payload\*.*"

  SetOverwrite on
SectionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 3, Le mod, dans BepInEx\plugins
; ─────────────────────────────────────────────────────────────
Section "Game mod" SecMod
  ; Le jeu doit être fermé : Windows refuse d'écraser une DLL chargée, et
  ; l'échec passerait inaperçu.
  FindWindow $0 "UnityWndClass" ""
  StrCmp $0 0 jeu_ferme
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION  "$(JEU_OUVERT)"  IDOK jeu_ferme
    Abort
  jeu_ferme:

  StrCmp $CfgSteam "" +4
    CreateDirectory "$CfgSteam\BepInEx\plugins\BazaarScannerBridge"
    SetOutPath "$CfgSteam\BepInEx\plugins\BazaarScannerBridge"
    File "BazaarScannerBridge.dll"

  StrCmp $CfgTempo "" +4
    CreateDirectory "$CfgTempo\BepInEx\plugins\BazaarScannerBridge"
    SetOutPath "$CfgTempo\BepInEx\plugins\BazaarScannerBridge"
    File "BazaarScannerBridge.dll"
SectionEnd

; ── Descriptions des composants ──
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "$(DESC_APP)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecBepInEx} "$(DESC_BEPINEX)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMod} "$(DESC_MOD)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; Retire le mod d'un dossier de jeu ($R0), s'il y en a un.
; Les cartes extraites et board_state.json sont laissés : ils se
; reconstruisent, mais les effacer sans le dire serait cavalier. Le dossier
; du mod n'est donc supprimé que s'il est vide.
Function un.RetirerMod
  StrCmp $R0 "" fin
    Delete "$R0\BepInEx\plugins\BazaarScannerBridge\BazaarScannerBridge.dll"
    RMDir "$R0\BepInEx\plugins\BazaarScannerBridge"
  fin:
FunctionEnd

; ─────────────────────────────────────────────────────────────
;  DÉSINSTALLATION
; ─────────────────────────────────────────────────────────────
Section "Uninstall"
  ; Le mod est retiré du dossier du jeu, relu dans le registre : sans cela il
  ; resterait en place et continuerait de tourner après la désinstallation.
  ;
  ; Jusqu'ici, on relisait « GameDir », que l'installation n'écrit plus depuis
  ; qu'elle gère Steam ET le client Tempo : elle écrit « SteamDir » et
  ; « TempoDir ». Le mod restait donc dans les deux jeux. On lit désormais les
  ; trois clés, « GameDir » couvrant les installations plus anciennes.
  ReadRegStr $R0 HKLM "Software\BazaarScanner" "SteamDir"
  Call un.RetirerMod
  ReadRegStr $R0 HKLM "Software\BazaarScanner" "TempoDir"
  Call un.RetirerMod
  ReadRegStr $R0 HKLM "Software\BazaarScanner" "GameDir"
  Call un.RetirerMod

  ; BepInEx n'est PAS retiré : d'autres mods peuvent s'en servir.

  Delete "$INSTDIR\BazaarScanner.exe"
  Delete "$INSTDIR\interface.html"
  Delete "$INSTDIR\LISEZMOI.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"

  ; config.ini est conservé : il contient le jeton Twitch et le calibrage.
  ; En silencieux (réinstallation, mise à jour), on garde toujours.
  MessageBox MB_YESNO|MB_ICONQUESTION  "$(SUPPRIMER_CONFIG)" /SD IDNO  IDNO garder_config
    Delete "$INSTDIR\config.ini"
  garder_config:

  Delete "$SMPROGRAMS\Bazaar Scanner\Bazaar Scanner.lnk"
  RMDir "$SMPROGRAMS\Bazaar Scanner"
  Delete "$DESKTOP\Bazaar Scanner.lnk"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner"
  DeleteRegKey HKLM "Software\BazaarScanner"
SectionEnd

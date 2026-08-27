; ─────────────────────────────────────────────────────────────
;  BAZAAR SCANNER — Installateur Windows (v1.1)
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
!include "StrFunc.nsh"
${StrStr}
${StrTok}
${StrRep}

Name "Bazaar Scanner"
OutFile "BazaarScanner_setup.exe"
InstallDir "$PROGRAMFILES64\Bazaar Scanner"
InstallDirRegKey HKLM "Software\BazaarScanner" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

Var GameDir

; ── Apparence ──
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC

; ── Pages de l'assistant ──
!define MUI_WELCOMEPAGE_TITLE "$(TITRE_BIENVENUE)"
!define MUI_WELCOMEPAGE_TEXT "$(TEXTE_BIENVENUE)"
!insertmacro MUI_PAGE_WELCOME

; À lire AVANT l'installation : le LISEZMOI est affiché dans l'assistant
!define MUI_PAGE_HEADER_TEXT "$(TITRE_LISEZMOI)"
!define MUI_PAGE_HEADER_SUBTEXT "$(SOUS_LISEZMOI)"
!define MUI_LICENSEPAGE_TEXT_TOP "$(HAUT_LISEZMOI)"
!define MUI_LICENSEPAGE_TEXT_BOTTOM " "
!define MUI_LICENSEPAGE_BUTTON "Suivant >"
!insertmacro MUI_PAGE_LICENSE "LISEZMOI.txt"

!insertmacro MUI_PAGE_COMPONENTS

; Page 1 : dossier d'installation de l'outil
!define MUI_PAGE_HEADER_TEXT "$(TITRE_DOSSIER_APP)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(HAUT_DOSSIER_APP)"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "$(DEST_APP)"
!insertmacro MUI_PAGE_DIRECTORY

; Page 2 : dossier du jeu
!define MUI_PAGE_HEADER_TEXT "$(TITRE_DOSSIER_JEU)"
!define MUI_DIRECTORYPAGE_TEXT_TOP "$(HAUT_DOSSIER_JEU)"
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "$(DEST_JEU)"
!define MUI_DIRECTORYPAGE_VARIABLE $GameDir
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckGameDir
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\BazaarScanner.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(LANCER)"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LISEZMOI.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(VOIR_LISEZMOI)"
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

LangString TEXTE_BIENVENUE   ${LANG_ENGLISH} "This wizard will install Bazaar Scanner, the Twitch overlay for The Bazaar, along with BepInEx and the mod it needs inside the game.$\r$\n$\r$\nPlease close the game and OBS before continuing."
LangString TEXTE_BIENVENUE   ${LANG_FRENCH}  "Cet assistant va installer Bazaar Scanner, l'extension Twitch pour The Bazaar, ainsi que BepInEx et le mod nécessaires côté jeu.$\r$\n$\r$\nFerme le jeu et OBS avant de continuer."

LangString TITRE_LISEZMOI    ${LANG_ENGLISH} "Please read before installing"
LangString TITRE_LISEZMOI    ${LANG_FRENCH}  "À lire avant l'installation"

LangString SOUS_LISEZMOI     ${LANG_ENGLISH} "What this installer does, and what you will need."
LangString SOUS_LISEZMOI     ${LANG_FRENCH}  "Ce que fait l'installateur, et ce dont tu auras besoin."

LangString HAUT_LISEZMOI     ${LANG_ENGLISH} "Read this information, then click Next."
LangString HAUT_LISEZMOI     ${LANG_FRENCH}  "Prends connaissance de ces informations, puis clique sur Suivant."

LangString TITRE_DOSSIER_APP ${LANG_ENGLISH} "Where to install Bazaar Scanner"
LangString TITRE_DOSSIER_APP ${LANG_FRENCH}  "Dossier d'installation de Bazaar Scanner"

LangString HAUT_DOSSIER_APP  ${LANG_ENGLISH} "Choose the folder where Bazaar Scanner will be installed."
LangString HAUT_DOSSIER_APP  ${LANG_FRENCH}  "Choisis le dossier où installer Bazaar Scanner."

LangString DEST_APP          ${LANG_ENGLISH} "Bazaar Scanner folder"
LangString DEST_APP          ${LANG_FRENCH}  "Dossier de Bazaar Scanner"

LangString TITRE_DOSSIER_JEU ${LANG_ENGLISH} "The Bazaar game folder"
LangString TITRE_DOSSIER_JEU ${LANG_FRENCH}  "Dossier du jeu The Bazaar"

LangString HAUT_DOSSIER_JEU  ${LANG_ENGLISH} "The game folder was detected automatically through Steam whenever possible — check it, or correct it.$\r$\nBepInEx and the mod will be installed there."
LangString HAUT_DOSSIER_JEU  ${LANG_FRENCH}  "Le dossier du jeu a été détecté automatiquement via Steam quand c'était possible — vérifie-le ou corrige-le.$\r$\nBepInEx et le mod y seront installés."

LangString DEST_JEU          ${LANG_ENGLISH} "Game folder"
LangString DEST_JEU          ${LANG_FRENCH}  "Dossier du jeu"

LangString LANCER            ${LANG_ENGLISH} "Launch Bazaar Scanner"
LangString LANCER            ${LANG_FRENCH}  "Lancer Bazaar Scanner"

LangString VOIR_LISEZMOI     ${LANG_ENGLISH} "Show the readme"
LangString VOIR_LISEZMOI     ${LANG_FRENCH}  "Afficher le fichier LISEZMOI"

LangString PAS_LE_JEU        ${LANG_ENGLISH} "That folder does not seem to contain The Bazaar ($GameDir\TheBazaar_Data was not found).$\r$\n$\r$\nContinue anyway?"
LangString PAS_LE_JEU        ${LANG_FRENCH}  "Ce dossier ne semble pas contenir The Bazaar ($GameDir\TheBazaar_Data introuvable).$\r$\n$\r$\nContinuer quand même ?"

LangString JEU_OUVERT        ${LANG_ENGLISH} "The Bazaar seems to be running.$\r$\nClose the game before continuing, otherwise the mod cannot be installed."
LangString JEU_OUVERT        ${LANG_FRENCH}  "The Bazaar semble ouvert.$\r$\nFerme le jeu avant de continuer, sinon le mod ne pourra pas être installé."

LangString DESC_APP          ${LANG_ENGLISH} "The BazaarScanner.exe application and its window. Installed in the folder you choose."
LangString DESC_APP          ${LANG_FRENCH}  "L'application BazaarScanner.exe et sa fenêtre. Installée dans le dossier de ton choix."

LangString DESC_BEPINEX      ${LANG_ENGLISH} "The BepInEx framework, required by the mod. Uncheck it if you already have it."
LangString DESC_BEPINEX      ${LANG_FRENCH}  "Le socle BepInEx, nécessaire au mod. Décoche-le si tu l'as déjà."

LangString DESC_MOD          ${LANG_ENGLISH} "The mod that reads your board. Installed in the game folder."
LangString DESC_MOD          ${LANG_FRENCH}  "Le mod qui lit ton plateau. Installé dans le dossier du jeu."

LangString SUPPRIMER_CONFIG  ${LANG_ENGLISH} "Also delete your settings (Twitch token and calibration)?"
LangString SUPPRIMER_CONFIG  ${LANG_FRENCH}  "Supprimer aussi tes réglages (jeton Twitch et calibrage) ?"

; Teste si une racine Steam ($0) contient The Bazaar ; remplit $GameDir si oui
Function CheckSteamRoot
  IfFileExists "$0\steamapps\common\The Bazaar\TheBazaar_Data\*.*" 0 +2
    StrCpy $GameDir "$0\steamapps\common\The Bazaar"
FunctionEnd

Function .onInit
  ; ── Détection automatique du dossier du jeu ──
  StrCpy $GameDir ""

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
  StrCmp $GameDir "" 0 detect_done

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
    StrCmp $GameDir "" vdf_loop vdf_close
  vdf_close:
    FileClose $R1
  no_steam:

  ; Repli si rien trouvé : chemin Steam classique
  StrCmp $GameDir "" 0 detect_done
    StrCpy $GameDir "C:\Program Files (x86)\Steam\steamapps\common\The Bazaar"
  detect_done:

  ; Dossier d'installation par défaut : celui d'où l'installateur est lancé
  ; (sauf réinstallation : le chemin déjà enregistré est conservé)
  ReadRegStr $0 HKLM "Software\BazaarScanner" "InstallDir"
  StrCmp $0 "" 0 +2
    StrCpy $INSTDIR "$EXEDIR"
FunctionEnd

; Avertit si le dossier du jeu semble incorrect (mais laisse continuer)
Function CheckGameDir
  IfFileExists "$GameDir\TheBazaar_Data\*.*" ok
    MessageBox MB_YESNO|MB_ICONQUESTION "$(PAS_LE_JEU)" IDYES ok
    Abort
  ok:
FunctionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 1 — Application (obligatoire)
; ─────────────────────────────────────────────────────────────
Section "Bazaar Scanner" SecMain
  SectionIn RO
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
  ; Le jeton Twitch, lui, est conservé — le perdre obligerait à se reconnecter.
  IfFileExists "$INSTDIR\config.ini" maj_chemin creer_config

  creer_config:
    FileOpen $0 "$INSTDIR\config.ini" w
    FileWrite $0 "# Bazaar Scanner — configuration$\r$\n"
    FileWrite $0 "#$\r$\n"
    FileWrite $0 "# RELAY_TOKEN : rempli automatiquement par « Se connecter avec Twitch ».$\r$\n"
    FileWrite $0 "# BAZAAR_PATH : dossier d'installation du jeu.$\r$\n"
    FileWrite $0 "# CADRE       : renseigné par le bouton Calibrer, pas à la main.$\r$\n"
    FileWrite $0 "$\r$\n"
    FileWrite $0 "RELAY_TOKEN=$\r$\n"
    FileWrite $0 "TWITCH_NOM=$\r$\n"
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
      StrCpy $4 $3 12
      StrCmp $4 "BAZAAR_PATH=" 0 garder_ligne
        FileWrite $1 "BAZAAR_PATH=$GameDir$\r$\n"
        StrCpy $6 1
        Goto boucle_config
      garder_ligne:
        FileWrite $1 $3
        Goto boucle_config
    fin_boucle_config:
      FileClose $0
      StrCmp $6 1 tmp_fini
        FileWrite $1 "BAZAAR_PATH=$GameDir$\r$\n"
      tmp_fini:
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
  WriteRegStr HKLM "Software\BazaarScanner" "GameDir" "$GameDir"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayName" "Bazaar Scanner"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "Publisher" "Kwev"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner" "DisplayVersion" "1.0.0"
SectionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 2 — BepInEx, dans le dossier du jeu
; ─────────────────────────────────────────────────────────────
Section "BepInEx" SecBepInEx
  ; N'écrase jamais une installation plus récente : d'autres mods peuvent
  ; en dépendre, et les écraser les casserait.
  SetOutPath "$GameDir"
  SetOverwrite ifnewer
  File /r "bepinex_payload\*.*"
  SetOverwrite on
SectionEnd

; ─────────────────────────────────────────────────────────────
;  SECTION 3 — Le mod, dans BepInEx\plugins
; ─────────────────────────────────────────────────────────────
Section "Game mod" SecMod
  ; Le jeu doit être fermé : Windows refuse d'écraser une DLL chargée, et
  ; l'échec passerait inaperçu.
  FindWindow $0 "UnityWndClass" ""
  StrCmp $0 0 jeu_ferme
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION  "$(JEU_OUVERT)"  IDOK jeu_ferme
    Abort
  jeu_ferme:

  CreateDirectory "$GameDir\BepInEx\plugins\BazaarScannerBridge"
  SetOutPath "$GameDir\BepInEx\plugins\BazaarScannerBridge"
  File "BazaarScannerBridge.dll"
SectionEnd

; ── Descriptions des composants ──
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "$(DESC_APP)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecBepInEx} "$(DESC_BEPINEX)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMod} "$(DESC_MOD)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ─────────────────────────────────────────────────────────────
;  DÉSINSTALLATION
; ─────────────────────────────────────────────────────────────
Section "Uninstall"
  ; Le mod est retiré du dossier du jeu, relu dans le registre : sans cela il
  ; resterait en place et continuerait de tourner après la désinstallation.
  ReadRegStr $R0 HKLM "Software\BazaarScanner" "GameDir"
  StrCmp $R0 "" pas_de_jeu
    Delete "$R0\BepInEx\plugins\BazaarScannerBridge\BazaarScannerBridge.dll"
    ; Les cartes extraites et board_state.json sont laissés : ils se
    ; reconstruisent, mais les effacer sans le dire serait cavalier.
    RMDir "$R0\BepInEx\plugins\BazaarScannerBridge"
  pas_de_jeu:

  ; BepInEx n'est PAS retiré : d'autres mods peuvent s'en servir.

  Delete "$INSTDIR\BazaarScanner.exe"
  Delete "$INSTDIR\interface.html"
  Delete "$INSTDIR\LISEZMOI.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"

  ; config.ini est conservé : il contient le jeton Twitch et le calibrage.
  MessageBox MB_YESNO|MB_ICONQUESTION  "$(SUPPRIMER_CONFIG)"  IDNO garder_config
    Delete "$INSTDIR\config.ini"
  garder_config:

  Delete "$SMPROGRAMS\Bazaar Scanner\Bazaar Scanner.lnk"
  RMDir "$SMPROGRAMS\Bazaar Scanner"
  Delete "$DESKTOP\Bazaar Scanner.lnk"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\BazaarScanner"
  DeleteRegKey HKLM "Software\BazaarScanner"
SectionEnd

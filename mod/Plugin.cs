using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using BazaarGameClient.Domain.Cards;
using BazaarGameClient.Domain.Models;
using BazaarGameClient.Domain.Models.Cards;
using BazaarGameShared.Domain.Cards;
using BazaarGameShared.Domain.Core;
using BazaarGameShared.Domain.Core.Types;
using BazaarGameShared.Domain.Runs;
using BepInEx;
using BepInEx.Logging;
using Newtonsoft.Json;
using TheBazaar;
using UnityEngine;

namespace BazaarScannerBridge
{
    [BepInPlugin("com.bazaarscanner.bridge", "Bazaar Scanner Bridge", Plugin.VERSION_MOD)]
    public class Plugin : BaseUnityPlugin
    {
        /* La version du mod, écrite aussi dans board_state.json : la fenêtre de
           l'application la compare à celle qu'elle attend, et signale une DLL
           périmée (piège déjà rencontré : la copie de scanner-light, ou une
           réinstallation qui écrase la DLL du jeu). À relever à chaque
           changement du mod, avec MOD_ATTENDU dans app.js. */
        /* Alignée sur la version de l'application depuis la V3 : un seul numéro
           pour le streamer. Elles avancent ensemble. */
        public const string VERSION_MOD = "3.0.0";

        internal static ManualLogSource Log;

        private float _timer = 0f;
        private const float IntervalSeconds = 1.0f;

        private const long SeuilAlerteMs = 8;
        private static int _cyclesLents;
        private static int _ecritureEnCours;
        private static double _cumulMs;
        private static int _cycles;
        private string _outputPath;
        private static string _dllDir;
        private static string _cardsDbPath;
        private static string _cardsDbPathEn;
        private static readonly Dictionary<string, object> _extractedCardsEn = new Dictionary<string, object>();
        private static string _currentLang = "en";
        private static string _versionJeu = "";
        private static readonly Dictionary<string, object> _extractedCards = new Dictionary<string, object>();

        private static readonly Dictionary<string, string> _extractedCardsSignature = new Dictionary<string, string>();

        private static string DetectLanguage()
        {
            try
            {
                foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
                {
                    var t = assembly.GetType("UnityEngine.Localization.Settings.LocalizationSettings");
                    if (t == null) continue;
                    var prop = t.GetProperty("SelectedLocale",
                        System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
                    var locale = prop?.GetValue(null);
                    if (locale == null) continue;
                    var idProp = locale.GetType().GetProperty("Identifier");
                    var id = idProp?.GetValue(locale);
                    var codeProp = id?.GetType().GetProperty("Code");
                    var code = codeProp?.GetValue(id) as string;
                    if (!string.IsNullOrEmpty(code)) return code.ToLower().Substring(0, 2);
                }
            }
            catch { /* silencieux */ }

            return Application.systemLanguage switch
            {
                SystemLanguage.French  => "fr",
                SystemLanguage.German  => "de",
                SystemLanguage.Spanish => "es",
                SystemLanguage.Italian => "it",
                SystemLanguage.Portuguese => "pt",
                SystemLanguage.Russian => "ru",
                SystemLanguage.Chinese => "zh",
                SystemLanguage.Japanese => "ja",
                SystemLanguage.Korean  => "ko",
                _                      => "en",
            };
        }

        private static void RefreshLanguage()
        {
            var lang = DetectLanguage();
            if (lang == _currentLang) return;

            Log.LogInfo($"[CardsDB] Changement de langue détecté : {_currentLang} → {lang}. Rechargement du cache.");
            _currentLang = lang;
            _cardsDbPath   = Path.Combine(_dllDir, $"extracted_cards_{lang}.json");
            _cardsDbPathEn = Path.Combine(_dllDir, "extracted_cards_en.json");
            _extractedCards.Clear();
            _extractedCardsSignature.Clear();
            LoadExtractedCardsCache();
            LoadTranslations();

            _vidageFait = false;
        }

        private class ShortTypeNameBinder : Newtonsoft.Json.Serialization.DefaultSerializationBinder
        {
            public override void BindToName(Type serializedType, out string assemblyName, out string typeName)
            {
                assemblyName = null;
                typeName = serializedType.Name;
            }
        }

        private static readonly JsonSerializerSettings ExtractSettings = new JsonSerializerSettings
        {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            MaxDepth = 10,
            Formatting = Formatting.None,
            Converters = { new Newtonsoft.Json.Converters.StringEnumConverter() },
            TypeNameHandling = TypeNameHandling.Auto,
            SerializationBinder = new ShortTypeNameBinder(),
        };

        private void Awake()
        {
            Log = Logger;
            Log.LogInfo("Bazaar Scanner Bridge charge avec succes !");

            _dllDir = Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".";
            _outputPath = Path.Combine(_dllDir, "board_state.json");
            _currentLang = DetectLanguage();
            /* La version du jeu, pour le diagnostic de l'application : savoir
               sur quel patch on tourne quand quelque chose casse. */
            try { _versionJeu = Application.version ?? ""; } catch { _versionJeu = ""; }
            _cardsDbPath   = Path.Combine(_dllDir, $"extracted_cards_{_currentLang}.json");
            _cardsDbPathEn = Path.Combine(_dllDir, "extracted_cards_en.json");
            Log.LogInfo($"[CardsDB] Langue détectée : {_currentLang} → {_cardsDbPath}");
            LoadExtractedCardsCache();
            LoadTranslations();
        }

        private void Update()
        {
            _timer += UnityEngine.Time.unscaledDeltaTime;
            if (_timer < IntervalSeconds) return;
            _timer = 0f;

            var chrono = System.Diagnostics.Stopwatch.StartNew();
            _cycles++;

            RefreshLanguage();
            ViderCatalogue();

            try
            {
                WriteBoardState();
            }
            catch (Exception ex)
            {
                LogLimite("lecture", "Erreur lecture board: " + ex.Message);
            }

            chrono.Stop();
            var ms = chrono.Elapsed.TotalMilliseconds;
            _cumulMs += ms;

            if (ms >= SeuilAlerteMs)
            {
                _cyclesLents++;
                if (_cyclesLents <= 3 || _cyclesLents % 200 == 0)
                    Log.LogWarning("[Perf] relevé lent : " + ms.ToString("0.0")
                        + " ms (" + _cyclesLents + "e). Le mod devrait tenir "
                        + "sous " + SeuilAlerteMs + " ms.");
            }

            if (_cycles % 300 == 0)
                Log.LogInfo("[Perf] " + _cycles + " relevés, moyenne "
                    + (_cumulMs / _cycles).ToString("0.00") + " ms, "
                    + _cyclesLents + " au-dessus de " + SeuilAlerteMs + " ms.");
        }

        private static List<CardInfo> _face = new List<CardInfo>();
        private static List<CardInfo> _reserve = new List<CardInfo>();

        private static void LireBandes()
        {
            _reserve = new List<CardInfo>();
            _face = LireBande("OpponentSocket_", "PlayerStorageSocket_", _reserve);
        }

        private static List<CardInfo> LireBande(string prefixe)
        {
            return LireBande(prefixe, null);
        }

        private static List<CardInfo> LireBande(string prefixe, string prefixe2,
                                                List<CardInfo> seconde = null)
        {
            var result = new List<CardInfo>();
            var vues = new HashSet<string>();

            object dict;
            try
            {
                dict = typeof(Data).GetProperty("CardControllerToBoardTarget",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                    ?.GetValue(null);
            }
            catch { return result; }

            var suite = dict as System.Collections.IEnumerable;
            if (suite == null) return result;

            try
            {
                foreach (var e in suite)
                {
                    var t = e.GetType();
                    var emplacement = t.GetProperty("Value")?.GetValue(e)?.ToString();
                    if (emplacement == null) continue;

                    List<CardInfo> cible = null;
                    string p = null;
                    if (emplacement.StartsWith(prefixe)) { cible = result; p = prefixe; }
                    else if (prefixe2 != null && seconde != null
                             && emplacement.StartsWith(prefixe2)) { cible = seconde; p = prefixe2; }
                    if (cible == null) continue;

                    if (!int.TryParse(emplacement.Substring(p.Length),
                                      out var socket)) continue;

                    var controleur = t.GetProperty("Key")?.GetValue(e);
                    if (controleur == null) continue;

                    object carte = null;
                    try
                    {
                        carte = controleur.GetType().GetProperty("CardData")?.GetValue(controleur)
                             ?? controleur.GetType().GetProperty("Card")?.GetValue(controleur);
                    }
                    catch { }
                    if (carte == null) continue;

                    try
                    {
                        var go = controleur.GetType().GetProperty("gameObject")?.GetValue(controleur);
                        var actif = go?.GetType().GetProperty("activeInHierarchy")?.GetValue(go);
                        if (actif is bool b && !b) continue;
                    }
                    catch { }

                    string type = null;
                    try { type = carte.GetType().GetProperty("Type")?.GetValue(carte)?.ToString(); }
                    catch { }
                    if (type == "SocketEffect") continue;

                    string instance = null;
                    try
                    {
                        var iid = carte.GetType().GetProperty("InstanceId")?.GetValue(carte);
                        instance = iid?.GetType().GetProperty("Value")?.GetValue(iid)?.ToString()
                                ?? iid?.ToString();
                    }
                    catch { }
                    if (instance != null && !vues.Add(instance)) continue;

                    var info = DecrireCarte(carte, socket);
                    if (info == null) continue;

                    /* L'avancement des quêtes, comme pour le plateau : en PVP,
                       celui de l'adversaire, si le jeu le transmet. */
                    if (info.Quests == null) info.Quests = LireQuetes(carte, ValeurDe(carte, "Template"));
                    if (info.Jetons == null) info.Jetons = LireJetons(carte);
                    if (info.Multicast == null) info.Multicast = LireAttributEntier(carte, "Multicast");
                    if (info.Delai == null) info.Delai = LireAttributEntier(carte, "CooldownMax");
                    if (info.Munitions == null) info.Munitions = LireAttributEntier(carte, "AmmoMax");
                    if (info.TagsAjoutes == null) info.TagsAjoutes = LireTagsAjoutes(carte);
                    PositionEcran(controleur, info);
                    cible.Add(info);
                }
            }
            catch (Exception ex) { LogLimite("bande-" + prefixe, "[Bande] " + prefixe + " : " + ex.Message); }

            result.Sort((a, b) => a.Socket.CompareTo(b.Socket));
            if (seconde != null) seconde.Sort((a, b) => a.Socket.CompareTo(b.Socket));
            return result;
        }

        private static List<CardInfo> LireTalentsAdverses(object run, List<CardInfo> face)
        {
            var result = new List<CardInfo>();
            if (face == null || face.Count == 0) return result;

            object adversaire;
            try { adversaire = run.GetType().GetProperty("Opponent")?.GetValue(run); }
            catch { return result; }
            if (adversaire == null) return result;

            try { return ReadSkills(adversaire); }
            catch (Exception ex)
            {
                LogLimite("face", "[Face] talents adverses : " + ex.Message);
                return result;
            }
        }

        private static Camera TrouverCamera()
        {
            var c = Camera.main;
            if (c != null) return c;
            var toutes = Camera.allCameras;
            return (toutes != null && toutes.Length > 0) ? toutes[0] : null;
        }

        private static void PositionEcran(object controleur, CardInfo info)
        {
            try
            {
                var cam = TrouverCamera();
                if (cam == null) return;

                var comp = controleur as Component;
                if (comp == null) return;

                int l = Screen.width;
                int h = Screen.height;
                if (l <= 0 || h <= 0) return;

                var boite = comp.GetComponent<BoxCollider>();

                if (boite != null)
                {
                    var b = boite.bounds;
                    float xmin = float.MaxValue, xmax = float.MinValue;
                    float ymin = float.MaxValue, ymax = float.MinValue;
                    bool devant = false;

                    for (int i = 0; i < 8; i++)
                    {
                        var coin = new Vector3(
                            (i & 1) == 0 ? b.min.x : b.max.x,
                            (i & 2) == 0 ? b.min.y : b.max.y,
                            (i & 4) == 0 ? b.min.z : b.max.z);

                        var q = cam.WorldToScreenPoint(coin);
                        if (q.z <= 0f) continue;      // coin derriere la camera
                        devant = true;

                        if (q.x < xmin) xmin = q.x;
                        if (q.x > xmax) xmax = q.x;
                        if (q.y < ymin) ymin = q.y;
                        if (q.y > ymax) ymax = q.y;
                    }

                    if (devant)
                    {
                        info.X = (xmin + xmax) / 2f * 100f / l;
                        info.Y = (h - (ymin + ymax) / 2f) * 100f / h;
                        info.W = (xmax - xmin) * 100f / l;
                        info.H = (ymax - ymin) * 100f / h;
                        return;
                    }
                }

                var p = cam.WorldToScreenPoint(comp.transform.position);
                if (p.z <= 0f) return;
                info.X = p.x * 100f / l;
                info.Y = (h - p.y) * 100f / h;
            }
            catch { /* position indisponible : l'application se rabat sur le socket */ }
        }

        private static Dictionary<int, string> LireEffetsEmplacement()
        {
            return LireEffetsDe(Data.Run?.Player);
        }

        private static void RattacherEffets(List<CardInfo> cartes,
                                            Dictionary<int, string> effets)
        {
            if (cartes == null || effets == null || effets.Count == 0) return;
            foreach (var carte in cartes)
            {
                var largeur = carte.Size == "Medium" ? 2 : (carte.Size == "Large" ? 3 : 1);
                for (var k = 0; k < largeur; k++)
                {
                    if (!effets.TryGetValue(carte.Socket + k, out var id)) continue;
                    carte.SocketEffects ??= new List<string>();
                    if (!carte.SocketEffects.Contains(id)) carte.SocketEffects.Add(id);
                }
            }
        }

        private static Dictionary<int, string> LireEffetsDe(object joueur)
        {
            var effets = new Dictionary<int, string>();
            try
            {
                var conteneur = joueur?.GetType()
                    .GetProperty("Socket")?.GetValue(joueur);
                if (conteneur == null) return effets;

                var m = conteneur.GetType().GetMethod("GetItems",
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic,
                    null, Type.EmptyTypes, null);
                var liste = m?.Invoke(conteneur, null) as System.Collections.IEnumerable;
                if (liste == null) return effets;

                foreach (var effet in liste)
                {
                    if (effet == null) continue;

                    var id = effet.GetType()
                        .GetProperty("TemplateId")?.GetValue(effet)?.ToString();

                    string code = null;
                    try
                    {
                        var modele = effet.GetType().GetProperty("Template")?.GetValue(effet);
                        var interne = modele?.GetType()
                            .GetProperty("InternalName")?.GetValue(modele)?.ToString();
                        if (interne != null)
                        {
                            var ouvre = interne.IndexOf('[');
                            var ferme = interne.IndexOf(']');
                            if (ouvre >= 0 && ferme > ouvre)
                            {
                                code = interne.Substring(ouvre + 1, ferme - ouvre - 1).Trim();
                                if (code.EndsWith(" Note")) code = code.Substring(0, code.Length - 5);
                            }
                        }
                    }
                    catch { }

                    var emplacement = effet.GetType()
                        .GetProperty("LeftSocketId")?.GetValue(effet)?.ToString();
                    if (id == null || emplacement == null) continue;

                    var chiffres = emplacement.Substring(emplacement.LastIndexOf('_') + 1);
                    if (int.TryParse(chiffres, out var numero))
                        effets[numero] = code == null ? id : (id + "|" + code);
                }
            }
            catch (Exception ex) { LogLimite("effets", "[Effets] " + ex.Message); }
            return effets;
        }

        /* Un avertissement qui se répète à chaque relevé (une erreur devenue
           permanente après une mise à jour du jeu, par exemple) remplissait
           LogOutput.log de milliers de lignes par heure. On en écrit les trois
           premières, puis une sur deux cents. Appelable depuis tout fil. */
        private static readonly Dictionary<string, int> _occurrencesLog = new Dictionary<string, int>();

        private static void LogLimite(string cle, string message)
        {
            int n;
            lock (_occurrencesLog)
            {
                _occurrencesLog.TryGetValue(cle, out n);
                n++;
                _occurrencesLog[cle] = n;
            }
            if (n <= 3 || n % 200 == 0)
                Log.LogWarning(message + (n > 3 ? " (" + n + "e fois)" : ""));
        }

        private static bool _enchantementSignale;

        private static string NomEnchantement(object carte)
        {
            if (carte == null) return null;

            const BindingFlags OU = BindingFlags.Instance | BindingFlags.Public
                                  | BindingFlags.NonPublic | BindingFlags.FlattenHierarchy;
            object v = null;

            try
            {
                for (var t = carte.GetType(); t != null && v == null; t = t.BaseType)
                {
                    var p = t.GetProperty("Enchantment", OU);
                    if (p != null && p.GetIndexParameters().Length == 0)
                    {
                        v = p.GetValue(carte);
                        if (v != null) break;
                    }

                    var f = t.GetField("Enchantment", OU);
                    if (f != null) v = f.GetValue(carte);
                }
            }
            catch { return null; }

            if (v == null)
            {
                if (!_enchantementSignale)
                {
                    _enchantementSignale = true;
                    Log.LogInfo("[Face] « Enchantment » introuvable sur "
                        + carte.GetType().FullName + " - les cartes de la bande "
                        + "s'afficheront sans enchantement.");
                }
                return null;
            }

            var nom = v.ToString();
            return string.IsNullOrEmpty(nom) || nom == "None" ? null : nom;
        }

        private static CardInfo DecrireCarte(object carte, int socket)
        {
            try
            {
                var t = carte.GetType();
                var modele = t.GetProperty("Template")?.GetValue(carte);
                var id = modele?.GetType().GetProperty("Id")?.GetValue(modele)?.ToString();

                if (modele != null && id != null && VidageDemande())
                    TryExtractCardData(modele, id);

                var loc = modele?.GetType().GetProperty("Localization")?.GetValue(modele);
                var titre = loc?.GetType().GetProperty("Title")?.GetValue(loc);

                return new CardInfo
                {
                    Name         = LocalizeText(titre),
                    InternalName = modele?.GetType().GetProperty("InternalName")
                                         ?.GetValue(modele)?.ToString(),
                    TemplateId   = id,
                    Size         = t.GetProperty("Size")?.GetValue(carte)?.ToString(),
                    Tier         = t.GetProperty("Tier")?.GetValue(carte)?.ToString(),
                    Socket       = socket,
                    Type         = t.GetProperty("Type")?.GetValue(carte)?.ToString(),
                    Enchantment  = NomEnchantement(carte),
                    ArtKey       = modele?.GetType().GetProperty("ArtKey")
                                         ?.GetValue(modele)?.ToString(),
                };
            }
            catch { return null; }
        }


#if SONDES
        /* ── Sonde : où est la réserve ? ──────────────────────────────────
           La réserve lue par LireBandes() vient des contrôleurs AFFICHÉS :
           elle est donc vide dès que le joueur referme son coffre. Pour
           l'afficher en permanence, il faut la lire là où le jeu la garde,
           comme le plateau vient de run.Player.Hand.

           Cette sonde liste les propriétés du joueur et dit lesquelles sont
           des conteneurs de cartes, avec leur contenu. Elle ne tourne que si
           le fichier témoin « sonder-reserve » est posé à côté de la DLL, et
           n'écrit qu'une fois. */
        private static bool _sondeReserveFaite;

        private void SonderReserve(object joueur)
        {
            if (_sondeReserveFaite || joueur == null) return;

            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-reserve"))) return;

            _sondeReserveFaite = true;
            var lignes = new List<string>();

            lignes.Add("Propriétés du joueur :");
            lignes.Add("");

            foreach (var p in joueur.GetType().GetProperties(
                         BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                object v = null;
                try { v = p.GetValue(joueur); } catch { continue; }

                var type = p.PropertyType.Name;
                var detail = "";

                /* Un conteneur de cartes : on dit combien il en porte et
                   lesquelles, c'est ce qui permet de reconnaître la réserve. */
                try
                {
                    var cartes = ReadContainerItems(v);
                    if (cartes.Count > 0)
                    {
                        var noms = new List<string>();
                        foreach (var c in cartes) noms.Add(c.Name ?? c.InternalName ?? "?");
                        detail = "  <<< " + cartes.Count + " carte(s) : " + string.Join(", ", noms);
                    }
                    else if (v is CardContainer) detail = "  (conteneur, vide)";
                }
                catch { }

                lignes.Add("  " + p.Name.PadRight(28) + type.PadRight(22)
                           + (v == null ? "null" : "") + detail);
            }

            try
            {
                File.WriteAllText(Path.Combine(dossier, "sonde-reserve.txt"),
                                  string.Join(Environment.NewLine, lignes));
                Log.LogInfo("[BazaarScanner] sonde-reserve.txt écrit.");
            }
            catch { }
        }
#endif

        /* ── Sonde : où le jeu range-t-il l'avancement des quêtes ? ─────────
           Les descriptions publiées sont figées : « Slow 15 times (0/15) »
           reste à zéro. Le jeu, lui, tient un compteur sur l'exemplaire de
           l'objet. Cette sonde décrit, pour chaque objet du plateau, tout ce
           qui parle de quête, de progression ou de compteur, sur deux niveaux,
           ainsi que la liste complète des membres de la première carte, au cas
           où le compteur porterait un nom inattendu.

           Elle ne tourne que si le fichier témoin « sonder-quetes » est posé à
           côté de la DLL, et n'écrit qu'une fois : posez d'abord un objet à
           quête sur le plateau, faites avancer sa quête, puis posez le témoin. */
        private static bool _sondeQuetesFaite;

        private static readonly System.Text.RegularExpressions.Regex MotsQuete =
            new System.Text.RegularExpressions.Regex(
                "quest|progress|count|goal|target|requirement|condition|complete",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

#if SONDES
        private void SonderQuetes(object joueur)
        {
            if (_sondeQuetesFaite || joueur == null) return;

            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-quetes"))) return;

            _sondeQuetesFaite = true;
            var lignes = new List<string>();

            /* Le joueur lui-même : l'avancement des quêtes pourrait y être
               rangé plutôt que sur chaque objet. */
            lignes.Add("=== Le joueur : ce qui parle de quête");
            Decrire(joueur, "    ", 0, true, lignes, new List<object>());
            lignes.Add("");

            /* Le plateau ET la réserve : un objet à quête est souvent rangé. */
            foreach (var nomConteneur in new[] { "Hand", "Stash" })
            {
                object conteneur = null;
                try { conteneur = joueur.GetType().GetProperty(nomConteneur)?.GetValue(joueur); } catch { }
                var container = (conteneur as CardContainer)?.Container;
                if (container == null) { lignes.Add("(" + nomConteneur + " introuvable)"); continue; }

                foreach (var (socketable, socketId) in container.GetCardsAndSockets())
                {
                    if (socketable is not ItemCard carte) continue;

                    /* Seuls les objets dont le modèle définit une quête. */
                    var modele = carte.Template;
                    var aQuete = false;
                    foreach (var m in MembresDe(modele))
                    {
                        if (m.Key.IndexOf("quest", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        if (m.Value is System.Collections.IEnumerable liste && !(m.Value is string))
                        {
                            foreach (var _ in liste) { aQuete = true; break; }
                        }
                        else if (m.Value != null) aQuete = true;
                    }
                    if (!aQuete) continue;

                    lignes.Add("=== " + (modele?.InternalName ?? "?") + "  (" + nomConteneur
                               + ", emplacement " + (int)socketId + ", " + carte.Tier + ")");

                    lignes.Add("  Tous ses attributs :");
                    try
                    {
                        foreach (var a in carte.Attributes)
                            lignes.Add("    [" + a.Key + "] = " + a.Value);
                    }
                    catch { lignes.Add("    (illisibles)"); }

                    lignes.Add("  Ses quêtes, telles que le modèle les définit :");
                    Decrire(modele, "    ", 0, true, lignes, new List<object>());
                    lignes.Add("");
                }
            }

            try
            {
                File.WriteAllText(Path.Combine(dossier, "sonde-quetes.txt"),
                                  string.Join(Environment.NewLine, lignes));
                Log.LogInfo("[BazaarScanner] sonde-quetes.txt écrit.");
            }
            catch { }
        }
#endif

        /* Les propriétés et champs d'un objet, lus sans jamais faire échouer
           la sonde. */
        private static List<KeyValuePair<string, object>> MembresDe(object o)
        {
            var res = new List<KeyValuePair<string, object>>();
            if (o == null) return res;
            var drapeaux = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

            foreach (var p in o.GetType().GetProperties(drapeaux))
            {
                if (p.GetIndexParameters().Length > 0) continue;
                object v = null;
                try { v = p.GetValue(o); } catch { continue; }
                res.Add(new KeyValuePair<string, object>(p.Name, v));
            }
            foreach (var f in o.GetType().GetFields(drapeaux))
            {
                if (f.Name.Contains("k__BackingField")) continue;
                object v = null;
                try { v = f.GetValue(o); } catch { continue; }
                res.Add(new KeyValuePair<string, object>(f.Name, v));
            }
            return res;
        }

        private static string Court(object v)
        {
            if (v == null) return "null";
            string t;
            try { t = v.ToString(); } catch { t = "?"; }
            var nomType = v.GetType().Name;
            if (t == v.GetType().FullName) t = "";
            if (t.Length > 110) t = t.Substring(0, 110) + "…";
            return "[" + nomType + "] " + t;
        }

        private static bool Simple(object v)
        {
            return v == null || v is string || v.GetType().IsPrimitive || v is Enum
                || v is decimal || v is Guid;
        }

        /* Décrit un objet : à la racine, seuls les membres dont le nom parle de
           quête ; dans ce qu'on a ainsi trouvé, tout. Deux niveaux au plus, et
           jamais deux fois le même objet. */
        private static void Decrire(object o, string retrait, int profondeur, bool filtrer,
                                    List<string> lignes, List<object> vus)
        {
            if (o == null || profondeur > 2) return;
            if (vus.Any(x => ReferenceEquals(x, o))) return;
            vus.Add(o);

            foreach (var m in MembresDe(o))
            {
                if (filtrer && !MotsQuete.IsMatch(m.Key)) continue;

                lignes.Add(retrait + m.Key.PadRight(30) + Court(m.Value));
                if (Simple(m.Value)) continue;

                if (m.Value is System.Collections.IDictionary dico)
                {
                    var n = 0;
                    foreach (System.Collections.DictionaryEntry e in dico)
                    {
                        var cle = e.Key?.ToString() ?? "?";
                        if (filtrer && !MotsQuete.IsMatch(cle) && !MotsQuete.IsMatch(m.Key)) continue;
                        lignes.Add(retrait + "  [" + cle + "] = " + Court(e.Value));
                        if (++n >= 40) { lignes.Add(retrait + "  …"); break; }
                    }
                    continue;
                }

                if (m.Value is System.Collections.IEnumerable liste)
                {
                    var n = 0;
                    foreach (var element in liste)
                    {
                        lignes.Add(retrait + "  #" + n + " " + Court(element));
                        if (!Simple(element))
                            Decrire(element, retrait + "      ", profondeur + 1, false, lignes, vus);
                        if (++n >= 8) { lignes.Add(retrait + "  …"); break; }
                    }
                    continue;
                }

                Decrire(m.Value, retrait + "    ", profondeur + 1, false, lignes, vus);
            }
        }

#if SONDES
        /* ── Sonde : où le jeu résout-il les valeurs des infobulles ? ───────
           Certaines valeurs dépendent de la partie en cours, « 5 % de votre
           Santé max » : l'export ne peut pas les calculer et écrit « - ». Le
           jeu, lui, les calcule pour son infobulle. Cette sonde LISTE les
           fonctions du jeu dont le nom évoque les infobulles, les jetons, la
           résolution ou le formatage, avec leurs paramètres. Elle n'en appelle
           aucune : c'est une simple lecture, sans risque pour la partie.

           Témoin « sonder-infobulles », une seule écriture. */
        private static bool _sondeInfobullesFaite;

        private void SonderInfobulles()
        {
            if (_sondeInfobullesFaite) return;
            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-infobulles"))) return;
            _sondeInfobullesFaite = true;

            var nomFonction = new System.Text.RegularExpressions.Regex(
                "tooltip|token|resolve|format|placeholder|interpolat|replace|evaluat|getvalue|calculat",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var lignes = new List<string>();
            var drapeaux = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance
                         | BindingFlags.Static | BindingFlags.DeclaredOnly;

            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var nomAsm = asm.GetName().Name ?? "";
                if (!(nomAsm.StartsWith("Bazaar") || nomAsm.StartsWith("TheBazaar")
                      || nomAsm.StartsWith("Assembly-CSharp") || nomAsm.StartsWith("Tempo"))) continue;

                Type[] types;
                try { types = asm.GetTypes(); }
                catch (ReflectionTypeLoadException e) { types = e.Types.Where(t => t != null).ToArray(); }
                catch { continue; }

                foreach (var t in types)
                {
                    MethodInfo[] methodes;
                    try { methodes = t.GetMethods(drapeaux); } catch { continue; }

                    foreach (var m in methodes)
                    {
                        if (m.IsSpecialName) continue;
                        var typeParle = (t.FullName ?? t.Name).IndexOf("Tooltip", StringComparison.OrdinalIgnoreCase) >= 0;
                        if (!typeParle && !nomFonction.IsMatch(m.Name)) continue;

                        string sig;
                        try
                        {
                            sig = string.Join(", ", m.GetParameters()
                                .Select(p => p.ParameterType.Name + " " + p.Name));
                        }
                        catch { sig = "?"; }

                        /* On ne garde que ce qui touche aux cartes, aux infobulles
                           ou au texte : le reste du jeu noierait la liste. */
                        var tout = (t.FullName + " " + m.Name + " " + sig + " " + m.ReturnType.Name);
                        if (!System.Text.RegularExpressions.Regex.IsMatch(tout,
                                "card|tooltip|token|ability|aura|attribute|text|string",
                                System.Text.RegularExpressions.RegexOptions.IgnoreCase)) continue;

                        lignes.Add(nomAsm + " | " + (t.FullName ?? t.Name) + "." + m.Name
                                   + "(" + sig + ") : " + m.ReturnType.Name
                                   + (m.IsStatic ? "   [statique]" : ""));
                        if (lignes.Count >= 1500) break;
                    }
                    if (lignes.Count >= 1500) break;
                }
            }

            try
            {
                lignes.Sort(StringComparer.Ordinal);
                File.WriteAllText(Path.Combine(dossier, "sonde-infobulles.txt"),
                                  lignes.Count + " fonction(s)" + Environment.NewLine + Environment.NewLine
                                  + string.Join(Environment.NewLine, lignes));
                Log.LogInfo("[BazaarScanner] sonde-infobulles.txt écrit.");
            }
            catch { }
        }
#endif

        /* ── Sonde : les valeurs que le jeu donne à chaque jeton ────────────
           Le jeu prépare l'infobulle d'une carte avec
           CardTooltipData.CreateCardTooltipData(carte). Ses constructeurs
           d'infobulles contiennent les jetons de la carte, et chaque jeton se
           résout par Resolve(), avec la partie en cours : « 5 % de votre Santé
           max » y devient un nombre. Cette sonde relève, pour chaque objet du
           plateau et de la réserve, chaque jeton, ce qui l'identifie et sa
           valeur, ainsi que le texte rendu, pour comparer.

           Elle n'appelle que des fonctions qui PRÉPARENT une infobulle, sans
           rien changer à la partie. Témoin « sonder-jetons », une écriture. */
        private static bool _sondeJetonsFaite;

        private static Type TrouverType(string nomComplet)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { var t = asm.GetType(nomComplet, false); if (t != null) return t; } catch { }
            }
            return null;
        }

        private static string Erreur(Exception e)
        {
            var ie = e is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : e;
            return ie.GetType().Name + " : " + ie.Message;
        }

#if SONDES
        private void SonderJetons(object joueur)
        {
            if (_sondeJetonsFaite || joueur == null) return;
            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-jetons"))) return;
            _sondeJetonsFaite = true;

            var lignes = new List<string>();
            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;

            var typeDonnees = TrouverType("TheBazaar.Tooltips.CardTooltipData");
            var creer = typeDonnees?.GetMethods(tous).FirstOrDefault(m => m.Name == "CreateCardTooltipData"
                                                                     && m.GetParameters().Length == 1);
            lignes.Add("CardTooltipData : " + (typeDonnees != null ? "trouvé" : "INTROUVABLE")
                       + ", CreateCardTooltipData : " + (creer != null ? "trouvée" : "INTROUVABLE"));
            lignes.Add("");

            if (creer != null)
            {
                foreach (var nomConteneur in new[] { "Hand", "Stash" })
                {
                    var container = (ValeurDe(joueur, nomConteneur) as CardContainer)?.Container;
                    if (container == null) continue;

                    foreach (var (socketable, socketId) in container.GetCardsAndSockets())
                    {
                        if (socketable is not ItemCard carte) continue;
                        lignes.Add("=== " + (carte.Template?.InternalName ?? "?") + "  (" + nomConteneur
                                   + ", " + carte.Tier + ")");

                        object donnees;
                        try { donnees = creer.Invoke(null, new object[] { carte }); }
                        catch (Exception e) { lignes.Add("  préparation impossible : " + Erreur(e)); lignes.Add(""); continue; }

                        DecrireDonneesInfobulle(donnees, lignes);
                        lignes.Add("");
                    }
                }
            }

            /* Les cartes de la bande : rencontres, récompenses, événements. Leur
               texte est une description d'étape, que le jeu ne prépare peut-être
               pas comme une infobulle d'objet. */
            if (creer != null)
            {
                foreach (var paire in CartesAffichees("OpponentSocket_").OrderBy(k => k.Key))
                {
                    var carte = paire.Value;
                    lignes.Add("=== bande " + paire.Key + " : " + carte.GetType().Name + "  "
                               + (ValeurDe(ValeurDe(carte, "Template"), "InternalName") ?? "?"));
                    if (!creer.GetParameters()[0].ParameterType.IsInstanceOfType(carte))
                    {
                        lignes.Add("  le jeu ne prépare pas d'infobulle pour ce type");
                        lignes.Add("");
                        continue;
                    }
                    object donnees;
                    try { donnees = creer.Invoke(null, new[] { carte }); }
                    catch (Exception e) { lignes.Add("  préparation impossible : " + Erreur(e)); lignes.Add(""); continue; }
                    DecrireDonneesInfobulle(donnees, lignes);
                    lignes.Add("");
                }
            }

            try
            {
                File.WriteAllText(Path.Combine(dossier, "sonde-jetons.txt"), string.Join(Environment.NewLine, lignes));
                Log.LogInfo("[BazaarScanner] sonde-jetons.txt écrit.");
            }
            catch { }
        }
#endif

#if SONDES
        /* ── Sonde : d'où vient la valeur d'un jeton sur une étape de rencontre ?
           « Heroic Encounters » : « Gain {ability.0.mod} Prestige for each Player
           fight you have lost this run [{ability.0}] ». Pour un objet, le jeu
           résout chaque jeton dans son infobulle ; pour une étape, il ne rend
           que la phrase finie. Cette sonde décrit, pour chaque étape affichée,
           sa capacité « 0 » telle que le modèle et la carte la portent, et la
           liste des fonctions qui pourraient en calculer la valeur. Elle
           n'appelle AUCUNE fonction du jeu : simple lecture.

           Témoin « sonder-etapes », à placer à côté de la DLL ; une seule
           écriture, dans « sonde-etapes.txt ». */
        private static bool _sondeEtapesFaite;

        private void SonderEtapes()
        {
            if (_sondeEtapesFaite) return;
            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-etapes"))) return;

            var etapes = CartesAffichees("OpponentSocket_")
                .Where(k => (ValeurDe(k.Value, "Type")?.ToString() ?? "").IndexOf("EncounterStep", StringComparison.OrdinalIgnoreCase) >= 0
                         || k.Value.GetType().Name.IndexOf("EncounterStep", StringComparison.OrdinalIgnoreCase) >= 0)
                /* Heroic Encounters d'abord : c'est elle qui nous intéresse. */
                .OrderBy(k => (ValeurDe(ValeurDe(k.Value, "Template"), "InternalName")?.ToString() ?? "")
                               .IndexOf("Heroic", StringComparison.OrdinalIgnoreCase) >= 0 ? 0 : 1)
                .ThenBy(k => k.Key)
                .ToList();
            if (etapes.Count == 0) return;           // on attendra qu'une étape soit à l'écran
            _sondeEtapesFaite = true;

            var lignes = new List<string>();
            var vusTypes = new HashSet<Type>();

            /* Les attributs du joueur : la valeur d'une capacité d'étape renvoie
               souvent à l'un d'eux (« combats perdus cette partie »). */
            var joueur = ValeurDe(Data.Run, "Player");
            lignes.Add("=== Attributs du joueur");
            try
            {
                if (ValeurDe(joueur, "Attributes") is System.Collections.IDictionary attrsJ)
                    foreach (System.Collections.DictionaryEntry e in attrsJ) lignes.Add("    " + e.Key + " = " + e.Value);
                else lignes.Add("    (pas de dictionnaire « Attributes » : " + Court(ValeurDe(joueur, "Attributes")) + ")");
            }
            catch (Exception e) { lignes.Add("    illisibles : " + Erreur(e)); }
            lignes.Add("");

            foreach (var paire in etapes)
            {
                var carte = paire.Value;
                var modele = ValeurDe(carte, "Template");
                var debut = lignes.Count;
                lignes.Add("=== emplacement " + paire.Key + " : " + carte.GetType().FullName + "  "
                           + (ValeurDe(modele, "InternalName") ?? "?"));

                lignes.Add("  -- Attributs de la carte :");
                try
                {
                    if (ValeurDe(carte, "Attributes") is System.Collections.IEnumerable attrs)
                        foreach (var x in attrs) lignes.Add("    " + Court(x));
                }
                catch (Exception e) { lignes.Add("    illisibles : " + Erreur(e)); }

                /* Chaque capacité et aura en entier : ce sont des « records »,
                   leur texte décrit toute leur structure en une ligne. */
                foreach (var nom in new[] { "Abilities", "Auras" })
                {
                    if (!(ValeurDe(modele, nom) is System.Collections.IDictionary dico)) continue;
                    foreach (System.Collections.DictionaryEntry e in dico)
                    {
                        string texte;
                        try { texte = e.Value?.ToString() ?? "null"; } catch (Exception x) { texte = "illisible : " + Erreur(x); }
                        if (texte.Length > 4000) texte = texte.Substring(0, 4000) + "…";
                        lignes.Add("  -- " + nom + "[" + e.Key + "] :");
                        lignes.Add("    " + texte);
                        lignes.Add("    Détail :");
                        DecrireProfond(e.Value, "      ", 0, 4, lignes, new List<object>(), debut + 900);
                    }
                }

                /* Les fonctions des types du jeu rencontrés dans les capacités :
                   action, valeur, modificateur, cible. Toutes, pas seulement
                   celles dont le nom évoque un calcul. */
                lignes.Add("  -- Fonctions des types du jeu :");
                var aExaminer = new List<object>();
                ColleterObjets(ValeurDe(modele, "Abilities"), aExaminer, 0);
                foreach (var o in aExaminer)
                {
                    var t = o.GetType();
                    if (!vusTypes.Add(t)) continue;
                    ListerFonctions(t, "    ", lignes);
                }
                lignes.Add("");
            }

            try
            {
                File.WriteAllText(Path.Combine(dossier, "sonde-etapes.txt"), string.Join(Environment.NewLine, lignes));
                Log.LogInfo("[BazaarScanner] sonde-etapes.txt écrit.");
            }
            catch { }
        }
#endif

#if SONDES
        /* ── Sonde du mode de jeu ───────────────────────────────────────────
           En partie classée, « Run.PlayMode » vaut « Unranked », et en partie
           normale aussi (relevés du 11 octobre) : ce champ ne dit pas le mode.
           Cette sonde décrit, une fois par partie, tout ce que le jeu expose
           autour de la partie : l'objet Run en entier, et les propriétés de
           Data, en détaillant celles dont le nom évoque un mode, une file
           d'attente, une saison ou un classement. On compare ensuite le
           fichier d'une partie normale avec celui d'une partie classée.

           Témoin « sonder-mode », à placer à côté de la DLL. Les relevés
           s'ajoutent à la suite dans « sonde-mode.txt ». Simple lecture. */
        private static object _runSondeMode;

        private void SonderMode()
        {
            var run = Data.Run;
            if (run == null || ReferenceEquals(run, _runSondeMode)) return;
            var dossier = Path.GetDirectoryName(_outputPath);
            if (!File.Exists(Path.Combine(dossier, "sonder-mode"))) return;
            /* On attend que la partie soit vraiment lancée : un jour connu. */
            if (!(ValeurDe(run, "Day") is object jour)) return;
            _runSondeMode = run;

            var lignes = new List<string>();
            lignes.Add("==================== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
                       + "  jour " + jour + " ====================");
            try
            {
                lignes.Add("=== Data.Run (" + run.GetType().FullName + ")");
                DecrireProfond(run, "  ", 0, 2, lignes, new List<object>(), 1500);

                var motif = new System.Text.RegularExpressions.Regex("rank|mode|queue|season|ladder|match|lobby|league|elo|mmr|competit",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                var typeData = typeof(Data);
                lignes.Add("");
                lignes.Add("=== Propriétés et champs statiques de " + typeData.FullName);
                var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
                var membres = new List<KeyValuePair<string, object>>();
                foreach (var pr in typeData.GetProperties(tous))
                {
                    if (pr.GetIndexParameters().Length > 0) continue;
                    object v = null;
                    try { v = pr.GetValue(null); } catch { continue; }
                    membres.Add(new KeyValuePair<string, object>(pr.Name, v));
                }
                foreach (var ch in typeData.GetFields(tous))
                {
                    if (ch.Name.Contains("<")) continue;
                    object v = null;
                    try { v = ch.GetValue(null); } catch { continue; }
                    membres.Add(new KeyValuePair<string, object>(ch.Name, v));
                }
                foreach (var m in membres.OrderBy(x => x.Key))
                {
                    lignes.Add("  " + m.Key + " = " + Court(m.Value) + (m.Value != null ? "   [" + m.Value.GetType().Name + "]" : ""));
                    if (m.Value != null && motif.IsMatch(m.Key) && !ReferenceEquals(m.Value, run))
                        DecrireProfond(m.Value, "      ", 0, 2, lignes, new List<object>(), lignes.Count + 400);
                }
            }
            catch (Exception e) { lignes.Add("  (erreur : " + Erreur(e) + ")"); }
            lignes.Add("");

            try
            {
                File.AppendAllText(Path.Combine(dossier, "sonde-mode.txt"), string.Join(Environment.NewLine, lignes) + Environment.NewLine);
                Log.LogInfo("[BazaarScanner] sonde-mode.txt complété.");
            }
            catch { }
        }
#endif

        /* Ce que la sonde ne décrit jamais : la mécanique de .NET elle-même
           (types, modules, assemblages), qui noyait tout le reste. */
        private static bool Mecanique(string nom, object v)
        {
            if (nom == "EqualityContract") return true;
            if (v == null) return false;
            if (v is Type || v is MemberInfo || v is Module || v is Assembly) return true;
            var ns = v.GetType().Namespace ?? "";
            return ns.StartsWith("System.Reflection") || ns.StartsWith("Mono");
        }

        /* Décrit un objet sur plusieurs niveaux, listes et dictionnaires compris,
           sans jamais repasser par le même objet ni faire échouer la sonde. */
        private static void DecrireProfond(object o, string retrait, int profondeur, int maxi,
                                           List<string> lignes, List<object> vus, int plafond = 4000)
        {
            if (o == null || profondeur > maxi || lignes.Count > plafond) return;
            if (!(o is string) && !o.GetType().IsValueType)
            {
                if (vus.Any(x => ReferenceEquals(x, o))) return;
                vus.Add(o);
            }

            if (o is System.Collections.IDictionary dico)
            {
                var n = 0;
                foreach (System.Collections.DictionaryEntry e in dico)
                {
                    lignes.Add(retrait + "[" + (e.Key?.ToString() ?? "?") + "] = " + Court(e.Value));
                    if (!Simple(e.Value)) DecrireProfond(e.Value, retrait + "    ", profondeur + 1, maxi, lignes, vus, plafond);
                    if (++n >= 20) { lignes.Add(retrait + "…"); break; }
                }
                return;
            }
            if (o is System.Collections.IEnumerable liste && !(o is string))
            {
                var n = 0;
                foreach (var x in liste)
                {
                    lignes.Add(retrait + "#" + n + " " + Court(x));
                    if (!Simple(x)) DecrireProfond(x, retrait + "    ", profondeur + 1, maxi, lignes, vus, plafond);
                    if (++n >= 8) { lignes.Add(retrait + "…"); break; }
                }
                return;
            }

            foreach (var m in MembresDe(o))
            {
                if (Mecanique(m.Key, m.Value)) continue;
                lignes.Add(retrait + m.Key.PadRight(30) + Court(m.Value));
                if (!Simple(m.Value)) DecrireProfond(m.Value, retrait + "    ", profondeur + 1, maxi, lignes, vus, plafond);
            }
        }

        /* Rassemble les objets d'une capacité (action, valeur, cible…) pour en
           lister les fonctions. Seulement ceux du jeu. */
        private static void ColleterObjets(object o, List<object> res, int profondeur)
        {
            if (o == null || profondeur > 5 || Simple(o) || res.Count > 60) return;
            if (res.Any(x => ReferenceEquals(x, o))) return;
            if (o is System.Collections.IDictionary dico)
            {
                foreach (System.Collections.DictionaryEntry e in dico) ColleterObjets(e.Value, res, profondeur + 1);
                return;
            }
            if (o is System.Collections.IEnumerable liste && !(o is string))
            {
                foreach (var x in liste) ColleterObjets(x, res, profondeur + 1);
                return;
            }
            var ns = o.GetType().Namespace ?? "";
            if (!ns.StartsWith("Bazaar") && !ns.StartsWith("TheBazaar")) return;
            res.Add(o);
            foreach (var m in MembresDe(o))
                if (!Mecanique(m.Key, m.Value)) ColleterObjets(m.Value, res, profondeur + 1);
        }

        private static readonly System.Text.RegularExpressions.Regex MotsCalcul =
            new System.Text.RegularExpressions.Regex("resolve|evaluat|calcul|compute|getvalue|value|amount|count",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        private static void ListerFonctions(Type t, string retrait, List<string> lignes)
        {
            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static
                     | BindingFlags.DeclaredOnly;
            var methodes = new List<MethodInfo>();
            /* Le type et ses parents du jeu : une valeur de référence hérite
               souvent de son calcul. */
            for (var u = t; u != null && u != typeof(object); u = u.BaseType)
            {
                try { methodes.AddRange(u.GetMethods(tous).Where(m => !m.IsSpecialName
                        && m.Name != "Equals" && m.Name != "GetHashCode" && m.Name != "ToString"
                        && m.Name != "PrintMembers" && m.Name != "<Clone>$" && !m.Name.StartsWith("op_"))); }
                catch { }
            }
            if (methodes.Count == 0) return;
            lignes.Add(retrait + t.FullName + (t.BaseType != null && t.BaseType != typeof(object) ? "  : " + t.BaseType.Name : "") + " :");
            foreach (var mi in methodes.Take(40))
            {
                string pars;
                try { pars = string.Join(", ", mi.GetParameters().Select(x => x.ParameterType.Name + " " + x.Name)); }
                catch { pars = "?"; }
                lignes.Add(retrait + "  " + (mi.IsStatic ? "static " : "") + mi.ReturnType.Name + " " + mi.Name + "(" + pars + ")"
                           + (mi.DeclaringType != t ? "   [" + mi.DeclaringType?.Name + "]" : ""));
            }
        }

        /* Ce que prépare le jeu pour une carte : ses infobulles actives et
           passives, et sa description. Chaque préparation rend une paire ; on
           décrit ses deux membres, liste ou non. */
        private static void DecrireDonneesInfobulle(object donnees, List<string> lignes)
        {
            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            foreach (var nomMethode in new[] { "GetCurrentActiveTooltipBuilders", "GetCurrentPassiveTooltipBuilders", "GetCardDescription" })
            {
                object res = null;
                try
                {
                    var m = donnees.GetType().GetMethods(tous).FirstOrDefault(x => x.Name == nomMethode && x.GetParameters().Length == 0);
                    res = m?.Invoke(donnees, null);
                }
                catch (Exception e) { lignes.Add("  " + nomMethode + " : " + Erreur(e)); continue; }

                lignes.Add("  " + nomMethode + " -> " + Court(res));
                foreach (var champ in new[] { "Item1", "Item2" })
                {
                    var v = ValeurDe(res, champ);
                    if (v == null) continue;
                    lignes.Add("    " + champ + " : " + Court(v));
                    if (v is string) continue;
                    if (v is System.Collections.IEnumerable liste)
                    {
                        var n = 0;
                        foreach (var x in liste) { DecrireConstructeur(x, "      ", lignes); if (++n >= 6) break; }
                    }
                    else DecrireConstructeur(v, "      ", lignes);
                }
            }
        }

        /* Un constructeur d'infobulle : son texte rendu, puis chacun de ses
           jetons, avec ce qui l'identifie et sa valeur résolue. */
        private static void DecrireConstructeur(object constructeur, string retrait, List<string> lignes)
        {
            if (constructeur == null) return;
            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

            try
            {
                var rendu = constructeur.GetType().GetMethod("Render", tous, null, Type.EmptyTypes, null)
                            ?.Invoke(constructeur, null) as string;
                lignes.Add(retrait + "rendu : " + (rendu ?? "(rien)"));
            }
            catch (Exception e) { lignes.Add(retrait + "rendu impossible : " + Erreur(e)); }

            foreach (var m in MembresDe(constructeur))
            {
                if (!(m.Value is System.Collections.IEnumerable liste) || m.Value is string) continue;
                foreach (var composant in liste)
                    DecrireComposant(composant, retrait + "  ", lignes, 0);
            }
        }

        private static void DecrireComposant(object composant, string retrait, List<string> lignes, int profondeur)
        {
            if (composant == null || profondeur > 2) return;
            var nomType = composant.GetType().Name;
            if (nomType.IndexOf("Tooltip", StringComparison.OrdinalIgnoreCase) < 0) return;

            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            string valeur = "-";
            var resoudre = composant.GetType().GetMethod("Resolve", tous, null, Type.EmptyTypes, null);
            if (resoudre != null)
            {
                try { valeur = Court(resoudre.Invoke(composant, null)); }
                catch (Exception e) { valeur = "erreur : " + Erreur(e); }
            }

            /* Ce qui identifie le jeton : ses champs simples, comme l'effet visé
               ou l'accesseur. */
            var simples = MembresDe(composant).Where(x => Simple(x.Value) || x.Value is Enum)
                .Select(x => x.Key + "=" + (x.Value?.ToString() ?? "null")).Take(8);
            lignes.Add(retrait + nomType + "  [" + string.Join(", ", simples) + "]  => " + valeur);

            foreach (var m in MembresDe(composant))
            {
                if (m.Value is System.Collections.IEnumerable liste && !(m.Value is string))
                    foreach (var sous in liste) DecrireComposant(sous, retrait + "  ", lignes, profondeur + 1);
            }
        }

        private void WriteBoardState()
        {
            var run = Data.Run;
            if (run?.Player == null)
            {
                File.WriteAllText(_outputPath, "{\"ready\":false}");
                return;
            }
#if SONDES
            /* Les sondes de développement : absentes de la DLL distribuée, elles
               n'existent que dans une version compilée avec SONDES. */
            SonderReserve(run.Player);
            SonderQuetes(run.Player);
            SonderInfobulles();
            SonderJetons(run.Player);
            SonderEtapes();
            SonderMode();
#endif

            _affichesEnCours = CartesAffichees("PlayerSocket_");
            var board = ReadContainerItems(run.Player.Hand);
            _affichesEnCours = null;

            var effets = LireEffetsEmplacement();
            if (effets.Count > 0)
            {
                RattacherEffets(board, effets);
            }

            var skills = ReadSkills(run.Player);

            LireBandes();
            var face = _face;

            /* La réserve vient de run.Player.Stash, comme le plateau vient de
               Hand. LireBandes() ne voyait que les cartes AFFICHÉES : la
               réserve disparaissait dès que le joueur refermait son coffre.

               On garde la lecture par affichage en repli, pour le cas où le
               jeu renommerait ce conteneur. */
            var reserve = ReadContainerItems(run.Player.Stash);
            if (reserve.Count == 0) reserve = _reserve;

            var effetsAdverses = LireEffetsDe(run.Opponent);
            if (effetsAdverses.Count > 0) RattacherEffets(face, effetsAdverses);
            var faceSkills = LireTalentsAdverses(run, face);

            var enCombat = false;
            try
            {
                var adv = run.GetType().GetProperty("Opponent")?.GetValue(run);
                var main = adv?.GetType().GetProperty("Hand")?.GetValue(adv);
                enCombat = ReadContainerItems(main).Count > 0;
            }
            catch { }

            var state = new BoardState
            {
                Ready = true,
                Hero = run.Player.Hero.ToString(),
                Language = _currentLang,
                Board = board,
                Skills = skills,
                Face = face,
                Reserve = reserve,

                /* La réserve telle qu'elle est AFFICHÉE : vide tant que le
                   joueur n'ouvre pas son coffre. Elle sert à poser les zones
                   de survol là où le jeu dessine les objets, ce que la
                   réserve complète ne permet pas puisqu'elle existe même
                   coffre fermé. */
                ReserveAffichee = _reserve,
                FaceCentree = !enCombat,
                FaceSkills = faceSkills,
                Mod = VERSION_MOD,
                VersionJeu = _versionJeu,
            };
            LireCompteurs(run, state);

            if (System.Threading.Interlocked.CompareExchange(ref _ecritureEnCours, 1, 0) == 0)
            {
                System.Threading.ThreadPool.QueueUserWorkItem(_ =>
                {
                    try
                    {
                        var json = JsonConvert.SerializeObject(state, Formatting.Indented);

                        var temporaire = _outputPath + ".tmp";
                        File.WriteAllText(temporaire, json);
                        if (File.Exists(_outputPath)) File.Delete(_outputPath);
                        File.Move(temporaire, _outputPath);
                    }
                    catch (Exception ex)
                    {
                        LogLimite("ecriture", "Erreur ecriture board: " + ex.Message);
                    }
                    finally
                    {
                        System.Threading.Interlocked.Exchange(ref _ecritureEnCours, 0);
                    }
                });
            }
        }

        private static void LoadExtractedCardsCache()
        {
            if (File.Exists(_cardsDbPath))
            {
                try
                {
                    var json = File.ReadAllText(_cardsDbPath);
                    var loaded = JsonConvert.DeserializeObject<Dictionary<string, object>>(json);
                    if (loaded != null)
                    {
                        foreach (var kv in loaded)
                        {
                            _extractedCards[kv.Key] = kv.Value;
                            _extractedCardsSignature[kv.Key] = JsonConvert.SerializeObject(kv.Value, Formatting.None);
                        }
                    }
                    Log.LogInfo("[CardsDB] " + _extractedCards.Count + " cartes deja extraites chargees depuis le cache.");
                }
                catch (Exception ex)
                {
                    Log.LogWarning("[CardsDB] Erreur chargement cache: " + ex.Message);
                }
            }

            if (File.Exists(_cardsDbPathEn) &&
                !string.Equals(_cardsDbPath, _cardsDbPathEn, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var jsonEn = File.ReadAllText(_cardsDbPathEn);
                    var loadedEn = JsonConvert.DeserializeObject<Dictionary<string, object>>(jsonEn);
                    if (loadedEn != null)
                        foreach (var kv in loadedEn) _extractedCardsEn[kv.Key] = kv.Value;
                    Log.LogInfo("[CardsDB] " + _extractedCardsEn.Count + " cartes anglaises chargees depuis le cache.");
                }
                catch (Exception ex)
                {
                    Log.LogWarning("[CardsDB] Erreur chargement cache anglais: " + ex.Message);
                }
            }
        }

        private static readonly Dictionary<string, string> _translations = new Dictionary<string, string>();
        private static bool _translationsLoaded = false;

        private static void LoadTranslations()
        {
            _translationsLoaded = true;
            _translations.Clear();

            if (_currentLang == "en") return; // rien a traduire

            var csvPath = Path.Combine(_dllDir, $"translations_{_currentLang}.csv");
            if (!File.Exists(csvPath))
            {
                Log.LogWarning($"[Trans] Fichier de traductions introuvable : {csvPath} (les cartes resteront en anglais)");
                return;
            }

            try
            {
                var content = File.ReadAllText(csvPath, Encoding.UTF8);
                var rows = ParseCsv(content);
                if (rows.Count < 2)
                {
                    Log.LogWarning("[Trans] CSV vide ou illisible.");
                    return;
                }

                var header = rows[0];
                int engIdx = Array.IndexOf(header, "English");
                int textIdx = Array.IndexOf(header, "Translation");

                if (engIdx < 0 || textIdx < 0)
                {
                    Log.LogWarning("[Trans] Colonnes attendues introuvables. En-têtes lues : " + string.Join(" | ", header));
                    return;
                }

                int count = 0;
                for (int r = 1; r < rows.Count; r++)
                {
                    var row = rows[r];
                    if (row.Length <= Math.Max(engIdx, textIdx)) continue;

                    var eng = row[engIdx];
                    if (string.IsNullOrEmpty(eng)) continue;

                    var text = row[textIdx];
                    if (string.IsNullOrEmpty(text)) continue;

                    _translations[eng] = text;
                    count++;
                }

                Log.LogInfo($"[Trans] {count} traductions chargées depuis {Path.GetFileName(csvPath)}");
            }
            catch (Exception ex)
            {
                Log.LogWarning("[Trans] Erreur chargement CSV : " + ex.Message);
            }
        }

        private static List<string[]> ParseCsv(string content)
        {
            var rows = new List<string[]>();
            var fields = new List<string>();
            var sb = new StringBuilder();
            bool inQuotes = false;
            int i = 0, len = content.Length;

            while (i < len)
            {
                char c = content[i];

                if (inQuotes)
                {
                    if (c == '"')
                    {
                        if (i + 1 < len && content[i + 1] == '"') { sb.Append('"'); i += 2; continue; }
                        inQuotes = false; i++; continue;
                    }
                    sb.Append(c); i++; continue;
                }

                if (c == '"') { inQuotes = true; i++; continue; }
                if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); i++; continue; }
                if (c == '\r') { i++; continue; }
                if (c == '\n')
                {
                    fields.Add(sb.ToString()); sb.Clear();
                    rows.Add(fields.ToArray());
                    fields = new List<string>();
                    i++; continue;
                }
                sb.Append(c); i++;
            }

            if (sb.Length > 0 || fields.Count > 0)
            {
                fields.Add(sb.ToString());
                rows.Add(fields.ToArray());
            }

            return rows;
        }

        private static string LocalizeText(object localizableText)
        {
            if (localizableText == null) return null;
            try
            {
                var t = localizableText.GetType();
                return t.GetProperty("Text")?.GetValue(localizableText)?.ToString();
            }
            catch
            {
                return null;
            }
        }

        private static void PatchLocalizedTexts(Newtonsoft.Json.Linq.JToken token)
        {
            if (token is Newtonsoft.Json.Linq.JObject obj)
            {
                var textToken = obj["Text"];
                if (textToken != null)
                {
                    var english = (string)textToken;
                    if (!string.IsNullOrEmpty(english) && _translations.TryGetValue(english, out var localized))
                        obj["Text"] = localized;
                }
                foreach (var prop in obj.Properties())
                    PatchLocalizedTexts(prop.Value);
            }
            else if (token is Newtonsoft.Json.Linq.JArray arr)
            {
                foreach (var item in arr)
                    PatchLocalizedTexts(item);
            }
        }

        private static volatile bool _vidageEnCours;
        private static bool _vidageFait;

        /* Le vidage du catalogue tourne sur un autre fil, et le relevé de chaque
           seconde écrit dans les mêmes dictionnaires : deux écritures
           simultanées peuvent corrompre un Dictionary (et le faire tourner en
           boucle). Un seul fil à la fois, et le relevé laisse la main au
           vidage tant qu'il dure. */
        private static readonly object _verrouCache = new object();
        [ThreadStatic] private static bool _filDuVidage;

        private static bool VidageDemande()
        {
#if !SONDES
            /* L'export du catalogue sert à publier les données, pas au
               streamer : la DLL distribuée l'ignore. */
            return false;
#else
            try
            {
                return File.Exists(Path.Combine(
                    Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".",
                    "extraire-catalogue"));
            }
            catch { return false; }
#endif
        }

        private static void EcrireCaches()
        {
            lock (_verrouCache)
                File.WriteAllText(_cardsDbPathEn,
                    JsonConvert.SerializeObject(_extractedCardsEn, Formatting.None));
        }

        private static void ViderCatalogue()
        {
            if (_vidageFait) return;
            if (!VidageDemande()) { _vidageFait = true; return; }

            object statique;
            try
            {
                if (!TheBazaar.Data.IsManagerCreated()) return;
                statique = TheBazaar.Data.GetStatic();

                if (statique is System.Threading.Tasks.Task tache)
                {
                    if (!tache.IsCompleted) return;
                    var resultat = tache.GetType().GetProperty("Result");
                    statique = resultat?.GetValue(tache);
                }
            }
            catch (Exception ex)
            {
                Log.LogWarning("[Catalogue] Donnees statiques inaccessibles : " + ex.Message);
                _vidageFait = true;      // inutile de reessayer indefiniment
                return;
            }

            if (statique == null) return;
            _vidageFait = true;

            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                _filDuVidage = true;
                try
                {
                    var methode = statique.GetType().GetMethod("GetCardMap",
                        BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (methode == null)
                    {
                        Log.LogWarning("[Catalogue] GetCardMap introuvable sur "
                            + statique.GetType().Name + " - le jeu a change d'interface.");
                        return;
                    }

                    var carte = methode.Invoke(statique, null) as System.Collections.IDictionary;
                    if (carte == null)
                    {
                        Log.LogWarning("[Catalogue] GetCardMap n'a rien renvoye d'exploitable.");
                        return;
                    }

                    Log.LogInfo("[Catalogue] " + carte.Count + " modele(s) de carte trouve(s). Extraction...");

                    var avant = _extractedCards.Count;
                    _vidageEnCours = true;
                    var echecs = 0;

                    foreach (System.Collections.DictionaryEntry entree in carte)
                    {
                        try
                        {
                            var id = entree.Key?.ToString();
                            if (string.IsNullOrEmpty(id) || entree.Value == null) continue;

                            TryExtractCardData(entree.Value, id);
                        }
                        catch { echecs++; }
                    }

                    _vidageEnCours = false;
                    EcrireCaches();

                    Log.LogInfo("[Catalogue] Extraction terminee : "
                        + _extractedCards.Count + " cartes en cache ("
                        + (_extractedCards.Count - avant) + " nouvelles)"
                        + (echecs > 0 ? ", " + echecs + " echec(s)" : "") + ".");
                }
                catch (Exception ex)
                {
                    _vidageEnCours = false;
                    Log.LogWarning("[Catalogue] Vidage interrompu : " + ex.Message);
                }
                finally
                {
                    _vidageEnCours = false;
                    _filDuVidage = false;
                }
            });
        }

        private sealed class ParReference : IEqualityComparer<object>
        {
            public static readonly ParReference Instance = new ParReference();
            public new bool Equals(object a, object b) { return ReferenceEquals(a, b); }
            public int GetHashCode(object o)
            {
                return System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(o);
            }
        }

        private static string NomDeCarte(object socketable)
        {
            try
            {
                var tpl = socketable?.GetType()
                    .GetProperty("Template")?.GetValue(socketable);
                if (tpl == null) return null;

                var loc = tpl.GetType().GetProperty("Localization")?.GetValue(tpl);
                if (loc == null) return null;

                var titre = loc.GetType().GetProperty("Title")?.GetValue(loc);
                return LocalizeText(titre);
            }
            catch { return null; }
        }

        private static void TryExtractCardData(object template, string templateId)
        {
            if (!VidageDemande()) return;

            if (template == null || string.IsNullOrEmpty(templateId)) return;
            if (_vidageEnCours && !_filDuVidage) return;

            lock (_verrouCache)
            try
            {
                if (!_translationsLoaded) LoadTranslations();

                var json = JsonConvert.SerializeObject(template, ExtractSettings);
                var jObj = Newtonsoft.Json.Linq.JObject.Parse(json);

                var objEn = Newtonsoft.Json.Linq.JObject.Parse(json).ToObject<object>();

                if (_translations.Count > 0)
                    PatchLocalizedTexts(jObj);

                var obj = jObj.ToObject<object>();
                var signature = JsonConvert.SerializeObject(obj, Formatting.None);

                if (_extractedCardsSignature.TryGetValue(templateId, out var previous)
                    && previous == signature
                    && _extractedCardsEn.ContainsKey(templateId))
                    return;

                _extractedCards[templateId] = obj;
                _extractedCardsEn[templateId] = objEn;
                _extractedCardsSignature[templateId] = signature;

                if (_vidageEnCours) return;

                EcrireCaches();

                Log.LogInfo("[CardsDB] Carte extraite/mise à jour (" + _extractedCardsEn.Count + " au total)."); 
            }
            catch (Exception ex)
            {
                Log.LogWarning("[CardsDB] Erreur extraction carte '" + templateId + "': " + ex.Message);
            }
        }

        private static List<CardInfo> ReadContainerItems(object inventory)
        {
            var result = new List<CardInfo>();
            if (inventory == null) return result;

            var container = (inventory as CardContainer)?.Container;
            if (container == null) return result;

            foreach (var (socketable, socketId) in container.GetCardsAndSockets())
            {
                if (socketable is not ItemCard itemCard) continue;

                var realId = itemCard.Template?.Id.ToString();
                TryExtractCardData(itemCard.Template, realId);

                result.Add(new CardInfo
                {
                    Name = LocalizeText(itemCard.Template?.Localization?.Title) ?? itemCard.Template?.InternalName,
                    InternalName = itemCard.Template?.InternalName,
                    TemplateId = realId ?? itemCard.TemplateId.ToString(),
                    Size = itemCard.Size.ToString(),
                    Tier = itemCard.Tier.ToString(),
                    Enchantment = itemCard.Enchantment.ToString(),
                    Socket = (int)socketId,
                    ArtKey = itemCard.Template?.ArtKey,
                    Quests = LireQuetes(itemCard, itemCard.Template),
                    Jetons = LireJetons(CarteALire(itemCard, (int)socketId)),
                    Crit = LireCrit(CarteALire(itemCard, (int)socketId)),
                    Multicast = LireAttributEntier(CarteALire(itemCard, (int)socketId), "Multicast"),
                    Delai = LireAttributEntier(CarteALire(itemCard, (int)socketId), "CooldownMax"),
                    Munitions = LireAttributEntier(CarteALire(itemCard, (int)socketId), "AmmoMax"),
                    TagsAjoutes = LireTagsAjoutes(CarteALire(itemCard, (int)socketId)),
                });
            }

            return result.OrderBy(c => c.Socket).ToList();
        }

        /* ── L'avancement des quêtes ────────────────────────────────────────
           Le modèle de la carte définit ses quêtes : pour chacune, l'attribut
           qui la compte (Quest_1, Quest_2…) et sa cible. L'exemplaire porte la
           valeur de ces attributs. Relevé sur Blank Slate : Quest_2 = 14 pour
           une Régénération affichée « 14/25 » en jeu.

           On rend, dans l'ordre des quêtes du modèle, [avancement, cible] ;
           c'est le même ordre que les quêtes publiées. Lu par réflexion, pour
           ne dépendre ni des noms exacts des types ni de leur visibilité. */
        /* ── Victoires, prestige, mode ─────────────────────────────────────────
           Affichés en permanence à l'écran du jeu. On les cherche d'abord dans
           les attributs du joueur, puis parmi les propriétés du joueur et de
           la partie, sous les noms que le jeu emploie probablement. Une
           première lecture note au journal les noms candidats : si une valeur
           manque, il dira où elle se trouve. */
        private static object _runCompteurs;

        private static int? EntierDe(object v)
        {
            if (v == null || v is bool) return null;
            try { return Convert.ToInt32(v); } catch { return null; }
        }

        private static void LireCompteurs(object run, BoardState etat)
        {
            try
            {
                var joueur = ValeurDe(run, "Player");
                var attributs = ValeurDe(joueur, "Attributes") as System.Collections.IDictionary;

                int? Attribut(params string[] noms)
                {
                    if (attributs == null) return null;
                    foreach (System.Collections.DictionaryEntry e in attributs)
                    {
                        var k = e.Key?.ToString();
                        if (k != null && noms.Contains(k)) return EntierDe(e.Value);
                    }
                    return null;
                }

                int? Propriete(params string[] noms)
                {
                    foreach (var o in new[] { joueur, run })
                        foreach (var n in noms)
                        {
                            var v = EntierDe(ValeurDe(o, n));
                            if (v.HasValue) return v;
                        }
                    return null;
                }

                etat.Victoires = Attribut("Victories", "Victory", "Wins")
                              ?? Propriete("Victories", "Wins", "VictoryCount", "WinCount");
                etat.Prestige = Attribut("Prestige") ?? Propriete("Prestige");
                etat.Jour = Propriete("Day", "CurrentDay", "DayNumber", "Days")
                         ?? Attribut("Day", "CurrentDay");
                etat.PrestigeMax = Attribut("PrestigeMax", "MaxPrestige")
                                ?? Propriete("PrestigeMax", "MaxPrestige");

                /* Le mode. « Run.PlayMode » vaut « Unranked » quelle que soit la
                   partie (sonde du 12 octobre) : le jeu n'y range pas le mode.
                   Le mode choisi au lancement est « Data.SelectedPlayMode »,
                   « Ranked » en partie classée, « Unranked » en partie normale
                   (vérifié le 12 octobre : classée à 1 h 53, normale à 2 h 20).
                   Au menu, il garde la valeur du dernier choix. On le lit en premier ; les
                   anciennes pistes ne servent plus que de repli. */
                try
                {
                    var choisi = typeof(Data).GetProperty("SelectedPlayMode",
                        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)?.GetValue(null)?.ToString();
                    if (!string.IsNullOrEmpty(choisi))
                    {
                        etat.Mode = choisi;
                        etat.Classee = string.Equals(choisi, "Ranked", StringComparison.OrdinalIgnoreCase);
                    }
                }
                catch { }

                if (etat.Classee == null)
                foreach (var n in new[] { "IsRanked", "Ranked" })
                    if (ValeurDe(run, n) is bool b) { etat.Classee = b; break; }
                if (etat.Classee == null)
                    foreach (var n in new[] { "PlayMode", "GameMode", "Mode", "GameModeType", "RunType", "QueueType" })
                    {
                        var m = ValeurDe(run, n)?.ToString();
                        if (!string.IsNullOrEmpty(m))
                        {
                            etat.Mode = m;
                            /* « Unranked » contient « Rank » : seul le nom
                               exact « Ranked » désigne une partie classée. */
                            etat.Classee = string.Equals(m, "Ranked", StringComparison.OrdinalIgnoreCase);
                            break;
                        }
                    }

                /* Une fois une partie lancée seulement : avant, tout est vide et
                   la ligne n'apprenait rien. */
                /* Une ligne par partie, et non plus une seule par lancement du
                   jeu : on compare ainsi une partie normale et une classée. */
                if (!ReferenceEquals(run, _runCompteurs) && (etat.Victoires.HasValue || etat.Prestige.HasValue))
                {
                    _runCompteurs = run;
#if SONDES
                    var motif = new System.Text.RegularExpressions.Regex("victor|win|prestige|mode|rank|day|hour",
                        System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                    var vus = new List<string>();
                    if (attributs != null)
                        foreach (System.Collections.DictionaryEntry e in attributs)
                            if (motif.IsMatch(e.Key?.ToString() ?? "")) vus.Add("attribut " + e.Key + "=" + e.Value);
                    foreach (var (o, nom) in new[] { (joueur, "Player"), (run, "Run") })
                        if (o != null)
                            foreach (var p in o.GetType().GetProperties())
                                if (motif.IsMatch(p.Name))
                                {
                                    /* Avec sa valeur : « Run.PlayMode=Ranked » dit
                                       aussitôt comment le jeu nomme le mode. */
                                    object v = null;
                                    try { if (p.GetIndexParameters().Length == 0) v = p.GetValue(o); } catch { }
                                    vus.Add(nom + "." + p.Name + "=" + v);
                                }
                    Log.LogInfo("[BazaarScanner] compteurs : jour=" + etat.Jour + " victoires=" + etat.Victoires + " prestige="
                        + etat.Prestige + "/" + etat.PrestigeMax + " classée=" + etat.Classee + " mode=" + etat.Mode
                        + " | candidats : " + string.Join(", ", vus));
#else
                    Log.LogInfo("[BazaarScanner] compteurs : jour=" + etat.Jour + " victoires=" + etat.Victoires
                        + " prestige=" + etat.Prestige + "/" + etat.PrestigeMax + " classée=" + etat.Classee + " mode=" + etat.Mode);
#endif
                }
            }
            catch (Exception e)
            {
                LogLimite("compteurs", "[BazaarScanner] compteurs illisibles : " + e.Message);
            }
        }

        private static object ValeurDe(object o, string nom)
        {
            if (o == null) return null;
            var drapeaux = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            try
            {
                var p = o.GetType().GetProperty(nom, drapeaux);
                if (p != null && p.GetIndexParameters().Length == 0) return p.GetValue(o);
                var f = o.GetType().GetField(nom, drapeaux);
                if (f != null) return f.GetValue(o);
            }
            catch { }
            return null;
        }

        /* ── Les valeurs vivantes des jetons ───────────────────────────────
           Le jeu calcule chaque valeur d'une infobulle avec la partie en
           cours : « 5 % de votre Santé max », « pour chaque Accessoire ».
           CardTooltipData.CreateCardTooltipData prépare l'infobulle d'une
           carte ; chacun de ses jetons se résout par Resolve(). On rend une
           table « aura.1 » -> 6, « aura.1.mod » -> 3, du même nom que les
           jetons publiés, pour que l'extension remplace la valeur figée.

           Préparer une infobulle coûte plus que lire le plateau : chaque
           carte n'est recalculée qu'au plus toutes les 2,5 secondes, et le
           temps passé est noté au journal une fois par minute. */
        private static MethodInfo _creerInfobulle;
        private static readonly HashSet<string> _typesRefuses = new HashSet<string>();
        private static readonly HashSet<string> _typesSansValeur = new HashSet<string>();
        private static bool _creerInfobulleCherche;
        private static readonly Dictionary<string, KeyValuePair<DateTime, Dictionary<string, float>>> _jetonsEnCache =
            new Dictionary<string, KeyValuePair<DateTime, Dictionary<string, float>>>();
        private static readonly System.Diagnostics.Stopwatch _chronoJetons = new System.Diagnostics.Stopwatch();
        private static int _cartesJetons;
        private static DateTime _dernierBilanJetons = DateTime.UtcNow;

        private static Dictionary<string, float> LireJetons(object carte)
        {
            if (carte == null) return null;

            var instance = ValeurDe(carte, "InstanceId")?.ToString();
            if (instance != null)
                instance += "#" + System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(carte);
            if (!string.IsNullOrEmpty(instance)
                && _jetonsEnCache.TryGetValue(instance, out var memo)
                && (DateTime.UtcNow - memo.Key).TotalSeconds < 2.5)
                return memo.Value;

            _chronoJetons.Start();
            Dictionary<string, float> res = null;
            try { res = CalculerJetons(carte); }
            catch { res = null; }
            _chronoJetons.Stop();
            _cartesJetons++;

            if (!string.IsNullOrEmpty(instance))
                _jetonsEnCache[instance] = new KeyValuePair<DateTime, Dictionary<string, float>>(DateTime.UtcNow, res);

            if ((DateTime.UtcNow - _dernierBilanJetons).TotalSeconds >= 60)
            {
                Log.LogInfo("[BazaarScanner] jetons : " + _cartesJetons + " carte(s) calculée(s) en "
                            + _chronoJetons.ElapsedMilliseconds + " ms sur la dernière minute.");
                _chronoJetons.Reset();
                _cartesJetons = 0;
                _dernierBilanJetons = DateTime.UtcNow;
                if (_jetonsEnCache.Count > 400) _jetonsEnCache.Clear();
            }
            return res;
        }

        /* ── Les valeurs d'une étape de rencontre, calculées comme le jeu ──────
           Relevé par la sonde des étapes (11 octobre) : la capacité d'une étape
           vaut un ATTRIBUT DU JOUEUR, multiplié par un nombre fixe.

             Heroic Encounters : Value = TReferenceValuePlayerAttribute {
                 AttributeType = Custom_8,
                 Modifier = { ModifyMode = Multiply, Value = TFixedValue { 2 },
                              ShouldRound = True } }
             « Gain {ability.0.mod} Prestige for each Player fight you have
               lost this run [{ability.0}] »

           {ability.0.mod} est le nombre fixe (2 par combat), {ability.0} le
           résultat : l'attribut du joueur (1 combat perdu) fois 2. Même chose
           pour Sell the Rights (Custom_5 × 1) et Monster Sightings
           (Custom_7 × 1), dont les valeurs concordent avec celles du jeu.

           On ne calcule que ce cas exact : une référence à un attribut du
           joueur lui-même, et un modificateur fixe qui multiplie ou ajoute.
           Tout autre forme est laissée à la lecture de la phrase. */
        private static void ResoudreReferences(object carte, Dictionary<string, float> res)
        {
            try
            {
                var modele = ValeurDe(carte, "Template");
                var attributs = ValeurDe(ValeurDe(Data.Run, "Player"), "Attributes") as System.Collections.IDictionary;
                if (modele == null || attributs == null) return;

                foreach (var (nom, prefixe) in new[] { ("Abilities", "ability."), ("Auras", "aura.") })
                {
                    if (!(ValeurDe(modele, nom) is System.Collections.IDictionary effets)) continue;
                    foreach (System.Collections.DictionaryEntry e in effets)
                    {
                        var action = ValeurDe(e.Value, "Action");
                        var valeur = ValeurDe(action, "Value");
                        if (valeur == null || valeur.GetType().Name != "TReferenceValuePlayerAttribute") continue;

                        /* Le joueur lui-même, pas son adversaire. */
                        var cible = ValeurDe(ValeurDe(valeur, "Target"), "TargetMode")?.ToString();
                        if (cible != null && cible != "Player") continue;

                        var type = ValeurDe(valeur, "AttributeType");
                        if (type == null) continue;
                        float brut;
                        if (attributs.Contains(type)) brut = Convert.ToSingle(attributs[type]);
                        else if (ValeurDe(valeur, "DefaultValue") is object defaut) brut = Convert.ToSingle(defaut);
                        else continue;

                        var cle = prefixe + e.Key;
                        var modif = ValeurDe(valeur, "Modifier");
                        if (modif == null) { res[cle] = brut; continue; }

                        var fixe = ValeurDe(modif, "Value");
                        if (fixe == null || fixe.GetType().Name != "TFixedValue") continue;
                        if (!(ValeurDe(fixe, "Value") is object brutFixe)) continue;
                        float n = Convert.ToSingle(brutFixe);

                        var mode = ValeurDe(modif, "ModifyMode")?.ToString();
                        float resultat;
                        if (mode == "Multiply") resultat = brut * n;
                        else if (mode == "Add") resultat = brut + n;
                        else continue;
                        if (ValeurDe(modif, "ShouldRound") is bool arrondir && arrondir)
                            resultat = (float)Math.Round(resultat, MidpointRounding.AwayFromZero);

                        res[cle] = resultat;
                        res[cle + ".mod"] = n;
                    }
                }
            }
            catch (Exception ex) { LogLimite("references", "[BazaarScanner] jetons : calcul direct impossible : " + ex.Message); }
        }

        private static Dictionary<string, float> CalculerJetons(object carte)
        {
            var tous = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;
            if (!_creerInfobulleCherche)
            {
                _creerInfobulleCherche = true;
                var t = TrouverType("TheBazaar.Tooltips.CardTooltipData");
                _creerInfobulle = t?.GetMethods(tous).FirstOrDefault(m => m.Name == "CreateCardTooltipData"
                                                                       && m.GetParameters().Length == 1);
            }
            if (_creerInfobulle == null) return null;

            /* Une sorte de carte que le jeu refuse de préparer : notée une fois
               au journal, pour savoir d'où vient un « - » qui résiste. */
            var nomType = carte.GetType().Name;
            if (!_creerInfobulle.GetParameters()[0].ParameterType.IsInstanceOfType(carte))
            {
                if (_typesRefuses.Add(nomType))
                    Log.LogInfo("[BazaarScanner] jetons : le jeu ne prépare pas d'infobulle pour « " + nomType + " ».");
                return null;
            }

            object donnees = null;
            try { donnees = _creerInfobulle.Invoke(null, new[] { carte }); }
            catch (Exception e)
            {
                if (_typesRefuses.Add(nomType))
                    Log.LogInfo("[BazaarScanner] jetons : préparation impossible pour « " + nomType + " » : " + Erreur(e));
                return null;
            }
            if (donnees == null) return null;

            /* Les infobulles actives et passives, et la DESCRIPTION : celle des
               étapes de rencontre, comme la récompense « Side Hustle », n'est
               pas une infobulle, et ses valeurs restaient « - ». */
            var res = new Dictionary<string, float>();
            foreach (var nom in new[] { "GetCurrentActiveTooltipBuilders", "GetCurrentPassiveTooltipBuilders", "GetCardDescription" })
            {
                object tuple = null;
                try
                {
                    var m = donnees.GetType().GetMethods(tous).FirstOrDefault(x => x.Name == nom && x.GetParameters().Length == 0);
                    tuple = m?.Invoke(donnees, null);
                }
                catch { continue; }

                foreach (var champ in new[] { "Item1", "Item2" })
                {
                    var v = ValeurDe(tuple, champ);
                    if (v is string texteRendu && nom == "GetCardDescription")
                    {
                        LireValeursDescription(carte, texteRendu, res);
                        continue;
                    }
                    if (v == null || v is string) continue;
                    if (v is System.Collections.IEnumerable constructeurs)
                        foreach (var c in constructeurs) RelireJetons(c, res, 0);
                    else
                        RelireJetons(v, res, 0);
                }
            }

            /* Une étape de rencontre : ses valeurs se calculent directement,
               comme le fait le jeu, et remplacent celles relues dans la phrase. */
            if (nomType.IndexOf("Encounter", StringComparison.OrdinalIgnoreCase) >= 0)
                ResoudreReferences(carte, res);

            if (res.Count == 0 && _typesSansValeur.Add(nomType))
                Log.LogInfo("[BazaarScanner] jetons : aucune valeur trouvée pour une carte « " + nomType + " ».");
            return res.Count > 0 ? res : null;
        }

        /* La description d'une étape de rencontre, « Side Hustle » par exemple,
           ne passe pas par des jetons à résoudre : le jeu la rend directement,
           déjà calculée, dans sa langue, ses nombres écrits dans la police
           « BazaarNumbers ». Le modèle de la carte contient la même phrase AVEC
           ses jetons, dans le même ordre : le premier nombre va au premier
           jeton, le second au second. On ne le fait que si leurs comptes
           concordent exactement ; sinon, une ligne au journal. */
        private static readonly HashSet<string> _descriptionsDiscordantes = new HashSet<string>();

        private static void LireValeursDescription(object carte, string rendu, Dictionary<string, float> res)
        {
            try
            {
                /* Les nombres de la police BazaarNumbers, même enveloppés d'autres
                   balises, comme une couleur, avant le chiffre. */
                var nombres = System.Text.RegularExpressions.Regex.Matches(rendu,
                        "<font=\"?BazaarNumbers[^>]*>(?:\\s|<[^>]+>)*([+\\-]?\\d+(?:[.,]\\d+)?)")
                    .Cast<System.Text.RegularExpressions.Match>()
                    .Select(m => m.Groups[1].Value.Replace(',', '.'))
                    .ToList();

                /* Certaines étapes n'emploient pas cette police : « Heroic
                   Encounters » écrit ses nombres entre de simples balises de
                   mise en page (« </line-height>2<line-height=1.6em> »). On lit
                   alors les nombres du texte débarrassé de ses balises. Le
                   compte doit toujours concorder avec celui des jetons, plus
                   bas : un nombre écrit en toutes lettres dans la phrase ne
                   peut donc pas prendre la place d'une valeur. */
                if (nombres.Count == 0)
                {
                    var sansBalises = System.Text.RegularExpressions.Regex.Replace(rendu, "<[^>]*>", "");
                    nombres = System.Text.RegularExpressions.Regex.Matches(sansBalises,
                            "(?<![\\w.])[+\\-]?\\d+(?:[.,]\\d+)?(?!\\w|[.,]\\d)")
                        .Cast<System.Text.RegularExpressions.Match>()
                        .Select(m => m.Value.Replace(',', '.'))
                        .ToList();
                }

                /* La phrase modèle, avec ses jetons : là où le jeu la range pour
                   un objet, puis aux autres endroits possibles pour une étape. */
                var modele = "";
                var tpl = ValeurDe(carte, "Template");
                foreach (var source in new[] {
                    ValeurDe(ValeurDe(tpl, "Localization"), "Description"),
                    ValeurDe(tpl, "Description"),
                    ValeurDe(ValeurDe(carte, "Localization"), "Description"),
                    ValeurDe(carte, "Description") })
                {
                    var t = source as string ?? LocalizeText(source);
                    if (!string.IsNullOrEmpty(t) && t.IndexOf('{') >= 0) { modele = t; break; }
                }

                var jetons = System.Text.RegularExpressions.Regex.Matches(modele, "\\{([^}]+)\\}")
                    .Cast<System.Text.RegularExpressions.Match>()
                    .Select(m => m.Groups[1].Value.Trim().ToLowerInvariant())
                    .ToList();

                if (jetons.Count == 0 || jetons.Count != nombres.Count)
                {
                    var nomCarte = ValeurDe(tpl, "InternalName")?.ToString() ?? "?";
                    if (_descriptionsDiscordantes.Add(nomCarte))
                    {
                        Log.LogInfo("[BazaarScanner] jetons : description de « " + nomCarte + " » : " + jetons.Count
                                    + " jeton(s) pour " + nombres.Count + " nombre(s), non associés.");
                        Log.LogInfo("[BazaarScanner]   rendu  : " + (rendu.Length > 400 ? rendu.Substring(0, 400) : rendu));
                        Log.LogInfo("[BazaarScanner]   modèle : " + (modele.Length > 200 ? modele.Substring(0, 200) : modele));
                    }
                    return;
                }

                for (var i = 0; i < jetons.Count; i++)
                {
                    if (float.TryParse(nombres[i], System.Globalization.NumberStyles.Float,
                                       System.Globalization.CultureInfo.InvariantCulture, out var n))
                        res[jetons[i]] = n;
                }
            }
            catch (Exception e)
            {
                LogLimite("jetons", "[BazaarScanner] jetons : lecture de description impossible : " + e.Message);
            }
        }

        private static void RelireJetons(object o, Dictionary<string, float> res, int profondeur)
        {
            if (o == null || profondeur > 3) return;
            var nomType = o.GetType().Name;
            var aura = nomType.StartsWith("TooltipComponentAura");
            var capacite = nomType.StartsWith("TooltipComponentAbility");

            /* Un jeton d'attribut, comme « {Custom_0} » : il porte le nom de
               l'attribut, sous un nom de champ que le jeu ne fixe pas ; on
               essaie les plus probables. */
            if (nomType.StartsWith("TooltipComponentAttribute"))
            {
                var attribut = (ValeurDe(o, "AttributeType") ?? ValeurDe(o, "Attribute")
                                ?? ValeurDe(o, "ReferencedAttribute") ?? ValeurDe(o, "Type"))?.ToString();
                if (!string.IsNullOrEmpty(attribut))
                {
                    try
                    {
                        var v = o.GetType().GetMethod("Resolve", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                                                      null, Type.EmptyTypes, null)?.Invoke(o, null);
                        if (v != null) res[attribut] = Convert.ToSingle(v);
                    }
                    catch { }
                }
            }

            if (aura || capacite)
            {
                var id = ValeurDe(o, "EffectId")?.ToString();
                if (!string.IsNullOrEmpty(id))
                {
                    var acces = ValeurDe(o, "Accessor")?.ToString();
                    var cle = (aura ? "aura." : "ability.") + id
                              + (string.IsNullOrEmpty(acces) ? "" : "." + acces.ToLowerInvariant());
                    try
                    {
                        var v = o.GetType().GetMethod("Resolve", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                                                      null, Type.EmptyTypes, null)?.Invoke(o, null);
                        if (v != null) res[cle] = Convert.ToSingle(v);
                    }
                    catch { }
                }
            }

            foreach (var m in MembresDe(o))
            {
                if (!(m.Value is System.Collections.IEnumerable liste) || m.Value is string) continue;
                foreach (var x in liste)
                    if (x != null && x.GetType().Name.IndexOf("Tooltip", StringComparison.Ordinal) >= 0)
                        RelireJetons(x, res, profondeur + 1);
            }
        }

        /* ── Les cartes AFFICHÉES de votre plateau ──────────────────────────
           Votre plateau est lu dans les données de la partie. Mais pendant un
           combat, ou son replay, c'est sur les cartes affichées que le jeu fait
           évoluer les valeurs, la chance de critique notamment : lues sur les
           cartes de la partie, elles restaient figées, et après la fin de la
           partie elles retombaient sur les valeurs de base. On relève donc les
           cartes posées à l'écran sur vos emplacements, par numéro, pour y
           lire les valeurs ; à défaut, on garde la carte de la partie.

           Les noms d'emplacements vus sont notés une fois au journal, pour
           vérifier celui de votre plateau. */
        private static Dictionary<int, object> _affichesEnCours;
        private static string _derniereCombinaison;
        private static int _combinaisonsNotees;

        private static Dictionary<int, object> CartesAffichees(string prefixe)
        {
            var res = new Dictionary<int, object>();
            object dict;
            try
            {
                dict = typeof(Data).GetProperty("CardControllerToBoardTarget",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)?.GetValue(null);
            }
            catch { return res; }
            if (!(dict is System.Collections.IEnumerable suite)) return res;

            var noms = new HashSet<string>();
            try
            {
                foreach (var e in suite)
                {
                    var t = e.GetType();
                    var emplacement = t.GetProperty("Value")?.GetValue(e)?.ToString();
                    if (emplacement == null) continue;
                    noms.Add(System.Text.RegularExpressions.Regex.Replace(emplacement, @"\d+$", ""));
                    if (!emplacement.StartsWith(prefixe)) continue;
                    if (!int.TryParse(emplacement.Substring(prefixe.Length), out var socket)) continue;

                    var controleur = t.GetProperty("Key")?.GetValue(e);
                    if (controleur == null) continue;
                    object carte = null;
                    try
                    {
                        carte = controleur.GetType().GetProperty("CardData")?.GetValue(controleur)
                             ?? controleur.GetType().GetProperty("Card")?.GetValue(controleur);
                    }
                    catch { }
                    if (carte != null) res[socket] = carte;
                }
            }
            catch { }

            /* Les noms d'emplacements, notés chaque fois que leur combinaison
               change, dix fois au plus : c'est ce qui dira le nom des
               emplacements des talents, qui ne sont pas toujours à l'écran. */
            var combinaison = string.Join(", ", noms.OrderBy(x => x));
            if (noms.Count > 0 && combinaison != _derniereCombinaison && _combinaisonsNotees < 10)
            {
                _derniereCombinaison = combinaison;
                _combinaisonsNotees++;
                Log.LogInfo("[BazaarScanner] emplacements affichés : " + combinaison
                            + " ; " + res.Count + " carte(s) sur « " + prefixe + " ».");
            }
            return res;
        }

        /* La carte à lire pour un emplacement : l'affichée, si c'est bien le même
           objet, sinon celle de la partie. */
        private static object CarteALire(object carteDePartie, int socket)
        {
            if (_affichesEnCours == null || !_affichesEnCours.TryGetValue(socket, out var affichee)) return carteDePartie;
            var a = ValeurDe(affichee, "TemplateId")?.ToString();
            var b = ValeurDe(carteDePartie, "TemplateId")?.ToString();
            return (a != null && a == b) ? affichee : carteDePartie;
        }

        /* La chance de critique de la carte, telle que le jeu la tient. */
        private static int? LireCrit(object carte)
        {
            return LireAttributEntier(carte, "CritChance");
        }

        /* Les tags que la carte a EN PLUS de ceux de son modèle : gagnés en
           partie ou en combat (« devient une Arme »...). Seulement la
           différence, pour que le message reste léger : la plupart des cartes
           n'en ont aucun. */
        private static List<string> LireTagsAjoutes(object carte)
        {
            try
            {
                var actuels = NomsDeTags(ValeurDe(carte, "Tags"));
                if (actuels == null || actuels.Count == 0) return null;

                var modele = ValeurDe(carte, "Template");
                var deBase = NomsDeTags(ValeurDe(modele, "Tags")) ?? new List<string>();
                var caches = NomsDeTags(ValeurDe(modele, "HiddenTags"));
                if (caches != null) deBase.AddRange(caches);
                /* Sans modèle lisible, on ne peut rien distinguer : rien. */
                if (modele == null) return null;

                var ajoutes = actuels.Where(t => !deBase.Contains(t)).Distinct().ToList();
                return ajoutes.Count > 0 ? ajoutes : null;
            }
            catch { return null; }
        }

        private static List<string> NomsDeTags(object tags)
        {
            if (!(tags is System.Collections.IEnumerable liste) || tags is string) return null;
            var res = new List<string>();
            foreach (var t in liste)
            {
                var n = t?.ToString();
                if (!string.IsNullOrEmpty(n)) res.Add(n);
            }
            return res;
        }

        /* Un attribut entier de la carte, tel que le jeu le tient en ce moment :
           « Multicast » évolue au fil d'un combat (Anaconda en gagne). */
        private static int? LireAttributEntier(object carte, string nom)
        {
            try
            {
                if (!(ValeurDe(carte, "Attributes") is System.Collections.IDictionary attributs)) return null;
                foreach (System.Collections.DictionaryEntry e in attributs)
                    if (e.Key?.ToString() == nom) return Convert.ToInt32(e.Value);
            }
            catch { }
            return null;
        }

        private static List<int[]> LireQuetes(object carte, object modele)
        {
            try
            {
                var groupes = ValeurDe(modele, "Quests") as System.Collections.IEnumerable;
                if (groupes == null) return null;

                var attributs = ValeurDe(carte, "Attributes") as System.Collections.IDictionary;
                var res = new List<int[]>();

                foreach (var groupe in groupes)
                {
                    object entree = null;
                    if (ValeurDe(groupe, "Entries") is System.Collections.IEnumerable entrees)
                        foreach (var e in entrees) { entree = e; break; }

                    var cle = ValeurDe(entree, "AttributeType");
                    var cible = 0;
                    try { cible = Convert.ToInt32(ValeurDe(entree, "Target") ?? 0); } catch { }

                    var avance = 0;
                    try
                    {
                        if (attributs != null && cle != null && attributs.Contains(cle))
                            avance = Convert.ToInt32(attributs[cle]);
                    }
                    catch { }

                    res.Add(new[] { avance, cible });
                }
                return res.Count > 0 ? res : null;
            }
            catch { return null; }
        }

        private static readonly Dictionary<string, int> TierRank = new Dictionary<string, int>
        {
            { "Bronze", 0 }, { "Silver", 1 }, { "Gold", 2 }, { "Diamond", 3 }, { "Legendary", 4 },
        };

        /* L'ORDRE DES TALENTS - la règle, telle que le jeu l'applique à l'écran :

             1. par rareté d'abord, de la plus haute à la plus basse ;
             2. dans une rareté, le talent arrivé le premier DANS CETTE RARETÉ
                est le plus à gauche ;
             3. un talent qui change de rareté (Argent → Or) se place à la fin
                de sa nouvelle rareté, comme un talent qu'on vient d'obtenir.

           Le jeu, lui, énumère ses talents dans l'ordre d'obtention, sans tenir
           compte des améliorations. On retient donc, pour chaque exemplaire de
           talent (son identifiant d'instance, propre à la partie), la rareté
           dans laquelle on l'a vu et le moment où il y est entré. Un talent
           jamais vu prend son rang dans l'ordre de la liste du jeu ; un talent
           dont la rareté change en prend un nouveau, après tous les autres.

           Limite : si le mod démarre en cours de partie, un talent déjà
           amélioré avant ce démarrage ne peut pas être reconnu comme tel. */
        private sealed class ArriveeTalent
        {
            public string Rarete;
            public long Rang;
        }

        private static readonly Dictionary<string, ArriveeTalent> _arriveesTalents = new();
        private static long _compteurArrivees;

        private static long RangDansRarete(string cle, string rarete)
        {
            if (!_arriveesTalents.TryGetValue(cle, out var a))
            {
                a = new ArriveeTalent { Rarete = rarete, Rang = _compteurArrivees++ };
                _arriveesTalents[cle] = a;
            }
            else if (a.Rarete != rarete)
            {
                a.Rarete = rarete;
                a.Rang = _compteurArrivees++;
            }
            return a.Rang;
        }

        /* Les exemplaires d'une partie terminée ne reviennent jamais : au-delà
           de quelques centaines, on ne garde que ceux qu'on vient de lire. La
           mémoire ne grossit donc pas au fil des heures. */
        private static void ElaguerArrivees(HashSet<string> presents)
        {
            if (_arriveesTalents.Count <= 400 || presents.Count == 0) return;
            foreach (var cle in _arriveesTalents.Keys.ToList())
                if (!presents.Contains(cle)) _arriveesTalents.Remove(cle);
        }

#if SONDES
        /* SONDE - à retirer une fois l'ordre des talents élucidé.
           
           « Player.Skills » donne presque le bon ordre, mais un talent qui a
           changé de palier s'y retrouve mal placé. Cette routine énumère ce
           que le jeu expose autour des talents, pour repérer ce qui porte
           l'ordre réellement affiché.
           
           Elle n'écrit qu'une fois, dans le journal de BepInEx, et seulement
           si le fichier « sonder-talents » est posé à côté de la DLL. */
        private static bool _sondeFaite;

        private static void SonderTalents(object joueur)
        {
            if (_sondeFaite || joueur == null) return;

            var temoin = Path.Combine(
                Path.GetDirectoryName(typeof(Plugin).Assembly.Location) ?? ".",
                "sonder-talents");
            if (!File.Exists(temoin)) return;

            _sondeFaite = true;

            try
            {
                Log.LogInfo("[Sonde] --- propriétés du joueur ---");
                foreach (var p in joueur.GetType().GetProperties())
                {
                    object v = null;
                    try { v = p.GetValue(joueur); } catch { }

                    var type = p.PropertyType.Name;
                    var apercu = "";

                    if (v is System.Collections.IEnumerable liste
                        && v is not string)
                    {
                        var n = 0;
                        foreach (var _ in liste) n++;
                        apercu = n + " élément(s)";
                    }
                    else if (v != null)
                    {
                        apercu = v.ToString();
                        if (apercu.Length > 60) apercu = apercu.Substring(0, 60);
                    }

                    Log.LogInfo($"[Sonde]   {p.Name} : {type} = {apercu}");
                }

                /* Ce que porte un talent : l'un de ces champs donne peut-être
                   sa position à l'écran. */
                var skills = joueur.GetType().GetProperty("Skills")
                    ?.GetValue(joueur) as System.Collections.IEnumerable;

                if (skills != null)
                {
                    Log.LogInfo("[Sonde] --- champs d'un talent ---");
                    foreach (var s in skills)
                    {
                        if (s == null) continue;
                        foreach (var p in s.GetType().GetProperties())
                        {
                            object v = null;
                            try { v = p.GetValue(s); } catch { }
                            var a = v?.ToString() ?? "null";
                            if (a.Length > 50) a = a.Substring(0, 50);
                            Log.LogInfo($"[Sonde]   {p.Name} : {p.PropertyType.Name} = {a}");
                        }
                        break;   // un seul suffit
                    }

                    Log.LogInfo("[Sonde] --- ordre de Player.Skills ---");
                    var i = 0;
                    foreach (var s in skills)
                    {
                        if (s is not SkillCard c) continue;
                        var titre = c.Template?.Localization?.Title?.Text ?? "?";
                        Log.LogInfo($"[Sonde]   {i++}. {titre}");
                    }
                }
            }
            catch (Exception e)
            {
                Log.LogWarning("[Sonde] échec : " + e.Message);
            }
        }
#endif

        private static List<CardInfo> ReadSkills(object player)
        {
#if SONDES
            SonderTalents(player);
#endif

            var result = new List<CardInfo>();

            /* En spectateur, le jeu AJOUTE à la liste des talents ceux de chaque
               joueur observé, sans retirer ceux du précédent : ils
               s'accumulaient, jusqu'à faire déborder le message vers Twitch.
               Les talents AFFICHÉS sont exactement ceux du joueur regardé : on
               les préfère, quand le jeu les montre. Les noms d'emplacements
               sont ceux qu'on suppose ; le journal dira les vrais. */
            System.Collections.IEnumerable skills = null;
            foreach (var prefixe in new[] { "PlayerSkillSocket_", "SkillSocket_", "PlayerSkill_" })
            {
                var affiches = CartesAffichees(prefixe);
                if (affiches.Count == 0) continue;
                skills = affiches.OrderBy(k => k.Key).Select(k => k.Value).ToList();
                break;
            }
            if (skills == null)
                skills = player.GetType().GetProperty("Skills")?.GetValue(player) as System.Collections.IEnumerable;
            if (skills == null) return result;

            /* Une borne, contre une accumulation absurde seulement : un joueur
               peut avoir trente talents, parfois davantage. Au-delà de cent,
               c'est une accumulation, et l'on garde les derniers ajoutés. */
            /* Sans tout recopier : quand la liste du jeu grossit sans fin, la
               recopier entière à chaque seconde coûtait de plus en plus cher. */
            List<object> liste;
            if (skills is System.Collections.IList indexable && indexable.Count > 100)
            {
                liste = new List<object>(100);
                for (int i = indexable.Count - 100; i < indexable.Count; i++) liste.Add(indexable[i]);
                LogLimite("accumulation", "[BazaarScanner] " + indexable.Count + " talents lus : accumulation probable, seuls les 100 derniers sont gardés.");
            }
            else
            {
                liste = skills.Cast<object>().ToList();
                if (liste.Count > 100)
                {
                    LogLimite("accumulation", "[BazaarScanner] " + liste.Count + " talents lus : accumulation probable, seuls les 100 derniers sont gardés.");
                    liste = liste.Skip(liste.Count - 100).ToList();
                }
            }

            var cles = new Dictionary<CardInfo, string>();

            foreach (var skill in liste)
            {
                if (skill is not SkillCard skillCard) continue;
                var realId = skillCard.Template?.Id.ToString();
                TryExtractCardData(skillCard.Template, realId);

                var info = new CardInfo
                {
                    Name = LocalizeText(skillCard.Template?.Localization?.Title) ?? skillCard.Template?.InternalName,
                    InternalName = skillCard.Template?.InternalName,
                    TemplateId = realId ?? skillCard.TemplateId.ToString(),
                    Tier = skillCard.Tier.ToString(),
                    ArtKey = skillCard.Template?.ArtKey,
                    /* Les valeurs que le jeu donne aux jetons du talent, comme
                       le nombre de paires de « Band's All Here ». */
                    Jetons = LireJetons(skillCard),
                };
                result.Add(info);

                /* L'exemplaire, pour suivre ses changements de rareté. Sans
                   identifiant d'instance, le modèle et son rang dans la liste. */
                var instance = ValeurDe(skillCard, "InstanceId")?.ToString();
                cles[info] = !string.IsNullOrEmpty(instance)
                    ? "i:" + instance
                    : "m:" + info.TemplateId + "#" + cles.Values.Count(v => v.StartsWith("m:" + info.TemplateId + "#"));
            }

            /* La règle d'ordre, décrite plus haut avec RangDansRarete. Elle
               s'applique toujours : se fier à l'ordre d'énumération du jeu
               plaçait un talent amélioré à sa place d'obtention, devant des
               talents arrivés avant lui dans sa nouvelle rareté. */
            var rangs = new Dictionary<CardInfo, long>();
            foreach (var c in result) rangs[c] = RangDansRarete(cles[c], c.Tier ?? "");
            ElaguerArrivees(new HashSet<string>(cles.Values));

            var sorted = result
                .OrderByDescending(c => TierRank.TryGetValue(c.Tier ?? "", out var r) ? r : -1)
                .ThenBy(c => rangs[c])
                .ToList();

            for (int i = 0; i < sorted.Count; i++) sorted[i].Socket = i;
            return sorted;
        }
    }

    public class BoardState
    {
        public bool Ready;
        public string Hero;
        public string Language;
        public List<CardInfo> Board;
        public List<CardInfo> Skills;

        public List<CardInfo> Face;

        public bool FaceCentree;

        public List<CardInfo> FaceSkills;

        public List<CardInfo> Reserve;
        public List<CardInfo> ReserveAffichee;

        /* La version du mod qui a écrit ce fichier. */
        public string Mod;

        /* La version du jeu (Application.version). */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string VersionJeu;

        /* Le compteur de victoires et la jauge de prestige, tels que l'écran
           du jeu les montre en permanence, et le mode de la partie. Absents
           si le jeu ne les expose pas sous un nom connu. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Victoires;
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Prestige;
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? PrestigeMax;
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public bool? Classee;
        /* Le jour en cours de la partie, pour le compteur de victoires. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Jour;
        /* Le mode tel que le jeu le nomme (« Run.PlayMode ») : l'application en
           déduit aussi le tournoi. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public string Mode;
    }

    public class CardInfo
    {
        public string Name;
        public string InternalName;
        public string TemplateId;

        /* L'avancement de chaque quête, [avancement, cible], dans l'ordre du
           modèle. Absent pour un objet sans quête. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public List<int[]> Quests;

        /* La valeur que le jeu donne à chaque jeton de la carte, avec la partie
           en cours : « aura.1 » -> 6. Absente si rien n'a pu être calculé. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public Dictionary<string, float> Jetons;

        /* La chance de critique, en pourcentage, telle que le jeu la tient. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Crit;

        /* Le Multicast tel que le jeu le tient : il évolue au fil d'un combat. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Multicast;

        /* Le délai d'activation actuel, en millisecondes : le jeu y applique
           déjà les réductions et allongements (Honey Badger, Seashadow...). */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Delai;

        /* Les munitions maximales actuelles. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public int? Munitions;

        /* Les tags gagnés en partie, absents du modèle de la carte. */
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore)]
        public List<string> TagsAjoutes;
        public string Size;
        public string Tier;
        public string Enchantment;
        public int Socket;

        public List<string> SocketEffects;
        public string ArtKey;

        public float? X;
        public float? Y;
        public float? W;
        public float? H;

        public string Type;
    }
}

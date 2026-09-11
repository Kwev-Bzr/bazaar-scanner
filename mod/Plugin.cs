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
    [BepInPlugin("com.bazaarscanner.bridge", "Bazaar Scanner Bridge", "1.3.0")]
    public class Plugin : BaseUnityPlugin
    {
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
                Log.LogWarning("Erreur lecture board: " + ex.Message);
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
                    PositionEcran(controleur, info);
                    cible.Add(info);
                }
            }
            catch (Exception ex) { Log.LogWarning("[Bande] " + prefixe + " : " + ex.Message); }

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
                Log.LogWarning("[Face] talents adverses : " + ex.Message);
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
            catch (Exception ex) { Log.LogWarning("[Effets] " + ex.Message); }
            return effets;
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
                        + carte.GetType().FullName + " — les cartes de la bande "
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

        private void WriteBoardState()
        {
            var run = Data.Run;
            if (run?.Player == null)
            {
                File.WriteAllText(_outputPath, "{\"ready\":false}");
                return;
            }
            var board = ReadContainerItems(run.Player.Hand);

            var effets = LireEffetsEmplacement();
            if (effets.Count > 0)
            {
                RattacherEffets(board, effets);
            }

            var skills = ReadSkills(run.Player);

            LireBandes();
            var face = _face;
            var reserve = _reserve;

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
                FaceCentree = !enCombat,
                FaceSkills = faceSkills,
            };

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
                        Log.LogWarning("Erreur ecriture board: " + ex.Message);
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

        private static bool _vidageEnCours;
        private static bool _vidageFait;

        private static bool VidageDemande()
        {
            try
            {
                return File.Exists(Path.Combine(
                    Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? ".",
                    "extraire-catalogue"));
            }
            catch { return false; }
        }

        private static void EcrireCaches()
        {
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
                try
                {
                    var methode = statique.GetType().GetMethod("GetCardMap",
                        BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    if (methode == null)
                    {
                        Log.LogWarning("[Catalogue] GetCardMap introuvable sur "
                            + statique.GetType().Name + " — le jeu a change d'interface.");
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
                });
            }

            return result.OrderBy(c => c.Socket).ToList();
        }

        private static readonly Dictionary<string, int> TierRank = new Dictionary<string, int>
        {
            { "Bronze", 0 }, { "Silver", 1 }, { "Gold", 2 }, { "Diamond", 3 }, { "Legendary", 4 },
        };

        private static readonly Dictionary<string, int> _arriveeTalents = new();
        private static int _compteurArrivees;

        private static string CleTalent(CardInfo c)
        {
            return (c.TemplateId ?? c.Name ?? "?") + "|" + (c.Tier ?? "?");
        }

        private static void NoterArriveesTalents(List<CardInfo> talents)
        {
            foreach (var c in talents)
            {
                var cle = CleTalent(c);
                if (!_arriveeTalents.ContainsKey(cle))
                    _arriveeTalents[cle] = _compteurArrivees++;
            }
        }

        /* Le jeu présente ses talents du palier le plus élevé au plus bas.
           Si l'énumération ne respecte pas cette pente, c'est qu'elle n'est
           pas celle de l'affichage : on retombe alors sur notre tri. */
        private static bool OrdreJeuPlausible(List<CardInfo> talents)
        {
            var precedent = int.MaxValue;
            foreach (var c in talents)
            {
                var rang = TierRank.TryGetValue(c.Tier ?? "", out var r) ? r : -1;
                if (rang > precedent) return false;
                precedent = rang;
            }
            return true;
        }

        private static int RangArrivee(CardInfo c)
        {
            return _arriveeTalents.TryGetValue(CleTalent(c), out var r) ? r : int.MaxValue;
        }

        private static List<CardInfo> ReadSkills(object player)
        {
            var result = new List<CardInfo>();
            var skillsProp = player.GetType().GetProperty("Skills");
            var skills = skillsProp?.GetValue(player) as System.Collections.IEnumerable;
            if (skills == null) return result;

            foreach (var skill in skills)
            {
                if (skill is not SkillCard skillCard) continue;
                var realId = skillCard.Template?.Id.ToString();
                TryExtractCardData(skillCard.Template, realId);

                result.Add(new CardInfo
                {
                    Name = LocalizeText(skillCard.Template?.Localization?.Title) ?? skillCard.Template?.InternalName,
                    InternalName = skillCard.Template?.InternalName,
                    TemplateId = realId ?? skillCard.TemplateId.ToString(),
                    Tier = skillCard.Tier.ToString(),
                    ArtKey = skillCard.Template?.ArtKey,
                });
            }

            NoterArriveesTalents(result);

            /* L'ordre dans lequel le jeu énumère les talents est celui qu'il
               affiche. Le reconstituer — par palier, puis par ordre d'arrivée
               mémorisé — donnait un résultat proche mais pas identique : un
               talent amélioré après ses voisins de palier se retrouvait devant
               eux au lieu de derrière.

               On conserve donc l'ordre du jeu tel quel. Le tri d'origine reste
               en secours, pour le cas où une mise à jour cesserait de garantir
               cet ordre : il vaut mieux un ordre approché qu'aucun. */
            var sorted = result;

            if (!OrdreJeuPlausible(result))
            {
                sorted = result
                    .OrderByDescending(c => TierRank.TryGetValue(c.Tier, out var r) ? r : -1)
                    .ThenBy(c => RangArrivee(c))
                    .ToList();
            }

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
    }

    public class CardInfo
    {
        public string Name;
        public string InternalName;
        public string TemplateId;
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

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
    /// <summary>
    /// Lit en direct l'etat du joueur (board, competences, heros) et l'ecrit dans
    /// board_state.json toutes les secondes. Extrait egalement, pour chaque
    /// nouvelle carte rencontree, sa definition complete (Tiers, Enchantments,
    /// Localization...) dans extracted_cards.json — une base de donnees qui
    /// s'enrichit au fil des parties, toujours a jour avec le jeu en cours
    /// d'execution (contrairement a GameData.db.zip, qui n'est pas regenere par
    /// le jeu a chaque ajout de contenu).
    ///
    /// Localisation : le jeu ne fournit pas de traduction fiable via
    /// TLocalizableText.Text (toujours l'anglais). On charge donc un CSV externe
    /// (hash MD5 du texte anglais -> texte traduit) et on patche les JSON
    /// serialises avant ecriture. C'est la meme approche que celle utilisee par
    /// les mods communautaires existants (aucune API interne fiable trouvee
    /// pour recuperer la traduction directement depuis le jeu).
    /// </summary>
    [BepInPlugin("com.bazaarscanner.bridge", "Bazaar Scanner Bridge", "1.3.0")]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log;

        private float _timer = 0f;
        private const float IntervalSeconds = 1.0f;
        private string _outputPath;
        private static string _dllDir;
        private static string _cardsDbPath;
        // Le JSON sérialisé d'un template est TOUJOURS en anglais : c'est
        // PatchLocalizedTexts qui le traduit ensuite. On conserve donc aussi la
        // version brute, sans quoi les cartes absentes de GameData.db n'auraient
        // jamais de version anglaise (le fichier n'existerait que si le joueur
        // lançait le jeu en anglais).
        private static string _cardsDbPathEn;
        private static readonly Dictionary<string, object> _extractedCardsEn = new Dictionary<string, object>();
        private static string _currentLang = "en";
        private static readonly Dictionary<string, object> _extractedCards = new Dictionary<string, object>();

        // Signature JSON de la dernière extraction connue par templateId — permet
        // de détecter qu'une carte a changé de contenu (rework, Id réutilisé pour
        // un item différent lors d'une mise à jour du jeu) plutôt que de supposer
        // qu'un Id déjà vu une fois n'a plus jamais besoin d'être réextrait.
        private static readonly Dictionary<string, string> _extractedCardsSignature = new Dictionary<string, string>();

        // Détecte la langue active dans le jeu via l'API Unity Localization.
        // En cas d'échec, retombe sur la langue système.
        private static string DetectLanguage()
        {
            try
            {
                // Cherche LocalizationSettings dans tous les assemblies chargés.
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

            // Fallback : langue système Windows
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

        // Recalcule le chemin du fichier de cache selon la langue active.
        // Appelé à chaque cycle : si la langue a changé depuis la dernière
        // vérification, vide le cache et recharge (extractions + traductions).
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

            // La langue a changé : le catalogue doit être revidé pour que le
            // nouveau fichier se remplisse, sinon il resterait vide jusqu'au
            // prochain lancement du jeu.
            _vidageFait = false;
        }

        // Produit un "$type" identique au format utilise par le jeu lui-meme
        // (juste le nom court de la classe, ex: "TFixedValue"), pour que toute
        // la logique de resolution cote serveur (qui depend de $type) fonctionne
        // de la meme maniere sur les cartes extraites par le mod.
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

            RefreshLanguage();

            // Tenté à chaque cycle, mais ne s'exécute qu'une fois — et seulement
            // si l'auteur l'a demandé. Voir ViderCatalogue().
            ViderCatalogue();

            try
            {
                WriteBoardState();
            }
            catch (Exception ex)
            {
                Log.LogWarning("Erreur lecture board: " + ex.Message);
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

            var board = ReadContainerItems(run.Player.Hand);
            var skills = ReadSkills(run.Player);

            var state = new BoardState
            {
                Ready = true,
                Hero = run.Player.Hero.ToString(),
                Language = _currentLang,
                Board = board,
                Skills = skills,
            };

            var json = JsonConvert.SerializeObject(state, Formatting.Indented);
            File.WriteAllText(_outputPath, json);
        }

        // Charge le fichier extracted_cards.json existant (s'il y en a un) dans
        // le cache mémoire, pour ne pas re-sérialiser des cartes déjà connues.
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

            // Le cache anglais se recharge de la meme facon. Sans cela, le fichier
            // serait reecrit a chaque session avec les seules cartes vues depuis
            // le demarrage, et perdrait tout le reste.
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

        // ------------------------------------------------------------------
        // Traduction : dictionnaire hash MD5(texte anglais) -> texte traduit,
        // charge depuis un CSV externe place a cote de la DLL.
        // ------------------------------------------------------------------

        private static readonly Dictionary<string, string> _translations = new Dictionary<string, string>();
        private static bool _translationsLoaded = false;

        // Nom de fichier attendu : translations_<lang>.csv (ex: translations_fr.csv).
        // Format : "English" (texte anglais exact), "Translation". Pas de hash :
        // on compare directement le texte anglais tel qu'il apparaît dans le jeu.
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

        // Parseur CSV minimal mais correct : gère les champs entre guillemets,
        // les guillemets échappés ("") et les retours à la ligne à l'intérieur
        // d'un champ (le CSV fourni en contient ~135, un simple ReadAllLines
        // les aurait corrompus).
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

        // Résout le texte localisé d'un objet TLocalizableText (propriété Text
        // accédée par réflexion car le type exact n'est pas référencé ici).
        // Retombe sur le texte anglais si aucune traduction n'est trouvée.
        // Renvoie le texte ANGLAIS d'origine, sans traduire.
        //
        // Le mod traduisait auparavant avec translations_<langue>.csv, la langue
        // venant de DetectLanguage() — qui retombe sur celle de Windows quand la
        // locale d'Unity n'est pas lisible. Un jeu en anglais produisait donc des
        // noms francais sur une machine francaise.
        //
        // Desormais board_state.json ne transporte que de l'anglais, et c'est
        // l'application compagnon qui traduit, dans la langue que le streamer a
        // choisie dans son interface. Une seule langue affichee, decidee a un
        // seul endroit.
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

        // Parcourt récursivement le JSON sérialisé d'une carte et remplace tout
        // champ "Text" par sa traduction quand ce texte anglais exact est trouvé
        // dans le dictionnaire de traductions (clé = texte anglais, pas de hash).
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

        // Sérialise et ajoute au cache cumulatif la définition complète d'une carte
        // (item ou skill), en la réextrayant si son contenu a changé depuis la
        // dernière fois (mise à jour du jeu, rework, Id réutilisé). Le fichier
        // résultant a la même structure que GameData.db (Tiers, Enchantments,
        // Localization...), pour être directement exploitable côté serveur sans
        // changement de logique.
        // ── VIDAGE DU CATALOGUE ────────────────────────────────────────────────
        //
        // Le jeu tient en memoire la totalite de ses modeles de carte : il doit
        // les connaitre pour composer ses boutiques. On peut donc les extraire
        // TOUS d'un coup, sans jouer, au lieu d'attendre de les croiser.
        //
        // Le chemin d'acces est celui qu'emploie le jeu lui-meme :
        //   Data.GetStatic()      -> JsonGameDataManager
        //   manager.GetCardMap()  -> Dictionary<Guid, ITCard>
        //
        // GetCardMap() lit toute la table SQLite et deserialise chaque carte :
        // c'est couteux (plusieurs secondes), donc on l'appelle sur un thread
        // de fond pour ne pas figer le jeu. Le jeu publie sa carte par une
        // affectation de reference atomique, l'appel hors thread principal est
        // donc sans danger.
        //
        // Interet decisif : chaque modele porte son texte anglais d'origine en
        // plus de sa cle de traduction. Un seul vidage donne donc l'anglais
        // authentique ET la langue jouee, sans relancer le jeu onze fois.
        //
        // Mecanisme repere dans BazaarPlusPlus (MIT, Xinyu YANG) :
        // GameInterop/StaticCards/BppStaticDataAccess.cs

        private static bool _vidageEnCours;
        private static bool _vidageFait;

        // Le vidage du catalogue ne sert QU'À L'AUTEUR, pour alimenter le site
        // qui sert les fiches. Un streamer n'en a aucun usage : ses cartes lui
        // viennent déjà de ce site. Le lui imposer écrirait 32 Mo dans son
        // dossier de plugins et ferait lire toute la base à chaque lancement,
        // sans rien lui apporter.
        //
        // Il ne s'exécute donc que si un fichier vide nommé « extraire-catalogue »
        // est déposé à côté de la DLL. Un fichier plutôt qu'une option compilée :
        // la même DLL sert à tout le monde, et il n'y a pas deux versions à
        // maintenir.
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

        // Seul le fichier ANGLAIS est ecrit desormais.
        //
        // Le fichier traduit etait redondant : son contenu se deduit entierement
        // de l'anglais en appliquant translations_<langue>.csv, ce que le serveur
        // fait deja pour les dix autres langues. Deux fichiers de 32 Mo au lieu
        // d'un, pour la meme information.
        //
        // Et surtout, il dependait de DetectLanguage(), qui retombe sur la langue
        // de Windows quand la locale d'Unity n'est pas lisible. Un streamer
        // allemand jouant en anglais aurait produit un fichier mal etiquete sans
        // le savoir. L'anglais, lui, vient du champ Text des modeles : c'est la
        // langue d'origine du jeu, independante de tout reglage.
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

                // GetStatic() a existe en version synchrone et en version
                // renvoyant une tache : on accepte les deux, sans jamais
                // bloquer en attendant.
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

                            // Les cartes portent leur modele dans .Template quand
                            // elles sont instanciees ; ici ce SONT les modeles.
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

        private static void TryExtractCardData(object template, string templateId)
        {
            if (template == null || string.IsNullOrEmpty(templateId)) return;

            try
            {
                if (!_translationsLoaded) LoadTranslations();

                var json = JsonConvert.SerializeObject(template, ExtractSettings);
                var jObj = Newtonsoft.Json.Linq.JObject.Parse(json);

                // Version anglaise : le JSON tel quel, avant toute traduction.
                var objEn = Newtonsoft.Json.Linq.JObject.Parse(json).ToObject<object>();

                if (_translations.Count > 0)
                    PatchLocalizedTexts(jObj);

                var obj = jObj.ToObject<object>();
                var signature = JsonConvert.SerializeObject(obj, Formatting.None);

                // Un Id déjà vu ne veut pas dire "plus jamais besoin d'être réextrait" :
                // une mise à jour du jeu peut reworker ou réutiliser cet Id pour un
                // tout autre item/skill. On ne saute que si le contenu est identique
                // à la dernière extraction connue.
                // Contenu inchange ET version anglaise deja presente : rien a faire.
                // La seconde condition est indispensable apres l'ajout du fichier
                // anglais : sans elle, une carte deja connue ne serait jamais
                // ecrite en anglais, puisque sa signature n'a pas bouge.
                if (_extractedCardsSignature.TryGetValue(templateId, out var previous)
                    && previous == signature
                    && _extractedCardsEn.ContainsKey(templateId))
                    return;

                _extractedCards[templateId] = obj;
                _extractedCardsEn[templateId] = objEn;
                _extractedCardsSignature[templateId] = signature;

                // Pendant le vidage du catalogue, on n'ecrit pas a chaque carte :
                // 1400 ecritures de plusieurs megaoctets bloqueraient le disque.
                // EcrireCaches() est appele une fois a la fin.
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

            // Trie par qualité décroissante (Legendary → Bronze), comme l'affichage
            // du jeu. OrderByDescending est un tri stable : pour deux compétences
            // de même qualité, l'ordre d'obtention d'origine est conservé.
            var sorted = result
                .OrderByDescending(c => TierRank.TryGetValue(c.Tier, out var r) ? r : -1)
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
        public string ArtKey;
    }
}

/* Wolf IPTV - TV'ye kurulu BAĞIMSIZ MOD (PC kapalıyken).
   Sayfanın /api/... isteklerini burada karşılar: listeler doğrudan sağlayıcıdan (Xtream) gelir,
   favori / son izlenenler TV'de saklanır, yayınlar doğrudan sağlayıcıdan oynar.
   PC açıksa YouTube / web araması gibi PC'ye özel işler yine PC'ye sorulur. ES5, kütüphanesiz. */
(function () {
  var C = null;
  try { C = JSON.parse(localStorage.getItem("wolf_creds") || "null"); } catch (e) {}
  var PC = null;
  try { PC = localStorage.getItem("wolf_addr") || null; } catch (e) {}
  if (!C || !C.server) { location.replace("index.html?giris=1"); return; }
  var SRV = C.server.replace(/\/+$/, ""), U = encodeURIComponent(C.user), P = encodeURIComponent(C.pw);
  var NativeXHR = window.XMLHttpRequest;
  window.WOLF_DIRECT = true;
  /* YouTube oynatıcı sayfası: önce TV içindeki yerel sunucu, olmazsa GitHub sayfası */
  window.WOLF_YTBASE = "https://wolfcryptotest.github.io/wolf-iptv-ios/yt.html";
  try {
    if (typeof PalmServiceBridge !== "undefined") {
      var sb = new PalmServiceBridge();
      sb.onservicecallback = function (r) { var d = {}; try { d = JSON.parse(r); } catch (e) {} if (d.returnValue && d.port) window.WOLF_YTBASE = "http://127.0.0.1:" + d.port + "/yt.html"; };
      sb.call("luna://com.wolf.iptv.service/start", "{}");
      window.__wolfsvc = sb;
    }
  } catch (e) {}

  /* ---------- yayın adresleri: /s/live/123.ts → sağlayıcı ---------- */
  window.WOLF_MAP = function (url) {
    var m = /^\/s\/(live|movie|series)\/([^\/?]+)$/.exec(url || "");
    if (m) return SRV + "/" + m[1] + "/" + U + "/" + P + "/" + m[2];
    if (/^\/x\//.test(url || "") && PC) return "http://" + PC + url;
    return url;
  };

  /* ---------- yardımcılar ---------- */
  function raw(url, ok, fail, timeout) {
    var x = new NativeXHR(), done = false;
    x.open("GET", url, true);
    var t = setTimeout(function () { if (done) return; done = true; try { x.abort(); } catch (e) {} if (fail) fail("zaman aşımı"); }, timeout || 30000);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) return; done = true; clearTimeout(t);
      if (x.status === 200) { var d; try { d = JSON.parse(x.responseText || "null"); } catch (e) { if (fail) fail("hatalı yanıt"); return; } ok(d); }
      else if (fail) fail("HTTP " + x.status);
    };
    x.send(null);
  }
  function papi(params, ok, fail) {
    var q = "username=" + U + "&password=" + P, k;
    for (k in params) if (params.hasOwnProperty(k) && params[k] !== null && params[k] !== undefined) q += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    raw(SRV + "/player_api.php?" + q, ok, fail);
  }
  function fold(s) {
    s = String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase();
    var a = "ıışğüöçâîû", b = "iisguocaiu", o = "", i, j;
    for (i = 0; i < s.length; i++) { j = a.indexOf(s.charAt(i)); o += j >= 0 ? b.charAt(j) : s.charAt(i); }
    try { o = o.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return o;
  }
  function store(k, d) { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) {} }
  function load(k, def) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v === null ? def : v; } catch (e) { return def; } }
  function idOf(kind, it) { return String(kind === "series" ? it.series_id : it.stream_id); }
  function slim(it) { var o = {}, k; for (k in it) if (it.hasOwnProperty(k) && k !== "info" && k !== "episodes") o[k] = it[k]; return o; }

  /* ---------- tam listeler (sayım ve arama için, bir kez çekilir) ---------- */
  var FULL = {}, WAIT = {}, ACT = { live: "get_live_streams", vod: "get_vod_streams", series: "get_series" };
  function full(kind, cb) {
    if (FULL[kind]) { cb(FULL[kind]); return; }
    if (WAIT[kind]) { WAIT[kind].push(cb); return; }
    WAIT[kind] = [cb];
    papi({ action: ACT[kind] }, function (l) {
      FULL[kind] = Object.prototype.toString.call(l) === "[object Array]" ? l : [];
      for (var i = 0; i < FULL[kind].length; i++) FULL[kind][i]._f = fold(FULL[kind][i].name);
      var w = WAIT[kind]; WAIT[kind] = null; for (var j = 0; j < w.length; j++) w[j](FULL[kind]);
    }, function () { var w = WAIT[kind]; WAIT[kind] = null; for (var j = 0; j < w.length; j++) w[j]([]); });
  }
  /* ---------- +18 ebeveyn kilidi: yetişkin kategoriler / kanallar PIN girilene kadar hiç görünmez ---------- */
  var ADULT = /\+ ?18|18 ?\+|xxx|adult|yeti[sş]kin|porn|erotı?i?k|erotic|playboy|hustler|dorcel|brazzers|penthouse|redlight|for adults/i;
  var ACATS = {}, CACT = { live: "get_live_categories", vod: "get_vod_categories", series: "get_series_categories" };
  function locked() { return !window.WOLF_ADULT_OK; }
  function adultCats(kind, cb, list) {
    if (ACATS[kind] && !list) { cb(ACATS[kind]); return; }
    var mk = function (cats) { var s = {}, i; for (i = 0; cats && i < cats.length; i++) if (ADULT.test(cats[i].category_name || "")) s[String(cats[i].category_id)] = 1; ACATS[kind] = s; cb(s); };
    if (list) { mk(list); return; }
    papi({ action: CACT[kind] }, mk, function () { mk([]); });
  }
  function isAdult(kind, it) { return ADULT.test(it.name || "") || !!(ACATS[kind] && ACATS[kind][String(it.category_id)]); }
  function noAdult(kind, l, cb) { if (!locked()) { cb(l); return; } adultCats(kind, function () { cb(l.filter(function (it) { return !isAdult(kind, it); })); }); }
  function fullF(kind, cb) { full(kind, function (l) { noAdult(kind, l, cb); }); }
  /* ====================== 👶 ÇOCUK MODU ALTYAPISI ======================
     • Profil: çocuk modunun favori / son izlenen / en çok izlenen listeleri ayrı tutulur (wolf_k_...)
     • Yaş kuralı: içerik bilgisi (sağlayıcı + isteğe bağlı TMDB) cihazda önbelleğe alınır, en fazla KCFG.max yaş
     • Kanal grupları, ayırıcı satır temizliği, sadece TR, karışık platform kategorileri dışarıda
     • Aile filmleri arşivi (her iki modda), yazım hatasına dayanıklı anlık arama                        */
  var KIDS = false; try { KIDS = localStorage.getItem("wolf_kids") === "1"; } catch (e) {}
  var KDEF = { max: 13, unknown: "cat", trOnly: true, words: "", block: {}, allow: {}, auto: 8, daily: 0, tmdb: "" };
  function kcfg() { var c = load("wolf_kcfg", {}), o = {}, k; for (k in KDEF) if (KDEF.hasOwnProperty(k)) o[k] = c.hasOwnProperty(k) ? c[k] : KDEF[k]; return o; }
  window.WOLF_KCFG = kcfg;
  window.WOLF_KCFG_SET = function (c) { store("wolf_kcfg", c); POOL = {}; };
  function PK() { return KIDS ? "wolf_k_" : "wolf_"; }
  /* ---------- sınıflandırma kuralları (sağlayıcı yaş vermiyor: TMDB türleri + kategori adları) ---------- */
  var KIDCAT = /cocuk|kids|\bkid\b|child|cartoon|cizgi|minika|nick|baby|bebek|junior|boomerang|animasyon|animation|anime|pixar|dreamworks|masal|zarok|okul ?oncesi|cartoonito/;
  var MIXED = /hulu|amazon|espn|netflix (tr|altyazi|yetiskin)|hbo|apple ?tv|paramount|prime|peacock|blutv|exxen|gain\b|tabii|mubi|starz|showtime|\bmax\b|beIN|tv plus/i;
  var FOREIGNW = /german|deutsch|france|francais|french|italia|england|english|arabic|espanol|spanish|polska|poland|russia|nederland|netherlands|portugal|brasil|greece|romania|bulgar|albania|kurdish|hint film|india/;
  var NOFILM = /spor|formula|reality|tv show|show$|pazartesi|sali dizi|carsamba|persembe|cuma dizi|cumartesi|pazar dizi|youtube/;
  var DARK = /korku|horror|gerilim|thriller|suc\b|crime|savas|war\b|erotik|erotic|vahsi bati|western|gizem|mystery|adult|yetiskin/;
  var SAFEG = /aile|family|animasyon|animation|\bcocuk\b|kids/;
  var ADVG = /macera|adventure|fantastik|fantasy|fantazi|bilim-? ?kurgu|sci-?fi|science fiction/;
  var RTITLE = /deadpool|\blogan\b|kingsman|kick-?ass|joker|john wick|mad max|matrix|terminator|rambo|robocop|predator|\balien\b|hannibal|suicide squad|the boys|sin city|300\b|riddick|blade\b|resident evil|underworld|hellboy|saw\b|testere/;
  function isSep(n) { n = String(n || ""); return /^\s*[-=_#*~•─━═▃▅▆█|.:+☾☆]{3,}/.test(n) || /[-=_#*~─━═▃▅▆█]{3,}\s*$/.test(n) || !/[a-z0-9çğıöşü]/i.test(n); }
  function foreign(n) {
    n = String(n || "");
    if (/^\s*►/.test(n) && !/turk|tr\b/i.test(n)) return true;   /* "► Netherlands", "► USA" … */
    var m = /^\s*[\[(]?\s*(?:\d{4}\s+)?([A-Z]{2,5})(?:\s*[\])|:\-–»•✦➤]|\s+(?=[A-Z][a-z]))/.exec(n);
    if (m && !/^(TR|TUR|HD|FHD|UHD|SD|4K|VIP|NEW|TV|YENI|ALL|VOD|DOC|KID|BEIN|TOP|IMDB|MUBI|CY)$/.test(m[1])) return true;
    return FOREIGNW.test(fold(n));
  }
  function cleanCat(n) { return String(n || "").replace(/^\s*[\[(]?\s*(TR|TUR)\s*[\])|:\-–»•]+\s*/i, "").replace(/^\s+|\s+$/g, "") || n; }
  function parseAge(v) {
    if (v === null || v === undefined) return -1;
    var s = String(v).toUpperCase().replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!s || s === "0" || s === "N/A" || s === "NR" || s === "NOT RATED") return -1;
    if (/NC-?17|TV-?MA|\bX\b|18\+|\+18/.test(s)) return 18;
    if (/(^|[^A-Z])R($|[^A-Z])|RATED R/.test(s)) return 17;
    if (/TV-?14/.test(s)) return 14;
    if (/PG-?13/.test(s)) return 13;
    if (/TV-?PG|(^|[^A-Z])PG($|[^A-Z-])/.test(s)) return 10;
    if (/TV-?Y7/.test(s)) return 7;
    if (/TV-?Y\b|TV-?G\b|(^|[^A-Z])G($|[^A-Z])|GENEL|GENERAL|ALL AGES|^U$|^TP$/.test(s)) return 0;
    var m = /(\d{1,2})\s*\+?/.exec(s); if (m) { var n = +m[1]; if (n > 0 && n <= 21) return n; }
    return -1;
  }
  function yearOf(it, m) {
    var y = (m && m[2]) || +it.year || 0;
    if (!y && it.releaseDate) y = +String(it.releaseDate).substr(0, 4) || 0;
    if (!y && it.releasedate) y = +String(it.releasedate).substr(0, 4) || 0;
    if (!y) { var r = /\(((19|20)\d{2})\)/.exec(String(it.name || "")) || /[\s\-]((19|20)\d{2})\s*$/.exec(String(it.name || "")); if (r) y = +r[1]; }
    return y > 1900 && y < 2100 ? y : 0;
  }
  /* ---------- içerik bilgisi: [yaş(-1 bilinmiyor), tür, yıl, puan] — PC'de toplanan meta.js + TV'nin kendi önbelleği ---------- */
  var M0 = window.WOLF_META0 || {};
  var META = load("wolf_meta", {}), MQ = [], MQS = {}, MBUSY = 0, MVER = 0, MSAVE = null, MCAP = {};
  window.WOLF_PENDING = 0;
  function mkey(kind, it) { return (kind === "series" ? "s" : "v") + idOf(kind, it); }
  function mg(kind, it) {
    if (kind === "series") { var k = mkey(kind, it); return META[k] || (it.genre !== undefined ? [-1, fold(it.genre), yearOf(it), +it.rating || 0] : null); }
    return META[mkey(kind, it)] || M0[mkey(kind, it)] || null;
  }
  function msave() { clearTimeout(MSAVE); MSAVE = setTimeout(function () { store("wolf_meta", META); }, 3000); }
  window.WOLF_META_CLEAR = function () { META = {}; store("wolf_meta", META); POOL = {}; MQS = {}; };
  function mq(kind, it, pri) {
    var k = mkey(kind, it); if (META[k] || MQS[k]) return;
    if (!pri) { MCAP[kind] = (MCAP[kind] || 0) + 1; if (MCAP[kind] > 1500) return; }
    MQS[k] = 1; var o = { k: k, kind: kind, id: idOf(kind, it), name: it.name, tm: it.tmdb || it.tmdb_id || (M0[k] && M0[k][4]), y: yearOf(it) };
    if (pri) MQ.unshift(o); else MQ.push(o); mrun();
  }
  function mrun() {
    while (MBUSY < 2 && MQ.length) { MBUSY++; mfetch(MQ.shift(), function () { MBUSY--; mrun(); }); }
    window.WOLF_PENDING = MQ.length + MBUSY;
  }
  function tmdbAge(kind, tm, name, y, cb) {
    var key = kcfg().tmdb; if (!key) return cb(-1);
    var B = "https://api.themoviedb.org/3/", tv = kind === "series";
    var byId = function (id) {
      raw(B + (tv ? "tv/" + id + "/content_ratings" : "movie/" + id + "/release_dates") + "?api_key=" + encodeURIComponent(key), function (d) {
        var r = (d && d.results) || [], best = -1, pref = { TR: 2, US: 1 }, bp = -1, i, j, c;
        for (i = 0; i < r.length; i++) { var p = pref[r[i].iso_3166_1]; if (p === undefined) continue;
          c = tv ? r[i].rating : ""; if (!tv) for (j = 0; j < (r[i].release_dates || []).length; j++) if (r[i].release_dates[j].certification) { c = r[i].release_dates[j].certification; break; }
          var a = parseAge(c); if (a >= 0 && p > bp) { bp = p; best = a; } }
        cb(best);
      }, function () { cb(-1); }, 10000);
    };
    if (tm) return byId(tm);
    var q = String(name || "").replace(/\(.*?\)|\[.*?\]|^\s*[A-Z]{2,3}\s*[|:\-]\s*/g, "").replace(/\s+/g, " ");
    raw(B + "search/" + (tv ? "tv" : "movie") + "?api_key=" + encodeURIComponent(key) + "&query=" + encodeURIComponent(q) + (y ? (tv ? "&first_air_date_year=" : "&year=") + y : ""), function (d) {
      var r = (d && d.results) || []; if (r.length) byId(r[0].id); else cb(-1);
    }, function () { cb(-1); }, 10000);
  }
  function mfetch(o, done) {
    var m0 = M0[o.k];
    if (m0 && !kcfg().tmdb) { done(); return; }   /* zaten PC'den gelen tür bilgisi var */
    var p = o.kind === "series" ? { action: "get_series_info", series_id: o.id } : { action: "get_vod_info", vod_id: o.id };
    papi(p, function (d) {
      var inf = (d && d.info) || {}, a = -1, f = ["age", "mpaa_rating", "mpaa", "certification", "rating_mpaa", "content_rating", "age_rating"], i;
      for (i = 0; i < f.length && a < 0; i++) a = parseAge(inf[f[i]]);
      var g = fold([inf.genre, inf.genres].join(" ")).substr(0, 80);
      var y = +String(inf.releasedate || inf.releaseDate || inf.release_date || inf.year || "").substr(0, 4) || o.y || 0;
      var fin = function (a2) { META[o.k] = [a2, g, y, Math.round((+inf.rating || 0) * 10) / 10]; MVER++; msave(); done(); };
      if (a < 0 && kcfg().tmdb) tmdbAge(o.kind, inf.tmdb_id || inf.tmdb || o.tm, inf.name || o.name, y, fin); else fin(a);
    }, function () { done(); });
  }
  /* ---------- tür grupları ---------- */
  var GEN = [["__g_anim", "🎨 Animasyon", /animasyon|animation|anime\b|cizgi|cartoon|pixar|dreamworks/],
    ["__g_live", "🎬 Aile Filmleri", null],
    ["__g_com", "😂 Komedi", /komedi|comedy/],
    ["__g_adv", "🗺 Macera & Fantastik", /macera|adventure|fantastik|fantasy|fantazi/],
    ["__g_scifi", "🚀 Bilim Kurgu", /bilim-? ?kurgu|sci-?fi|science fiction/],
    ["__g_hero", "🦸 Süper Kahraman", /super ?kahraman|superhero|marvel|avengers|yenilmezler|spider|orumcek adam|batman|superman|black panther|kaptan amerika|thor\b|iron ?man|demir adam|guardians|galaksinin koruyuculari/],
    ["__g_xmas", "🎄 Yılbaşı & Masal", /noel|christmas|yilbasi|masal|prenses|princess/],
    ["__g_yerli", "⭐ Yerli aile filmleri", null],
    ["__g_doc", "🌍 Belgesel & Doğa", /belgesel|documentary|doga\b|nature|hayvan/]];
  var SGEN = [["__g_anim", "🎨 Çizgi diziler", /animasyon|animation|anime\b|cizgi|cartoon/], ["__g_com", "😂 Komedi & Aile", /komedi|comedy|aile|family/],
    ["__g_adv", "🗺 Macera & Fantastik", /macera|adventure|fantastik|fantazi|bilim kurgu/], ["__g_doc", "🌍 Belgesel", /belgesel|documentary/]];
  var LGRP = [["__g_box", "🎞 7/24 Çizgi film kanalları", /^\s*(tr\W+)?(boxset|filmbox|real box|mega box|proturk masal)/],
    ["__g_baby", "🍼 Bebek & Okul Öncesi", /baby|bebek|junior|\bjr\b|cartoonito|duck ?tv|moonbug|okul ?oncesi|pepee|niloya|kukuli/],
    ["__g_cart", "🎨 Çizgi Film", /cartoon|cizgi|animasyon|animation|nickelodeon|nick\b|boomerang|disney|smart|toon|anime|zarok|spacetoon/],
    ["__g_yerli", "⭐ Yerli & Eğitici", /trt|minika|diyanet|eba\b|yumurcak|cocuk|dusyeri|kidz|tv ?8 ?bucuk/],
    ["__g_doc", "🌍 Belgesel & Bilim", /belgesel|documentary|nat ?geo|national geographic|discovery|animal|bbc earth|da ?vinci|science|bilim|history|tarih|nature|doga/]];
  function gtext(kind, it, ci) { var m = mg(kind, it); return (m && m[1] ? m[1] + " " : (ci ? fold(ci.n) + " " : "")) + it._f; }
  function isAnim(kind, it, ci) { var m = mg(kind, it); return /animasyon|animation|anime\b|cizgi|cartoon/.test((m && m[1]) || "") || (ci && /animasyon|cizgi|cartoon|anime/.test(fold(ci.n))); }
  /* ---------- kategori bilgisi ---------- */
  var CATL = {}, CATW = {};
  function catList(kind, cb) {
    if (CATL[kind]) return cb(CATL[kind]);
    if (CATW[kind]) { CATW[kind].push(cb); return; }   /* aynı anda gelen istekler tek indirmeyi bekler */
    CATW[kind] = [cb];
    var done = function (o) { var w = CATW[kind]; CATW[kind] = null; for (var i = 0; i < w.length; i++) w[i](o); };
    papi({ action: CACT[kind] }, function (cats) {
      cats = Object.prototype.toString.call(cats) === "[object Array]" ? cats : [];
      var o = { list: [], by: {} }, i, c, f;
      for (i = 0; i < cats.length; i++) { c = cats[i]; f = fold(c.category_name);
        var x = { id: String(c.category_id), n: c.category_name || "", ord: i, adult: ADULT.test(c.category_name || ""), sep: isSep(c.category_name),
          mixed: MIXED.test(c.category_name || "") || (String(c.category_name).match(/\+/g) || []).length >= 2, foreign: foreign(c.category_name), nofilm: NOFILM.test(f) };
        x.kid = KIDCAT.test(f) && !x.mixed && !x.adult; x.yerli = /yerli|yesilcam|kemal sunal|turk/.test(f);
        o.list.push(x); o.by[x.id] = x; }
      CATL[kind] = o; done(o);
    }, function () { done({ list: [], by: {} }); });
  }
  /* ---------- yetişkin modu: kategorileri başlıklar altında düzenle ---------- */
  var ORG = {
    vod: [["Öne çıkanlar", /top|haftanin|yeni eklenen|imdb|4k/], ["Yerli filmler", /yerli|yesilcam|kemal sunal/], ["Yıllara göre", /20\d\d/],
      ["Türler", /aksiyon|korku|komedi|romantik|dram|aile|bilim|animasyon|belgesel|kovboy|mubi|altyazi/], ["Haftalık TV dizileri", /pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar/],
      ["Spor & Show", /spor|formula|show|reality/]],
    series: [["Öne çıkanlar", /top/], ["Türk dizileri", /turk|exxen|gain|tabii|netflix turk/], ["Platformlar", /netflix|disney|max\b|bein|tv plus|prime|apple|hbo/],
      ["Türler", /komedi|aksiyon|animasyon|belgesel|bilim|dram|fantastik|aile|korku|suc|savas|yabanci/], ["Çocuk", /cocuk/]],
    live: [["Türkiye", /^tr\b/]]
  };
  function orgCats(kind, cats) {
    var rules = ORG[kind] || [], B = [], i, j, c, f, k;
    for (j = 0; j <= rules.length + 2; j++) B.push([]);
    for (i = 0; i < cats.length; i++) { c = cats[i]; if (String(c.category_id).charAt(0) === "_") { B[rules.length + 2].push(c); continue; }
      f = fold(c.category_name); k = -1;
      if (foreign(c.category_name)) k = rules.length;
      else for (j = 0; j < rules.length; j++) if (rules[j][1].test(f)) { k = j; break; }
      if (k < 0) k = rules.length + 1;
      B[k].push({ category_id: c.category_id, category_name: kind === "live" ? cleanCat(c.category_name) : c.category_name }); }
    var out = [], names = rules.map(function (r) { return r[0]; }).concat(["Yabancı dil", kind === "live" ? "Diğer" : "Diğer"]);
    if (kind === "series") names[rules.length + 1] = "Diğer diziler";
    for (j = 0; j <= rules.length + 1; j++) if (B[j].length) { out.push({ category_id: "__hd" + j, category_name: "━ " + names[j] }); out = out.concat(B[j]); }
    return out.concat(B[rules.length + 2]);
  }
  /* ---------- aile / çocuk uygunluğu ---------- */
  var POOL = {};
  function words(s) { return String(s || "").split(/\s*,\s*|\n/).map(function (w) { return fold(w).replace(/^\s+|\s+$/g, ""); }).filter(function (w) { return w.length >= 2; }); }
  /* 1 = uygun, 0 = uygun değil, -1 = bilinmiyor */
  function suits(kind, it, ci, max) {
    var m = mg(kind, it), g = (m && m[1]) || "";
    if (m && m[0] >= 0) return m[0] <= max && !/korku|horror|erotik/.test(g) ? 1 : 0;   /* gerçek yaş sınırı (TMDB anahtarıyla) */
    if (RTITLE.test(it._f)) return 0;
    if (g) {
      if (DARK.test(g)) return 0;
      if (SAFEG.test(g)) return kind === "series" && /animasyon|animation/.test(g) && !/aile|cocuk|kids|family/.test(g) && /dram|aksiyon/.test(g) ? 0 : 1;
      if (max >= 13 && ADVG.test(g) && !/dram|romantik|tarih/.test(g)) return 1;
      if (max >= 13 && /belgesel|documentary/.test(g) && (ci && (ci.kid || /belgesel/.test(fold(ci.n))))) return kind === "series" ? -1 : 1;
      return 0;
    }
    return ci && ci.kid ? -1 : (m ? 0 : -1);
  }
  function pool(kind, max, cb) {
    var pk = kind + ":" + max, P = POOL[pk];
    if (P && (P.v === MVER || new Date().getTime() - P.t < 2500)) return cb(P.l);
    var C = kcfg(), bw = words(C.words);
    full(kind, function (l) { catList(kind, function (cl) {
      var out = [], cand = [], seen = {}, i, it, ci, key, ok, j, s, dk;
      for (i = 0; i < l.length; i++) { it = l[i]; ci = cl.by[String(it.category_id)];
        if (!ci || ci.adult || ci.sep || isSep(it.name) || ADULT.test(it.name || "")) continue;
        key = kind + ":" + idOf(kind, it);
        if (C.allow[key]) { out.push(it); continue; }
        if (C.block[key]) continue;
        if (C.trOnly && (ci.foreign || foreign(it.name))) continue;
        if (ci.nofilm) continue;
        ok = true; for (j = 0; j < bw.length; j++) if (it._f.indexOf(bw[j]) >= 0) { ok = false; break; } if (!ok) continue;
        if (kind === "live") { if (ci.kid) out.push(it); continue; }
        s = suits(kind, it, ci, max);
        if (s < 0) { if (ci.kid && C.unknown !== "hide") s = 1; if (kind === "vod" && !META[mkey(kind, it)]) cand.push([ci.kid ? 1 : 0, it]); }
        if (s !== 1) continue;
        if (C.tmdb && kind === "vod" && !(META[mkey(kind, it)] && META[mkey(kind, it)][0] >= 0)) cand.push([ci.kid ? 2 : 1, it]);   /* TMDB anahtarı varsa gerçek yaş sınırı da doğrulanır */
        dk = it._f.replace(/^4k[\s\-]*/, "").replace(/[^a-z0-9]/g, "");   /* aynı film birden çok kategoride: tek göster */
        if (seen[dk]) continue; seen[dk] = 1; out.push(it);
      }
      if (kind !== "live") { cand.sort(function (a, b) { return a[0] - b[0] || (+b[1].added || 0) - (+a[1].added || 0); });
        for (i = 0; i < cand.length && i < 400; i++) mq(kind, cand[i][1]); }
      if (kind === "live") { out.sort(function (a, b) { return (cl.by[String(a.category_id)].ord - cl.by[String(b.category_id)].ord); });
        var sn = {}, o2 = []; for (i = 0; i < out.length; i++) { var nk = fold(out[i].name).replace(/\b(fhd|hd|sd|uhd|4k|hevc|raw)\b/g, "").replace(/[^a-z0-9]/g, ""); if (sn[nk]) continue; sn[nk] = 1; o2.push(out[i]); }
        out = o2; for (i = 0; i < out.length; i++) out[i]._kn = i + 1; }
      else out.sort(function (a, b) { return (+b.added || 0) - (+a.added || 0); });
      POOL[pk] = { l: out, v: MVER, t: new Date().getTime() }; cb(out);
    }); });
  }
  function kmax() { return kcfg().max; }
  function kpool(kind, cb) { pool(kind, kmax(), cb); }
  function fpool(cb) { pool("vod", KIDS ? kmax() : 13, cb); }   /* aile filmleri */
  function liveNum(l) { return l.map(function (it) { var o = slim(it); o.num = it._kn; return o; }); }
  var FYRS = [["__y2026", "📅 2026", 2026, 2026], ["__y2025", "📅 2025", 2025, 2025], ["__y2024", "📅 2024", 2024, 2024], ["__y2023", "📅 2023", 2023, 2023],
    ["__y2020", "📅 2020 – 2022", 2020, 2022], ["__y2010", "📅 2010 – 2019", 2010, 2019], ["__y2000", "📅 2000 – 2009", 2000, 2009], ["__yold", "📅 Daha eski", 1, 1999]];
  function rateOf(kind, it) { var m = mg(kind, it); return +it.rating || (m && m[3]) || (+it.rating_5based || 0) * 2 || 0; }
  function inGrp(kind, it, gid, ci) {
    var i;
    if (kind === "live") { for (i = 0; i < LGRP.length; i++) if (LGRP[i][2].test(it._f)) return LGRP[i][0] === gid; return gid === "__g_other"; }
    if (gid === "__g_live") return !isAnim(kind, it, ci) && !/belgesel|documentary/.test(gtext(kind, it, ci));
    if (gid === "__g_yerli") return !!(ci && ci.yerli) && !isAnim(kind, it, ci);
    var G = kind === "series" ? SGEN : GEN;
    for (i = 0; i < G.length; i++) if (G[i][0] === gid) return G[i][2] ? G[i][2].test(gtext(kind, it, ci)) : false;
    return false;
  }
  function grpFilter(kind, cat, l, cl) {
    var i, out;
    if (!cat) return l;
    if (cat === "__rec") { out = l.filter(function (it) { return rateOf(kind, it) >= 6.5; });
      out.sort(function (a, b) { return rateOf(kind, b) - rateOf(kind, a); }); return out.slice(0, 150); }
    if (cat === "__new") return l.slice(0, 80);
    for (i = 0; i < FYRS.length; i++) if (FYRS[i][0] === cat) { var a = FYRS[i][2], b = FYRS[i][3];
      out = l.filter(function (it) { var y = yearOf(it, mg(kind, it)); return y >= a && y <= b; });
      out.sort(function (x, z) { return rateOf(kind, z) - rateOf(kind, x); }); return out; }
    if (cat.indexOf("__g_") === 0) return l.filter(function (it) { return inGrp(kind, it, cat, cl.by[String(it.category_id)]); });
    return l.filter(function (it) { return String(it.category_id) === cat; });
  }
  /* film / dizi menüsü: başlıklar + öne çıkanlar + türler + yıllar (aile sekmesi ve çocuk modu aynı yapıyı kullanır) */
  function grpMenu(kind) {
    var G = kind === "series" ? SGEN : GEN;
    var m = [["__hd1", "━ Öne çıkanlar"], ["__rec", kind === "series" ? "⭐ En beğenilenler" : "⭐ Önerilenler"], ["__new", "🆕 Yeni eklenenler"], ["__hd2", "━ Türler"]].concat(G);
    if (kind === "vod") m = m.concat([["__hd3", "━ Yıllara göre"]]).concat(FYRS);
    return m;
  }
  function menuFor(kind, poolFn, cb) {
    poolFn(function (l) { catList(kind, function (cl) {
      var M = grpMenu(kind), out = [], i, n, pend = null;
      for (i = 0; i < M.length; i++) { if (M[i][0].indexOf("__hd") === 0) { pend = { category_id: M[i][0], category_name: M[i][1] }; continue; }
        n = grpFilter(kind, M[i][0], l, cl).length; if (!n) continue;
        if (pend) { out.push(pend); pend = null; } out.push({ category_id: M[i][0], category_name: M[i][1] }); }
      if (kind === "series") { var seen = {}, j; for (j = 0; j < l.length; j++) seen[String(l[j].category_id)] = 1; var first = true;
        for (i = 0; i < cl.list.length; i++) if (seen[cl.list[i].id] && cl.list[i].kid) { if (first) { out.push({ category_id: "__hd9", category_name: "━ Kategoriler" }); first = false; }
          out.push({ category_id: cl.list[i].id, category_name: "📁 " + cleanCat(cl.list[i].n) }); } }
      cb(out);
    }); });
  }
  function menuCounts(kind, poolFn, cb) {
    poolFn(function (l) { catList(kind, function (cl) {
      var c = { "": l.length }, M = grpMenu(kind), i; for (i = 0; i < M.length; i++) if (M[i][0].indexOf("__hd") !== 0) c[M[i][0]] = grpFilter(kind, M[i][0], l, cl).length;
      for (i = 0; i < l.length; i++) { var k = String(l[i].category_id); c[k] = (c[k] || 0) + 1; }
      cb(c);
    }); });
  }
  function kidsCats(kind, cb) {
    if (kind !== "live") return menuFor(kind, function (f) { kpool(kind, f); }, cb);
    kpool(kind, function (l) {
      var out = [], G = LGRP.concat([["__g_other", "📺 Diğer"]]), i, j, n;
      for (i = 0; i < G.length; i++) { n = 0; for (j = 0; j < l.length; j++) if (inGrp(kind, l[j], G[i][0])) n++;
        if (n) out.push({ category_id: G[i][0], category_name: G[i][1] }); }
      cb(out);
    });
  }
  function kidsItems(kind, cat, cb) {
    kpool(kind, function (l) { catList(kind, function (cl) {
      var out = kind === "live" ? (!cat ? l : l.filter(function (it) { return inGrp(kind, it, cat); })) : grpFilter(kind, cat, l, cl);
      cb(kind === "live" ? liveNum(out) : out.map(slim));
    }); });
  }
  function kidsCounts(kind, cb) {
    if (kind !== "live") return menuCounts(kind, function (f) { kpool(kind, f); }, cb);
    kpool(kind, function (l) {
      var c = { "": l.length }, i, j, G = LGRP.concat([["__g_other"]]);
      for (i = 0; i < l.length; i++) for (j = 0; j < G.length; j++) if (inGrp(kind, l[i], G[j][0])) c[G[j][0]] = (c[G[j][0]] || 0) + 1;
      cb(c);
    });
  }
  /* ---------- 👪 aile filmleri arşivi (yetişkin modunda ayrı sekme; çocuk modunda Filmler sekmesinin kendisi) ---------- */
  function famCats(cb) { menuFor("vod", fpool, cb); }
  function famCounts(cb) { menuCounts("vod", fpool, cb); }
  function famItems(cat, cb) { fpool(function (l) { catList("vod", function (cl) { cb(grpFilter("vod", cat, l, cl).map(function (it) { var o = slim(it); o._k = "vod"; return o; })); }); }); }
  /* çocuk modunda kayıtlı listeler de süzülür: yaş sınırı düşürülürse uygun olmayan kayıt görünmez */
  function kfilter(kind, lst, cb) {
    if (!KIDS || !lst.length) return cb(lst);
    kpool(kind, function (l) { var ok = {}, i; for (i = 0; i < l.length; i++) ok[idOf(kind, l[i])] = l[i]._kn || 1;
      cb(lst.filter(function (it) { return ok[idOf(kind, it)]; }).map(function (it) { if (kind === "live" && ok[idOf(kind, it)] > 0) it.num = ok[idOf(kind, it)]; return it; })); });
  }
  function localList(kind, list, cb) {
    if (kind === "all") {
      var res = [], left = 3;
      ["vod", "series", "live"].forEach(function (k) { localList(k, list, function (l) { for (var i = 0; i < l.length; i++) { l[i]._k = k; res.push(l[i]); }
        if (--left === 0) { if (list === "top") res.sort(function (a, b) { return (b._n || 0) - (a._n || 0); }); cb(res); } }); });
      return;
    }
    kfilter(kind, load(PK() + list + "_" + kind, []), cb);
  }
  /* ---------- 🔍 yazım hatasına dayanıklı arama ---------- */
  function lev(a, b, max) {
    var la = a.length, lb = b.length, i, j, prev, cur, mn;
    if (Math.abs(la - lb) > max) return max + 1;
    prev = []; for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) { cur = [i]; mn = i;
      for (j = 1; j <= lb; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) cur[j] = Math.min(cur[j], prev[j - 2] === undefined ? 9 : prev[j - 2] + 1);
        if (cur[j] < mn) mn = cur[j]; }
      if (mn > max) return max + 1; prev = cur; }
    return prev[lb];
  }
  /* söylendiği gibi yazım: jurasik = jurassic, kartun = cartoon, spaydırmen ≈ spiderman */
  function phon(w) { return w.replace(/ph/g, "f").replace(/ck|q|c/g, "k").replace(/w/g, "v").replace(/x/g, "ks").replace(/y/g, "i").replace(/(.)\1+/g, "$1"); }
  function prep(it) { if (!it._w) { it._f = it._f || fold(it.name); it._w = it._f.split(/[^a-z0-9]+/).filter(function (w) { return w; }); it._n = it._w.join(""); it._p = it._w.map(phon); } }
  function tokScore(t, it, fz) {
    var w = it._w, i, best = 9, al = t.length <= 3 ? 0 : (t.length <= 7 ? 1 : 2);
    for (i = 0; i < w.length; i++) { if (w[i] === t) return 0; if (w[i].indexOf(t) === 0) best = Math.min(best, 1); }
    if (best < 9) return best;
    if (it._n.indexOf(t) >= 0) return 2;
    if (!fz) return 9;
    var pt = phon(t); for (i = 0; i < it._p.length; i++) if (it._p[i] === pt || (pt.length >= 3 && it._p[i].indexOf(pt) === 0)) return 3;
    if (!al) return 9;
    for (i = 0; i < w.length; i++) { var x = it._p[i];
      if (x.charAt(0) !== pt.charAt(0) && x.charAt(1) !== pt.charAt(1)) continue;
      if (lev(pt, x, al) <= al || (x.length > pt.length && lev(pt, x.substr(0, pt.length), al) <= al)) return 3; }
    return 9;
  }
  function find(l, toks, fz, pop) {
    var hits = [], i, j, s, sc, it;
    for (i = 0; i < l.length; i++) { it = l[i]; if (isSep(it.name)) continue; prep(it); s = 0;
      for (j = 0; j < toks.length; j++) { sc = tokScore(toks[j], it, fz); if (sc >= 9) { s = -1; break; } s += sc; }
      if (s < 0) continue;
      hits.push([s - (pop[idOf(it._kind, it)] ? 1 : 0), it._f.indexOf(toks[0]) === 0 ? 0 : 1, it._f.length, it]); }
    hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; });
    return hits.slice(0, 60).map(function (h) { return h[3]; });
  }
  function suggest(lists, toks) {
    var best = null, bd = 9, i, j, k, it, w;
    for (k = 0; k < lists.length; k++) for (i = 0; i < lists[k].length; i++) { it = lists[k][i]; if (isSep(it.name)) continue; prep(it);
      for (j = 0; j < it._w.length; j++) { w = it._w[j]; if (w.length < 3) continue;
        var t0 = toks[0], al = t0.length <= 4 ? 1 : (t0.length <= 7 ? 2 : 3), d = lev(t0, w.length > t0.length + 1 ? w.substr(0, t0.length) : w, al);
        if (d < bd && d <= al) { bd = d; best = it.name; } } }
    return best;
  }
  function search(q, cb) {
    var toks = fold(q).split(/[^a-z0-9]+/).filter(function (t) { return t; }), out = {}, left = 3, L = {};
    if (!toks.length) return cb({ live: [], vod: [], series: [] });
    ["live", "vod", "series"].forEach(function (kind) {
      var go = function (l) {
        var pop = {}, tl = load(PK() + "top_" + kind, []), i; for (i = 0; i < tl.length; i++) pop[idOf(kind, tl[i])] = 1;
        for (i = 0; i < l.length; i++) l[i]._kind = kind;
        var r = find(l, toks, false, pop); if (r.length < 5) r = find(l, toks, true, pop);
        L[kind] = l; out[kind] = kind === "live" && KIDS ? liveNum(r) : r.map(slim);
        if (--left === 0) { if (!out.live.length && !out.vod.length && !out.series.length) out.sug = suggest([L.live, L.vod, L.series], toks); cb(out); }
      };
      if (KIDS) kpool(kind, go); else fullF(kind, go);
    });
  }

  /* ---------- YouTube araması (PC'siz): fragman / kısa video / alakasız sonuç ayıklanır ---------- */
  var JUNK = /fragman|teaser|trailer|tanıtım|tanitim|\bshorts?\b|#short|kamera arkası|kamera arkasi|sahne|klip|\bclip\b|detay|gizem|inceleme|review|reaction|tepki|özet|ozet|patlaması|hikayesindeki|ilk bakış|ilk bakis|yorum|analiz|kesit|\bpromo\b|first look/i;
  function lenSec(t) { var n = 0, p = String(t || "").split(":"), i, v; for (i = 0; i < p.length; i++) { v = parseInt(p[i], 10); if (isNaN(v)) return 0; n = n * 60 + v; } return n; }
  function relevant(res, q) {
    var toks = fold(q).match(/[a-z0-9]+/g) || [], stop = ["izle", "full", "film", "filmi", "hd", "turkce"], words = [], nums = [], i, j;
    for (i = 0; i < toks.length; i++) { if (/^\d+$/.test(toks[i])) nums.push(toks[i]); else if (toks[i].length >= 3 && stop.indexOf(toks[i]) < 0) words.push(toks[i]); }
    var need = words.length ? Math.max(1, Math.ceil(words.length * 0.6)) : 0;
    return res.filter(function (r) {
      var t = fold(r.title + " " + (r.channel || "")), tt = t.match(/[a-z0-9]+/g) || [], hit = 0;
      for (j = 0; j < nums.length; j++) if (tt.indexOf(nums[j]) < 0) return false;
      for (j = 0; j < words.length; j++) if (t.indexOf(words[j]) >= 0) hit++;
      return hit >= need;
    });
  }
  function rawText(url, ok, fail, timeout) {
    var x = new NativeXHR(), done = false;
    var t = setTimeout(function () { if (done) return; done = true; try { x.abort(); } catch (e) {} fail("zaman aşımı"); }, timeout || 15000);
    x.onreadystatechange = function () { if (x.readyState !== 4 || done) return; done = true; clearTimeout(t); if (x.status === 200) ok(x.responseText || ""); else fail("HTTP " + x.status); };
    try { x.open("GET", url, true); x.send(null); } catch (e) { done = true; clearTimeout(t); fail(String(e)); }
  }
  /* aramada "fragman", "klip", "özet" vb. istenirse o tür kısa videolar ayıklanmaz */
  var WANT = /fragman|teaser|trailer|tanıtım|tanitim|\bklip|\bclip\b|özet|ozet|\bshorts?\b|kamera arkas|sahne|tepki|reaction|inceleme|review/i;
  function ytSearch(q, cb, any) {
    var want = WANT.test(q) || !!any;
    rawText("https://www.youtube.com/results?hl=tr&gl=TR" + (any ? "" : "&sp=" + (want ? "CAI%3D" : "CAISAhgC")) + "&search_query=" + encodeURIComponent(q), function (html) {
      var out = [], seen = {}, a = html.indexOf("var ytInitialData = "), b, data, stack, o, k, v, runs, own;
      if (a < 0) { cb([]); return; }
      b = html.indexOf(";</script>", a);
      try { data = JSON.parse(html.substring(a + 20, b)); } catch (e) { cb([]); return; }
      stack = [data];
      while (stack.length && out.length < 40) {
        o = stack.shift();
        if (o && typeof o === "object") {
          v = o.videoRenderer;
          if (v && v.videoId && !seen[v.videoId]) {
            seen[v.videoId] = 1; runs = (v.title && v.title.runs) || []; own = ((v.ownerText && v.ownerText.runs) || [{}])[0] || {};
            out.push({ id: v.videoId, title: runs.map(function (r) { return r.text || ""; }).join(""), channel: own.text || "",
              len: (v.lengthText && v.lengthText.simpleText) || "", age: (v.publishedTimeText && v.publishedTimeText.simpleText) || "",
              views: parseInt(String((v.viewCountText && (v.viewCountText.simpleText || ((v.viewCountText.runs || []).map(function (r) { return r.text || ""; }).join("")))) || "").replace(/[^0-9]/g, ""), 10) || 0,
              ver: (v.ownerBadges || []).some(function (b) { return /VERIFIED|ARTIST/.test((b.metadataBadgeRenderer && b.metadataBadgeRenderer.style) || ""); }), thumb: "https://i.ytimg.com/vi/" + v.videoId + "/mqdefault.jpg" });
            continue;
          }
          for (k in o) if (o.hasOwnProperty(k) && o[k] && typeof o[k] === "object") stack.push(o[k]);
        }
      }
      if (!want) out = out.filter(function (r) { return sameName(r.channel, q) || (lenSec(r.len) >= 1200 && !JUNK.test(r.title)); });
      cb(relevant(out, q));
    }, function () { cb([]); }, 15000);
  }

  /* sondaki sayı yazıyla yazılmışsa rakama çevir: "oyuncak hikayesi beş" → "oyuncak hikayesi 5" */
  var NUMW = { bir: 1, iki: 2, "üç": 3, uc: 3, "dört": 4, dort: 4, "beş": 5, bes: 5, "altı": 6, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10 };
  function normQ(q) { q = String(q || "").replace(/^\s+|\s+$/g, ""); var m = /^(.*\S)\s+(\S+)$/.exec(q), w = m && m[2].toLocaleLowerCase("tr");
    return m && NUMW[w] && m[1].split(/\s+/).length >= 1 ? m[1] + " " + NUMW[w] : q; }
  function ago(ts) { if (!ts) return ""; var d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    if (d < 3600) return Math.max(1, Math.floor(d / 60)) + " dakika önce"; if (d < 86400) return Math.floor(d / 3600) + " saat önce";
    if (d < 604800) return Math.floor(d / 86400) + " gün önce"; if (d < 2592000) return Math.floor(d / 604800) + " hafta önce";
    if (d < 31536000) return Math.floor(d / 2592000) + " ay önce"; return Math.floor(d / 31536000) + " yıl önce"; }
  function hms(sec) { sec = Math.floor(sec || 0); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  /* ---------- Dailymotion (PC'siz): arama + yayın adresi, kendi oynatıcımızda oynar ---------- */
  function dmSearch(q, cb) {
    var want = WANT.test(q);
    rawText("https://api.dailymotion.com/videos?fields=id,title,duration,thumbnail_360_url,owner.screenname,created_time&limit=40&sort=relevance" +
      (want ? "" : "&longer_than=20") + "&search=" + encodeURIComponent(q), function (txt) {
      var d = {}; try { d = JSON.parse(txt); } catch (e) {}
      var out = [], l = d.list || [], i, v;
      for (i = 0; i < l.length; i++) { v = l[i];
        if (!want && (v.duration < 1200 || JUNK.test(v.title || ""))) continue;
        out.push({ url: "https://www.dailymotion.com/video/" + v.id, title: v.title || "", host: "dailymotion.com", play: true,
          thumb: v.thumbnail_360_url || "", len: hms(v.duration), age: ago(v.created_time), channel: v["owner.screenname"] || "" }); }
      cb(relevant(out, q));
    }, function () { cb([]); }, 15000);
  }
  function dmExtract(url, ok) {
    var id = (/dailymotion\.com\/(?:video|embed\/video)\/([a-z0-9]+)/i.exec(url) || /dai\.ly\/([a-z0-9]+)/i.exec(url) || [])[1];
    if (!id) return ok({ ok: false, error: "Dailymotion adresi anlaşılamadı" });
    rawText("https://www.dailymotion.com/player/metadata/video/" + id + "?embedder=" + encodeURIComponent("https://www.dailymotion.com/") + "&locale=tr", function (txt) {
      var d = {}; try { d = JSON.parse(txt); } catch (e) {}
      if (d.error) return ok({ ok: false, error: (d.error.title || d.error.message || "Video kullanılamıyor") });
      var q = d.qualities || {}, k, j, best = "";
      var pick = function (lst) { for (var a = 0; lst && a < lst.length; a++) if (lst[a] && lst[a].url) return lst[a].url; return ""; };
      best = pick(q.auto);
      if (!best) for (k in q) if (q.hasOwnProperty(k)) { j = pick(q[k]); if (j) { best = j; break; } }
      if (!best) return ok({ ok: false, error: "Bu videonun yayın adresi alınamadı" });
      ok({ ok: true, play: best.split("#")[0], title: d.title || "" });
    }, function (e) { ok({ ok: false, error: "Dailymotion'a ulaşılamadı (" + e + ")" }); }, 15000);
  }

  /* ---------- resmî kanal (abonelik gibi): aramanın adıyla aynı isimli kanalın en yeni videoları ---------- */
  function ytData(html) { var a = html.indexOf("var ytInitialData = "), b; if (a < 0) return null; b = html.indexOf(";</script>", a);
    try { return JSON.parse(html.substring(a + 20, b)); } catch (e) { return null; } }
  function walk(o, key, cb, max) { var st = [o], n = 0, x, k; while (st.length && n < (max || 60)) { x = st.shift();
      if (x && typeof x === "object") { if (x[key]) { cb(x[key]); n++; continue; } for (k in x) if (x.hasOwnProperty(k) && x[k] && typeof x[k] === "object") st.push(x[k]); } } }
  function txt(t) { return t ? (t.simpleText || ((t.runs || []).map(function (r) { return r.text || ""; }).join(""))) : ""; }
  function sameName(a, b) { a = fold(a).replace(/[^a-z0-9]/g, ""); b = fold(b).replace(/[^a-z0-9]/g, ""); return a && b && (a === b || (b.length >= 6 && a.indexOf(b) === 0) || (a.length >= 6 && b.indexOf(a) === 0)); }
  function ytChannel(q, cb) {
    rawText("https://www.youtube.com/results?hl=tr&gl=TR&sp=EgIQAg%3D%3D&search_query=" + encodeURIComponent(q), function (html) {
      var d = ytData(html), ch = null;
      var exact = null, close = null, nq = fold(q).replace(/[^a-z0-9]/g, "");
      if (d) walk(d, "channelRenderer", function (c) { if (!c.channelId) return;
        var nm = txt(c.title), o = { id: c.channelId, name: nm, ver: (c.ownerBadges || []).some(function (b) { return /VERIFIED|ARTIST/.test((b.metadataBadgeRenderer && b.metadataBadgeRenderer.style) || ""); }) };
        if (!exact && fold(nm).replace(/[^a-z0-9]/g, "") === nq) exact = o;
        else if (!close && o.ver && sameName(nm, q) && !/fan|hayran|klip|edit|ozet|özet/i.test(nm)) close = o; }, 10);
      ch = exact || close;
      if (!ch) { ytSearch(q, function (r) { if (r && r.length) cb(r); else ytSearch(q, cb, true); }); return; }
      rawText("https://www.youtube.com/channel/" + ch.id + "/videos?hl=tr&gl=TR", function (h2) {
        var d2 = ytData(h2), out = [], seen = {};
        if (d2) walk(d2, "videoRenderer", function (v) { if (!v.videoId || seen[v.videoId]) return; seen[v.videoId] = 1;
          out.push({ id: v.videoId, title: txt(v.title), channel: ch.name, len: txt(v.lengthText) || (function () { var o = v.thumbnailOverlays || [], i; for (i = 0; i < o.length; i++) if (o[i].thumbnailOverlayTimeStatusRenderer) return txt(o[i].thumbnailOverlayTimeStatusRenderer.text); return ""; })(), age: txt(v.publishedTimeText),
            views: parseInt(txt(v.viewCountText).replace(/[^0-9]/g, ""), 10) || 0, ver: ch.ver, off: true, thumb: "https://i.ytimg.com/vi/" + v.videoId + "/mqdefault.jpg" }); }, 40);
        if (out.length) cb(out); else ytSearch(q, cb);
      }, function () { ytSearch(q, cb); }, 15000);
    }, function () { ytSearch(q, cb); }, 15000);
  }

  /* ---------- web araması (PC'siz): DuckDuckGo, olmazsa Bing — Google'daki gibi sayfa sonuçları ---------- */
  function unent(s) { return String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }
  function hostOf(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(u || ""); return m ? m[1].replace(/^www\./, "") : ""; }
  function webSearchDirect(q, cb) {
    var done = function (out) { var seen = {}, r = []; for (var i = 0; i < out.length; i++) { var k = out[i].url.replace(/[#?].*$/, "").replace(/\/$/, ""); if (seen[k] || !out[i].title) continue; seen[k] = 1; r.push(out[i]); } cb(r.slice(0, 25)); };
    rawText("https://html.duckduckgo.com/html/?kl=tr-tr&q=" + encodeURIComponent(q), function (html) {
      var re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, sre = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g, m, out = [], sn = [], s2;
      while ((s2 = sre.exec(html))) sn.push(unent(s2[1]));
      while ((m = re.exec(html))) { var u = m[1], g = /[?&]uddg=([^&]+)/.exec(u); if (g) u = decodeURIComponent(g[1]); if (u.indexOf("//") === 0) u = "https:" + u;
        if (!/^https?:/i.test(u) || /duckduckgo\.com\/y\.js|ad_provider/.test(u)) continue;
        out.push({ url: u, title: unent(m[2]), host: hostOf(u), snippet: sn[out.length] || "", play: false }); }
      if (out.length) return done(out);
      bing();
    }, bing, 12000);
    function bing() {
      rawText("https://www.bing.com/search?setlang=tr&cc=TR&q=" + encodeURIComponent(q), function (html) {
        var re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, m, out = [];
        while ((m = re.exec(html))) if (/^https?:/i.test(m[1])) out.push({ url: unent(m[1]), title: unent(m[2]), host: hostOf(m[1]), snippet: "", play: false });
        done(out);
      }, function () { cb([]); }, 12000);
    }
  }
  /* bir sitenin açılıp açılmadığını önceden dene (yanlış adres TV'nin hata ekranını açmasın) */
  function probe(url, cb) {
    var x = new NativeXHR(), fin = false, t = setTimeout(function () { if (!fin) { fin = true; try { x.abort(); } catch (e) {} cb(false, "zaman aşımı"); } }, 9000);
    x.onreadystatechange = function () { if (x.readyState !== 4 || fin) return; fin = true; clearTimeout(t); cb(x.status > 0, x.status ? "" : "adrese ulaşılamadı"); };
    try { x.open("GET", url, true); x.send(null); } catch (e) { fin = true; clearTimeout(t); cb(false, String(e)); }
  }
  window.WOLF_PROBE = probe;

  /* ---------- /api/... yönlendirici ---------- */
  function qs(url) { var o = {}, q = url.split("?")[1] || ""; q.split("&").forEach(function (p) { if (!p) return; var kv = p.split("="); o[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); }); return o; }
  function handleGet(path, q, ok, fail) {
    var a = path.replace(/^\/api\//, "");
    if (a === "info") return papi({}, function (d) { var ui = (d && d.user_info) || {};
      if (String(ui.auth) !== "1") {   /* bilgiler geçersiz (ör. şifre değişti): giriş ekranına dön */
        setTimeout(function () { location.replace("index.html?giris=1"); }, 3000);
        return ok({ ok: false, msg: "Sağlayıcı girişi geçersiz — giriş ekranı açılıyor…" });
      }
      ok({ ok: true, user: "Wolf IPTV", status: ui.status, exp: ui.exp_date, max: ui.max_connections, active: ui.active_cons }); },
      function (e) { ok({ ok: false, msg: "Sağlayıcıya bağlanılamadı (" + e + ") — PC'yi açın" }); });
    if (a === "get_family_categories") return famCats(ok);
    if (a === "get_family") return famItems(q.category_id || "", ok);
    if (KIDS) {   /* çocuk modu: yalnız yaşa uygun havuz, kanal grupları, TR */
      var km = /^get_(live|vod|series)_categories$/.exec(a);
      if (km) return kidsCats(km[1], ok);
      var ks = /^get_(live|vod)_streams$|^get_series$/.exec(a);
      if (ks) return kidsItems(a === "get_series" ? "series" : (a === "get_live_streams" ? "live" : "vod"), q.category_id || "", ok);
      if (a === "counts") return q.kind === "family" ? famCounts(ok) : kidsCounts(q.kind, ok);
      if (/^(yt|dm|ytch|web)$/.test(a)) return ok([]);
    }
    var cm = /^get_(live|vod|series)_categories$/.exec(a);
    if (cm) { q.action = a; return papi(q, function (cats) {   /* +18 kategoriler: kilitliyken gizli, sonda "🔒 +18" satırı */
      cats = Object.prototype.toString.call(cats) === "[object Array]" ? cats : [];
      adultCats(cm[1], function (set) {
        var out = [], i, n = 0;
        for (i = 0; i < cats.length; i++) { if (isSep(cats[i].category_name)) continue; if (set[String(cats[i].category_id)]) { n++; if (locked()) continue; } out.push(cats[i]); }
        if (n && locked()) out.push({ category_id: "__adult", category_name: "🔒 +18 (" + n + " kategori, PIN)" });
        var oc = orgCats(cm[1], out);
        if (cm[1] === "vod") {   /* Filmler içinde: 👪 Aile Filmleri (oyuncularla çekilmiş, animasyon yok) */
          var at = 0, j; for (j = 1; j < oc.length; j++) if (String(oc[j].category_id).indexOf("__hd") === 0) { at = j; break; }
          oc.splice(at, 0, { category_id: "__hdA", category_name: "━ Aile" }, { category_id: "__fam", category_name: "👪 Aile Filmleri" });
        }
        ok(oc);
      }, cats);
    }, fail); }
    var sm = /^get_(live|vod)_streams$|^get_series$/.exec(a);
    if (a === "get_vod_streams" && q.category_id === "__fam") return famItems("__g_live", ok);
    if (sm && !q.category_id && a !== "get_live_streams") {   /* tam liste: bir kez indirilir, önbellekten verilir */
      var fk = a === "get_series" ? "series" : "vod";
      return (locked() ? fullF : full)(fk, function (l) { ok(l.filter(function (it) { return !isSep(it.name); }).map(slim)); });
    }
    if (sm && locked()) { var kd = a === "get_series" ? "series" : (a === "get_live_streams" ? "live" : "vod");
      return adultCats(kd, function (set) {
        if (q.category_id && set[String(q.category_id)]) return ok([]);
        q.action = a; papi(q, function (d) {
          d = Object.prototype.toString.call(d) === "[object Array]" ? d.filter(function (it) { return !isAdult(kd, it) && !isSep(it.name); }) : d;
          if (a === "get_live_streams" && Object.prototype.toString.call(d) === "[object Array]") for (var i = 0; i < d.length; i++) if (!d[i].num) d[i].num = i + 1;
          ok(d);
        }, fail);
      }); }
    if (/^get_(live|vod|series)_categories$|^get_(live|vod)_streams$|^get_series$|^get_series_info$|^get_vod_info$|^get_short_epg$|^get_simple_data_table$/.test(a)) {
      q.action = a; return papi(q, function (d) {
        if (a === "get_live_streams" && Object.prototype.toString.call(d) === "[object Array]")
          for (var i = 0; i < d.length; i++) if (!d[i].num) d[i].num = i + 1;
        ok(d);
      }, fail);
    }
    if (a === "counts" && q.kind === "family") return famCounts(ok);
    if (a === "counts" && q.kind === "vod") return fullF("vod", function (l) { var c = {}, i, k; for (i = 0; i < l.length; i++) { k = String(l[i].category_id); c[k] = (c[k] || 0) + 1; }
      fpool(function (fl) { catList("vod", function (cl) { c["__fam"] = grpFilter("vod", "__g_live", fl, cl).length; ok(c); }); }); });
    if (a === "counts") return fullF(q.kind, function (l) { var c = {}, i, k; for (i = 0; i < l.length; i++) { k = String(l[i].category_id); c[k] = (c[k] || 0) + 1; } ok(c); });
    if (a === "search") return search(normQ(q.q), ok);
    if (a === "local") return localList(q.kind, q.list, ok);
    if (a === "yt") return ytSearch(normQ(q.q), ok);   /* YouTube: PC'siz de çalışır */
    if (a === "dm") return dmSearch(normQ(q.q), ok);
    if (a === "ytch") return ytChannel(normQ(q.q), ok);   /* resmî kanal varsa onun en yeni videoları */   /* Dailymotion: PC'siz de çalışır */
    if (a === "extract" && /dailymotion\.com|dai\.ly/i.test(q.url || "")) return dmExtract(q.url, ok);
    if (a === "web" && !PC) return webSearchDirect(q.q || "", ok);   /* PC kapalı: Google benzeri web sonuçları doğrudan TV'den */
    if (/^(web|extract)$/.test(a)) {   /* diğer film / video siteleri: videoyu çözmek için PC (yt-dlp) gerekir; PC kapalıysa hızlıca boş dön */
      if (!PC) return ok(a === "extract" ? { ok: false, error: "Bu özellik için PC açık olmalı" } : []);
      var s = [], k; for (k in q) if (q.hasOwnProperty(k)) s.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));
      return raw("http://" + PC + path + "?" + s.join("&"), ok, function () { ok(a === "extract" ? { ok: false, error: "Bu özellik için PC açık olmalı" } : []); }, a === "extract" ? 20000 : 4000);
    }
    fail("bulunamadı");
  }
  function handlePost(path, body, ok) {
    var kind = body.kind, it = body.item, key, lst, id, i, had;
    if (path === "/api/fav") {
      key = PK() + "fav_" + kind; lst = load(key, []); id = idOf(kind, it); had = false;
      for (i = lst.length - 1; i >= 0; i--) if (idOf(kind, lst[i]) === id) { lst.splice(i, 1); had = true; }
      if (!had) lst.unshift(slim(it));
      store(key, lst); return ok({ fav: !had });
    }
    if (path === "/api/recent") {
      key = PK() + "recent_" + kind; lst = load(key, []); id = idOf(kind, it);
      for (i = lst.length - 1; i >= 0; i--) if (idOf(kind, lst[i]) === id) lst.splice(i, 1);
      lst.unshift(slim(it)); if (lst.length > 40) lst.length = 40;
      store(key, lst);
      var tk = PK() + "top_" + kind, tl = load(tk, []), n = 0, o = slim(it);   /* 🔥 en çok izlenenler sayacı */
      for (i = tl.length - 1; i >= 0; i--) if (idOf(kind, tl[i]) === id) { n = tl[i]._n || 0; tl.splice(i, 1); }
      o._n = n + 1; tl.push(o); tl.sort(function (x, y) { return (y._n || 0) - (x._n || 0); }); if (tl.length > 60) tl.length = 60;
      store(tk, tl); return ok({ ok: true });
    }
    if (path === "/api/del") {
      key = PK() + body.list + "_" + kind; lst = load(key, []);
      if (!it) lst = []; else { id = idOf(kind, it); for (i = lst.length - 1; i >= 0; i--) if (idOf(kind, lst[i]) === id) lst.splice(i, 1); }
      store(key, lst); return ok({ ok: true });
    }
    ok({ error: "?" });
  }

  /* ---------- XMLHttpRequest yerine geçen sarmalayıcı ---------- */
  function FakeXHR() { this.readyState = 0; this.status = 0; this.responseText = ""; this._h = {}; }
  FakeXHR.prototype.open = function (m, url) { this._m = m; this._url = url; this.readyState = 1; };
  FakeXHR.prototype.setRequestHeader = function (k, v) { this._h[k] = v; };
  FakeXHR.prototype.abort = function () { this._ab = true; };
  FakeXHR.prototype.send = function (body) {
    var self = this, url = this._url || "", path = url.split("?")[0];
    var fin = function (code, obj) {
      if (self._ab) return;
      self.status = code; self.responseText = typeof obj === "string" ? obj : JSON.stringify(obj); self.readyState = 4;
      if (self.onreadystatechange) self.onreadystatechange();
      if (code === 200 && self.onload) self.onload();
    };
    if (/^\/api\//.test(path)) {
      setTimeout(function () {
        try {
          if (self._m === "POST") { var b = {}; try { b = JSON.parse(body || "{}"); } catch (e) {} handlePost(path, b, function (d) { fin(200, d); }); }
          else handleGet(path, qs(url), function (d) { fin(200, d); }, function (e) { fin(502, { error: e }); });
        } catch (e) { fin(500, { error: String(e) }); }
      }, 0);
      return;
    }
    if (path === "/tv") { setTimeout(function () { fin(404, ""); }, 0); return; }   /* sayfa güncelleme kontrolü: bağımsız modda yok */
    var x = new NativeXHR(); x.open(self._m, url, true);
    for (var k in self._h) if (self._h.hasOwnProperty(k)) x.setRequestHeader(k, self._h[k]);
    x.onreadystatechange = function () { self.readyState = x.readyState; if (x.readyState === 4) { self.status = x.status; self.responseText = x.responseText; } if (self.onreadystatechange) self.onreadystatechange(); };
    x.send(body);
  };
  window.XMLHttpRequest = FakeXHR;

  /* PC'ye özel özellikler yokken bilgi notu */
  var accT = setInterval(function () {
    var el = document.getElementById("acc");
    if (el && /Biti|Sağlayıcı/.test(el.innerHTML) && el.innerHTML.indexOf("PC'siz") < 0) { el.innerHTML += ' <span style="color:#4ade80">• PC\'siz</span>'; clearInterval(accT); }
  }, 1000);
})();

/* Wolf IPTV - TV'ye kurulu BAĞIMSIZ MOD (PC kapalıyken).
   Sayfanın /api/... isteklerini burada karşılar: listeler doğrudan sağlayıcıdan (Xtream) gelir,
   favori / son izlenenler TV'de saklanır, yayınlar doğrudan sağlayıcıdan oynar.
   PC açıksa YouTube / web araması gibi PC'ye özel işler yine PC'ye sorulur. ES5, kütüphanesiz. */
(function () {
  var C = null;
  try { C = JSON.parse(localStorage.getItem("wolf_creds") || "null"); } catch (e) {}
  var PC = null;
  try { PC = localStorage.getItem("wolf_addr") || null; } catch (e) {}
  if (!C || !C.server) { location.replace("login.html"); return; }
  var SRV = C.server.replace(/\/+$/, ""), U = encodeURIComponent(C.user), P = encodeURIComponent(C.pw);
  var NativeXHR = window.XMLHttpRequest;
  window.WOLF_DIRECT = true;

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
  function search(q, cb) {
    var toks = fold(q).split(/\s+/), out = {}, left = 3;
    toks = toks.filter ? toks.filter(function (t) { return t; }) : toks;
    ["live", "vod", "series"].forEach(function (kind) {
      full(kind, function (l) {
        var hits = [], i, j, it, ok;
        for (i = 0; i < l.length && hits.length < 400; i++) {
          it = l[i]; ok = true;
          for (j = 0; j < toks.length; j++) if (it._f.indexOf(toks[j]) < 0) { ok = false; break; }
          if (ok) hits.push([it._f.indexOf(toks[0]) === 0 ? 0 : 1, it._f.length, it]);
        }
        hits.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        out[kind] = hits.slice(0, 60).map(function (h) { return h[2]; });
        if (--left === 0) cb(out);
      });
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
      var t = fold(r.title), tt = t.match(/[a-z0-9]+/g) || [], hit = 0;
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
  function ytSearch(q, cb) {
    rawText("https://www.youtube.com/results?hl=tr&gl=TR&sp=EgIYAg%3D%3D&search_query=" + encodeURIComponent(q), function (html) {
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
              len: (v.lengthText && v.lengthText.simpleText) || "", thumb: "https://i.ytimg.com/vi/" + v.videoId + "/mqdefault.jpg" });
            continue;
          }
          for (k in o) if (o.hasOwnProperty(k) && o[k] && typeof o[k] === "object") stack.push(o[k]);
        }
      }
      out = out.filter(function (r) { return lenSec(r.len) >= 1200 && !JUNK.test(r.title); });
      cb(relevant(out, q));
    }, function () { cb([]); }, 15000);
  }

  /* ---------- /api/... yönlendirici ---------- */
  function qs(url) { var o = {}, q = url.split("?")[1] || ""; q.split("&").forEach(function (p) { if (!p) return; var kv = p.split("="); o[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); }); return o; }
  function handleGet(path, q, ok, fail) {
    var a = path.replace(/^\/api\//, "");
    if (a === "info") return papi({}, function (d) { var ui = (d && d.user_info) || {};
      if (String(ui.auth) !== "1") {   /* bilgiler geçersiz (ör. şifre değişti): giriş ekranına dön */
        setTimeout(function () { location.replace("login.html"); }, 3000);
        return ok({ ok: false, msg: "Sağlayıcı girişi geçersiz — giriş ekranı açılıyor…" });
      }
      ok({ ok: true, user: "Wolf IPTV", status: ui.status, exp: ui.exp_date, max: ui.max_connections, active: ui.active_cons }); },
      function (e) { ok({ ok: false, msg: "Sağlayıcıya bağlanılamadı (" + e + ") — PC'yi açın" }); });
    if (/^get_(live|vod|series)_categories$|^get_(live|vod)_streams$|^get_series$|^get_series_info$|^get_vod_info$|^get_short_epg$|^get_simple_data_table$/.test(a)) {
      q.action = a; return papi(q, function (d) {
        if (a === "get_live_streams" && Object.prototype.toString.call(d) === "[object Array]")
          for (var i = 0; i < d.length; i++) if (!d[i].num) d[i].num = i + 1;
        ok(d);
      }, fail);
    }
    if (a === "counts") return full(q.kind, function (l) { var c = {}, i, k; for (i = 0; i < l.length; i++) { k = String(l[i].category_id); c[k] = (c[k] || 0) + 1; } ok(c); });
    if (a === "search") return search(q.q || "", ok);
    if (a === "local") return ok(load("wolf_" + q.list + "_" + q.kind, []));
    if (a === "yt") return ytSearch(q.q || "", ok);   /* YouTube: PC'siz de çalışır */
    if (/^(dm|web|extract)$/.test(a)) {   /* Dailymotion / web: videoyu bulmak için PC gerekir; PC kapalıysa hızlıca boş dön */
      if (!PC) return ok(a === "extract" ? { ok: false, error: "Bu özellik için PC açık olmalı" } : []);
      var s = [], k; for (k in q) if (q.hasOwnProperty(k)) s.push(encodeURIComponent(k) + "=" + encodeURIComponent(q[k]));
      return raw("http://" + PC + path + "?" + s.join("&"), ok, function () { ok(a === "extract" ? { ok: false, error: "Bu özellik için PC açık olmalı" } : []); }, a === "extract" ? 20000 : 4000);
    }
    fail("bulunamadı");
  }
  function handlePost(path, body, ok) {
    var kind = body.kind, it = body.item, key, lst, id, i, had;
    if (path === "/api/fav") {
      key = "wolf_fav_" + kind; lst = load(key, []); id = idOf(kind, it); had = false;
      for (i = lst.length - 1; i >= 0; i--) if (idOf(kind, lst[i]) === id) { lst.splice(i, 1); had = true; }
      if (!had) lst.unshift(slim(it));
      store(key, lst); return ok({ fav: !had });
    }
    if (path === "/api/recent") {
      key = "wolf_recent_" + kind; lst = load(key, []); id = idOf(kind, it);
      for (i = lst.length - 1; i >= 0; i--) if (idOf(kind, lst[i]) === id) lst.splice(i, 1);
      lst.unshift(slim(it)); if (lst.length > 40) lst.length = 40;
      store(key, lst); return ok({ ok: true });
    }
    if (path === "/api/del") {
      key = "wolf_" + body.list + "_" + kind; lst = load(key, []);
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

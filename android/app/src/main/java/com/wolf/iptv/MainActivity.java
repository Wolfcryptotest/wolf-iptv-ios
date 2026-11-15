package com.wolf.iptv;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;

/** Wolf IPTV - Android: iPhone sürümüyle aynı sayfalar (assets/www) WebView içinde açılır,
 *  IPTV sağlayıcısına doğrudan bağlanır, PC gerekmez.
 *  v2.1: gömülü VLC oynatıcı (libVLC) - her biçim (MKV, AVI, TS, AC3/DTS ses) açılır, canlı yayın hızlı başlar. */
public class MainActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private VLCVideoLayout vlcView;
    private LibVLC lib;
    private MediaPlayer mp;
    private boolean vlcOn = false, live = false, stopped = false;
    private long lastTime = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {   // görüntü çentiğin/kameranın yanına kadar uzansın
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(13, 14, 18));

        // VLC görüntüsü (sayfanın arkasında; küçük pencerede önünde)
        vlcView = new VLCVideoLayout(this);
        vlcView.setVisibility(View.GONE);
        root.addView(vlcView, new FrameLayout.LayoutParams(0, 0));

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);   // yerel sayfa sağlayıcı sunucusuna istek atabilsin
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // YouTube aramasında masaüstü sayfası gelsin (iPhone sürümündeki gibi)
        s.setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            // videonun üstünde gri "oynat" simgesi çıkmasın
            @Override public Bitmap getDefaultVideoPoster() { return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888); }
        });
        web.addJavascriptInterface(new Bridge(), "WolfAndroid");
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        immersive();
        if (b != null) web.restoreState(b); else web.loadUrl("file:///android_asset/www/login.html");
    }

    /* ---------------- VLC ---------------- */
    private void vlcInit() {
        if (mp != null) return;
        ArrayList<String> o = new ArrayList<>();
        o.add("--http-reconnect");
        o.add("--audio-time-stretch");          // hız değişince ses incelmesin
        o.add("--avcodec-skiploopfilter=1");    // zayıf telefonlarda akıcı görüntü
        o.add("--no-stats");
        lib = new LibVLC(this, o);
        mp = new MediaPlayer(lib);
        mp.attachViews(vlcView, null, true, true);   // TextureView: küçük pencerede sayfanın önüne alınabilsin
        mp.setEventListener(ev -> {
            switch (ev.type) {
                case MediaPlayer.Event.Playing: emit("playing"); break;
                case MediaPlayer.Event.Paused: emit("pause"); break;
                case MediaPlayer.Event.EndReached: if (!stopped) emit("ended"); break;
                case MediaPlayer.Event.EncounteredError: emit("error"); break;
                case MediaPlayer.Event.TimeChanged: {
                    long now = System.currentTimeMillis();
                    if (now - lastTime > 500) { lastTime = now; emit("time"); }
                    break;
                }
                default: break;
            }
        });
    }

    private void emit(String type) { emit(type, null); }

    private void emit(String type, String extra) {
        if (mp == null || web == null) return;
        double t = mp.getTime() / 1000.0, d = live ? 0 : mp.getLength() / 1000.0;
        int na = 0, ns = 0;
        try { MediaPlayer.TrackDescription[] a = mp.getAudioTracks(); if (a != null) for (MediaPlayer.TrackDescription x : a) if (x.id >= 0) na++; } catch (Exception e) {}
        try { MediaPlayer.TrackDescription[] a = mp.getSpuTracks(); if (a != null) for (MediaPlayer.TrackDescription x : a) if (x.id >= 0) ns++; } catch (Exception e) {}
        String js = "window.wolfVlcEv&&wolfVlcEv('" + type + "',{t:" + t + ",d:" + d + ",na:" + na + ",ns:" + ns
                + (extra != null ? ",name:" + JSONObject.quote(extra) : "") + "})";
        web.evaluateJavascript(js, null);
    }

    private void vlcCmd(String c, JSONObject a) {
        try {
            switch (c) {
                case "play": {
                    vlcInit();
                    stopped = false;
                    live = a.optBoolean("live");
                    Media m = new Media(lib, Uri.parse(a.getString("url")));
                    m.setHWDecoderEnabled(true, false);
                    m.addOption(":network-caching=" + (live ? 1200 : 2000));
                    m.addOption(":http-user-agent=VLC/3.0 LibVLC/3.0");
                    double st = a.optDouble("start", 0);
                    if (st > 1) m.addOption(":start-time=" + (int) st);
                    mp.setMedia(m);
                    m.release();
                    mp.play();
                    mp.setRate((float) a.optDouble("rate", 1));
                    mp.setVolume(a.optBoolean("muted") ? 0 : 100);
                    vlcOn = true;
                    vlcView.setVisibility(View.VISIBLE);
                    break;
                }
                case "pause": if (mp != null) mp.pause(); break;
                case "resume": if (mp != null && !mp.isPlaying()) mp.play(); break;
                case "seek": if (mp != null && mp.isSeekable()) mp.setTime((long) (a.optDouble("t") * 1000)); break;
                case "stop":
                    if (mp != null) { stopped = true; mp.stop(); }
                    vlcOn = false;
                    vlcView.setVisibility(View.GONE);
                    break;
                case "vol": if (mp != null) mp.setVolume(a.optBoolean("muted") ? 0 : 100); break;
                case "rate": if (mp != null) mp.setRate((float) a.optDouble("r", 1)); break;
                case "scale": {
                    if (mp == null) break;
                    String md = a.optString("mode", "fit");
                    MediaPlayer.ScaleType st = MediaPlayer.ScaleType.SURFACE_BEST_FIT;
                    if (md.equals("fill")) st = MediaPlayer.ScaleType.SURFACE_FIT_SCREEN;
                    else if (md.equals("str")) st = MediaPlayer.ScaleType.SURFACE_FILL;
                    else if (md.equals("169")) st = MediaPlayer.ScaleType.SURFACE_16_9;
                    else if (md.equals("43")) st = MediaPlayer.ScaleType.SURFACE_4_3;
                    mp.setVideoScale(st);
                    float z = (float) a.optDouble("zoom", 1);
                    vlcView.setScaleX(z); vlcView.setScaleY(z);
                    break;
                }
                case "rect": {
                    float k = getResources().getDisplayMetrics().density;
                    int w = (int) (a.optDouble("w") * k), h = (int) (a.optDouble("h") * k);
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.max(w, 1), Math.max(h, 1));
                    lp.leftMargin = (int) (a.optDouble("x") * k);
                    lp.topMargin = (int) (a.optDouble("y") * k);
                    vlcView.setLayoutParams(lp);
                    vlcView.setVisibility(vlcOn && w > 0 && h > 0 ? View.VISIBLE : View.GONE);
                    if (a.optBoolean("top")) vlcView.bringToFront(); else web.bringToFront();
                    root.requestLayout();
                    root.invalidate();
                    break;
                }
                case "track": {
                    if (mp == null) break;
                    boolean au = "audio".equals(a.optString("kind"));
                    MediaPlayer.TrackDescription[] tr = au ? mp.getAudioTracks() : mp.getSpuTracks();
                    if (tr == null || tr.length == 0) { emit("track", au ? "Bu içerikte tek ses dili var" : "Bu içerikte altyazı yok"); break; }
                    int cur = au ? mp.getAudioTrack() : mp.getSpuTrack(), i = 0;
                    for (int j = 0; j < tr.length; j++) if (tr[j].id == cur) i = j;
                    if (au && tr.length > 1 && tr[(i + 1) % tr.length].id < 0) i++;   // ses kapatma seçeneğini atla
                    MediaPlayer.TrackDescription n = tr[(i + 1) % tr.length];
                    if (au) mp.setAudioTrack(n.id); else mp.setSpuTrack(n.id);
                    emit("track", (au ? "🔊 Ses: " : (n.id < 0 ? "" : "CC ")) + (n.id < 0 ? "Altyazı kapalı" : n.name));
                    break;
                }
                default: break;
            }
        } catch (Exception e) {
            emit("error");
        }
    }

    /* ---------------- ekran, küçük pencere, geri tuşu ---------------- */
    private void immersive() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    private boolean pipStart() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try {
            enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build());
            return true;
        } catch (Exception e) { return false; }
    }

    /** Ana ekran tuşuna basınca yayın oynuyorsa kendiliğinden küçük pencereye geç (Titan / YouTube gibi) */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 26) return;
        web.evaluateJavascript("(window.S&&S.playing&&!S.mini&&window.V&&!V.paused&&!(S.now&&(S.now.yt||S.now.web)))?1:0",
                v -> { if ("1".equals(v)) pipStart(); });
    }

    @Override
    public void onPictureInPictureModeChanged(boolean on, Configuration c) {
        super.onPictureInPictureModeChanged(on, c);
        web.evaluateJavascript("window.wolfPip&&wolfPip(" + on + ")", null);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onPause() { super.onPause(); if (Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode()) return; web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); immersive(); }

    @Override
    protected void onStop() {
        super.onStop();
        // uygulama arka plana geçince (küçük pencere değilse) VLC sesi sürmesin
        if (mp != null && mp.isPlaying()) { mp.pause(); }
    }

    @Override
    protected void onDestroy() {
        if (mp != null) { mp.stop(); mp.detachViews(); mp.release(); mp = null; }
        if (lib != null) { lib.release(); lib = null; }
        web.destroy();
        super.onDestroy();
    }

    class Bridge {
        @JavascriptInterface public void pip() { runOnUiThread(() -> pipStart()); }
        @JavascriptInterface public String surum() { return "2.1"; }
        @JavascriptInterface public void vlc(final String c, final String json) {
            runOnUiThread(() -> {
                JSONObject a;
                try { a = new JSONObject(json == null || json.isEmpty() ? "{}" : json); } catch (Exception e) { a = new JSONObject(); }
                vlcCmd(c, a);
            });
        }
    }
}

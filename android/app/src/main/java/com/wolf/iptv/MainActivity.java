package com.wolf.iptv;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
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

/** Wolf IPTV - Android: iPhone sürümüyle aynı sayfalar (assets/www) WebView içinde açılır,
 *  IPTV sağlayıcısına doğrudan bağlanır, PC gerekmez. Küçük pencere (PiP), tam ekran, ekran kararmaz. */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {   // görüntü çentiğin/kameranın yanına kadar uzansın
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(13, 14, 18));
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
        setContentView(web);
        immersive();
        if (b != null) web.restoreState(b); else web.loadUrl("file:///android_asset/www/login.html");
    }

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
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }

    class Bridge {
        @JavascriptInterface public void pip() { runOnUiThread(() -> pipStart()); }
        @JavascriptInterface public String surum() { return "2.0"; }
    }
}

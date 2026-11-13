import SwiftUI
import WebKit
import AVFoundation

@main
struct WolfIPTVApp: App {
    init() { try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback) }
    var body: some Scene { WindowGroup { WebView().ignoresSafeArea().statusBarHidden(true) } }
}

/// Uygulamanın kendi sayfaları (login.html, tv.html) WKWebView içinde açılır;
/// sayfalar IPTV sağlayıcısına doğrudan bağlanır, PC gerekmez.
struct WebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsPictureInPictureMediaPlayback = true
        // yerel sayfanın sağlayıcı sunucusuna istek atabilmesi için
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        cfg.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1)
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        // YouTube aramasında masaüstü sayfası gelsin (mobil m.youtube sayfası farklı biçimde)
        wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        if let dir = Bundle.main.url(forResource: "www", withExtension: nil) {
            wv.loadFileURL(dir.appendingPathComponent("login.html"), allowingReadAccessTo: dir)
        }
        return wv
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

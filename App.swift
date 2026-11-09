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
        if let page = Bundle.main.url(forResource: "login", withExtension: "html") {
            wv.loadFileURL(page, allowingReadAccessTo: Bundle.main.bundleURL)
        }
        return wv
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

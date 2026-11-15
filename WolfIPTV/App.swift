import SwiftUI
import WebKit
import AVFoundation
import MobileVLCKit

@main
struct WolfIPTVApp: App {
    init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }
    var body: some Scene { WindowGroup { WebView().ignoresSafeArea().statusBarHidden(true) } }
}

/// Uygulamanın kendi sayfaları (login.html, tv.html) WKWebView içinde açılır;
/// sayfalar IPTV sağlayıcısına doğrudan bağlanır, PC gerekmez.
/// v2.1: gömülü VLC (MobileVLCKit) - telefonun oynatıcısı açamadığı her biçim (MKV, AVI, TS, AC3/DTS) VLC ile açılır.
struct WebView: UIViewRepresentable {
    func makeCoordinator() -> VLCBridge { VLCBridge() }

    func makeUIView(context: Context) -> UIView {
        UIApplication.shared.isIdleTimerDisabled = true   // izlerken ekran kararmasın
        let root = UIView()
        root.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1)

        let vlcView = UIView()
        vlcView.backgroundColor = .black
        vlcView.isHidden = true
        vlcView.isUserInteractionEnabled = false
        root.addSubview(vlcView)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsPictureInPictureMediaPlayback = true
        // yerel sayfanın sağlayıcı sunucusuna istek atabilmesi için
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        cfg.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        cfg.userContentController.add(context.coordinator, name: "wolfvlc")
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = .clear
        wv.scrollView.backgroundColor = .clear
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        // sayfa yakınlaşmasın / kaymasın: dokunuşta ekran oynamasın
        wv.scrollView.bounces = false
        wv.scrollView.bouncesZoom = false
        wv.scrollView.minimumZoomScale = 1
        wv.scrollView.maximumZoomScale = 1
        wv.scrollView.pinchGestureRecognizer?.isEnabled = false
        wv.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { wv.isInspectable = true }
        // YouTube aramasında masaüstü sayfası gelsin (mobil m.youtube sayfası farklı biçimde)
        wv.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        wv.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            wv.topAnchor.constraint(equalTo: root.topAnchor),
            wv.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        context.coordinator.attach(root: root, web: wv, video: vlcView)
        if let dir = Bundle.main.url(forResource: "www", withExtension: nil) {
            wv.loadFileURL(dir.appendingPathComponent("login.html"), allowingReadAccessTo: dir)
        }
        return root
    }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

/// Sayfa ↔ VLC köprüsü. Sayfa: webkit.messageHandlers.wolfvlc.postMessage({c, a});
/// VLC olayları sayfaya: wolfVlcEv(tür, {t, d, na, ns, name})
final class VLCBridge: NSObject, WKScriptMessageHandler, VLCMediaPlayerDelegate {
    private weak var root: UIView?
    private weak var web: WKWebView?
    private weak var video: UIView?
    private var player: VLCMediaPlayer?
    private var live = false
    private var on = false
    private var stopping = false
    private var lastTime: TimeInterval = 0
    private var mode = "fit"
    private var wasPlaying = false

    func attach(root: UIView, web: WKWebView, video: UIView) {
        self.root = root; self.web = web; self.video = video
    }

    private func vlc() -> VLCMediaPlayer {
        if let p = player { return p }
        let p = VLCMediaPlayer(options: ["--http-reconnect", "--audio-time-stretch", "--avcodec-skiploopfilter=1"])
        p.delegate = self
        p.drawable = video
        player = p
        return p
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let c = body["c"] as? String else { return }
        let a = body["a"] as? [String: Any] ?? [:]
        DispatchQueue.main.async { self.cmd(c, a) }
    }

    private func num(_ a: [String: Any], _ k: String, _ d: Double = 0) -> Double {
        if let n = a[k] as? NSNumber { return n.doubleValue }
        return d
    }

    private func cmd(_ c: String, _ a: [String: Any]) {
        switch c {
        case "play":
            guard let s = a["url"] as? String, let url = URL(string: s) else { emit("error"); return }
            let p = vlc()
            stopping = false
            wasPlaying = false
            live = (a["live"] as? Bool) ?? false
            let m = VLCMedia(url: url)
            var o: [AnyHashable: Any] = ["network-caching": live ? 1200 : 2000, "http-user-agent": "VLC/3.0 LibVLC/3.0"]
            let st = num(a, "start")
            if st > 1 { o["start-time"] = Int(st) }
            m.addOptions(o)
            p.media = m
            p.play()
            p.rate = Float(num(a, "rate", 1))
            p.audio?.volume = ((a["muted"] as? Bool) ?? false) ? 0 : 100
            on = true
            video?.isHidden = false
        case "pause": player?.pause()
        case "resume": if let p = player, !p.isPlaying { p.play() }
        case "seek":
            if let p = player, p.isSeekable { p.time = VLCTime(int: Int32(num(a, "t") * 1000)) }
        case "stop":
            stopping = true
            player?.stop()
            on = false
            video?.isHidden = true
        case "vol": player?.audio?.volume = ((a["muted"] as? Bool) ?? false) ? 0 : 100
        case "rate": player?.rate = Float(num(a, "r", 1))
        case "scale":
            mode = (a["mode"] as? String) ?? "fit"
            applyScale()
            let z = CGFloat(num(a, "zoom", 1))
            video?.transform = CGAffineTransform(scaleX: z, y: z)
        case "rect":
            guard let v = video, let r = root, let w = web else { return }
            let f = CGRect(x: num(a, "x"), y: num(a, "y"), width: num(a, "w"), height: num(a, "h"))
            let t = v.transform
            v.transform = .identity
            v.frame = f
            v.transform = t
            v.isHidden = !on || f.width < 1 || f.height < 1
            if (a["top"] as? Bool) ?? false { r.bringSubviewToFront(v) } else { r.bringSubviewToFront(w) }
            applyScale()
        case "track":
            guard let p = player else { return }
            let au = (a["kind"] as? String) == "audio"
            let ids = (au ? p.audioTrackIndexes : p.videoSubTitlesIndexes) as? [NSNumber] ?? []
            let names = (au ? p.audioTrackNames : p.videoSubTitlesNames) as? [String] ?? []
            if ids.isEmpty { emit("track", au ? "Bu içerikte tek ses dili var" : "Bu içerikte altyazı yok"); return }
            let cur = au ? p.currentAudioTrackIndex : p.currentVideoSubTitleIndex
            var i = ids.firstIndex(where: { $0.int32Value == cur }) ?? 0
            if au && ids.count > 1 && ids[(i + 1) % ids.count].int32Value < 0 { i += 1 }   // ses kapatmayı atla
            let n = (i + 1) % ids.count
            let id = ids[n].int32Value
            if au { p.currentAudioTrackIndex = id } else { p.currentVideoSubTitleIndex = id }
            let nm = n < names.count ? names[n] : "\(n + 1)"
            emit("track", au ? "🔊 Ses: \(nm)" : (id < 0 ? "Altyazı kapalı" : "CC \(nm)"))
        default: break
        }
    }

    /// Sığdır / Doldur / Uzat / 16:9 / 4:3
    private func applyScale() {
        guard let p = player, let v = video else { return }
        let w = Int(v.bounds.width.rounded()), h = Int(v.bounds.height.rounded())
        p.scaleFactor = 0
        p.videoCropGeometry = nil
        p.videoAspectRatio = nil
        switch mode {
        case "fill": if w > 0 && h > 0 { p.videoCropGeometry = strdup("\(w):\(h)") }
        case "str": if w > 0 && h > 0 { p.videoAspectRatio = strdup("\(w):\(h)") }
        case "169": p.videoAspectRatio = strdup("16:9")
        case "43": p.videoAspectRatio = strdup("4:3")
        default: break
        }
    }

    private func emit(_ type: String, _ name: String? = nil) {
        guard let web = web else { return }
        let p = player
        let t = Double(p?.time.intValue ?? 0) / 1000
        let d = live ? 0 : Double(p?.media?.length.intValue ?? 0) / 1000
        let na = (p?.audioTrackIndexes as? [NSNumber] ?? []).filter { $0.int32Value >= 0 }.count
        let ns = (p?.videoSubTitlesIndexes as? [NSNumber] ?? []).filter { $0.int32Value >= 0 }.count
        var extra = ""
        if let n = name, let j = try? JSONSerialization.data(withJSONObject: [n], options: []), let s = String(data: j, encoding: .utf8) {
            extra = ",name:" + String(s.dropFirst().dropLast())
        }
        let js = "window.wolfVlcEv&&wolfVlcEv('\(type)',{t:\(t),d:\(d),na:\(na),ns:\(ns)\(extra)})"
        DispatchQueue.main.async { web.evaluateJavaScript(js, completionHandler: nil) }
    }

    func mediaPlayerStateChanged(_ aNotification: Notification) {
        guard let p = player else { return }
        switch p.state {
        case .playing:
            if !wasPlaying { wasPlaying = true; emit("playing") }
        case .paused:
            wasPlaying = false; emit("pause")
        case .ended:
            wasPlaying = false; if !stopping { emit("ended") }
        case .error:
            wasPlaying = false; emit("error")
        case .stopped:
            wasPlaying = false
        default: break
        }
    }

    func mediaPlayerTimeChanged(_ aNotification: Notification) {
        if !wasPlaying { wasPlaying = true; emit("playing"); return }
        let now = Date().timeIntervalSince1970
        if now - lastTime > 0.5 { lastTime = now; emit("time") }
    }
}

# Wolf IPTV – iPhone ve Android uygulaması (PC'siz, ev dışında da çalışır)
Uygulama IPTV sağlayıcısına doğrudan bağlanır: Wi‑Fi ya da mobil veriyle her yerde çalışır.
Her `push`ta GitHub Actions iki paket derler:
- **iPhone:** imzasız `WolfIPTV.ipa` (Releases → ios-latest). PC'de Sideloadly → iPhone kabloyla → IPA'yı Apple kimliğinle yükle. Ücretsiz Apple kimliğinde imza 7 gün geçerlidir.
- **Android:** `WolfIPTV.apk` (Releases → android-latest). Telefonda linki aç, indir, "bilinmeyen kaynaklara izin ver" de, kur.

Sayfalar tek yerde: `WolfIPTV/www` (Android derlemesi bunları kopyalar).

v2.0 oynatıcı: Sığdır / Doldur / Uzat / 16:9 / 4:3 görüntü modları, iki parmakla yakınlaştırma, çift dokunuşla 10 sn ileri/geri,
küçük pencere (PiP), oynatma hızı, ekran kilidi; Android'de ana ekrana dönünce kendiliğinden küçük pencere.

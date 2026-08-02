# Merdeka Share (Android Native App)

Native Android app (Kotlin) yang menerima PDF resi via **Android Native Share Target**
(intent-filter `ACTION_SEND` / `ACTION_SEND_MULTIPLE` untuk `application/pdf`).

Bukan PWA. Bukan Web Share Target API. Ini adalah aplikasi Android murni yang
terdaftar di sistem Android sebagai share target melalui `AndroidManifest.xml`.

## Fitur

1. **Login sekali** — Simpan token via `EncryptedSharedPreferences` di device.
2. **Terima share PDF** — Muncul di Android share sheet ketika user share file PDF dari app apapun (WhatsApp, File Manager, Gmail, Chrome, dsb).
3. **Auto-upload** — Setiap PDF yang di-share otomatis di-upload ke endpoint MIS `/api/om/pdfs/auto`.
4. **Auto-rename** — File di-rename di server jadi `DDMMYY-N.pdf` (N urut per hari).
5. **Daftar hari ini** — Home screen menampilkan daftar PDF yang sudah terupload hari ini.

## Requirements

- Android 8.0+ (API 26) — mencakup 96%+ perangkat aktif.
- Koneksi internet.

## Build

### Otomatis via GitHub Actions (rekomendasi)

Workflow `.github/workflows/build-android-apk.yml` otomatis build APK setiap push ke `main`
atau workflow_dispatch manual. Download APK dari tab **Actions → workflow run → Artifacts**.

### Manual via Android Studio

1. Open folder `android-app/` di Android Studio (Iguana/Jellyfish/Koala)
2. Wait for Gradle sync
3. Run → Run 'app' atau Build → Build Bundle(s)/APK(s) → Build APK(s)

### Manual via CLI (Linux/macOS dengan Android SDK + JDK 17)

```bash
cd android-app
# Generate wrapper (only first time)
gradle wrapper --gradle-version 8.7 --distribution-type bin
# Build
./gradlew assembleDebug     # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

## Struktur

```
android-app/
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml          # intent-filter ACTION_SEND / ACTION_SEND_MULTIPLE
│       ├── java/com/merdeka/share/
│       │   ├── MainActivity.kt          # Login + home screen
│       │   ├── ShareActivity.kt         # Handles shared PDFs
│       │   ├── ApiClient.kt             # OkHttp client for MIS API
│       │   └── AuthManager.kt           # Secure token storage
│       └── res/
│           ├── layout/                  # activity_main.xml, activity_share.xml
│           ├── values/                  # strings, colors, themes
│           ├── xml/                     # backup + data extraction rules
│           ├── drawable/                # Adaptive icon foreground/background
│           └── mipmap-anydpi-v26/       # Adaptive icon spec
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
└── gradle/wrapper/gradle-wrapper.properties
```

## Package & Signing

- Package name: `com.merdeka.share`
- App label: `Merdeka Share`
- Release APK di-sign dengan debug keystore (untuk kemudahan distribusi internal).
  Untuk publish ke Play Store, ganti `signingConfig` di `app/build.gradle.kts`.

## Backend Endpoint

App memanggil 2 endpoint MIS:
- `POST /api/auth/login` — Login owner/staff
- `POST /api/om/pdfs/auto` — Upload PDF (multipart, field `file`)
- `GET  /api/om/pdfs`     — List upload hari ini

Base URL default: `https://pdf-notify-sound.preview.emergentagent.com` (bisa diubah di login screen).

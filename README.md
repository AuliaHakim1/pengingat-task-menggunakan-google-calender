# 🤖 Bot Telegram Pengingat Jadwal + Google Calendar

> Asisten pribadi berbasis Telegram yang terhubung ke Google Calendar, dilengkapi AI untuk memahami perintah bahasa natural.

![Node.js](https://img.shields.io/badge/Node.js-ES%20Modules-339933?logo=node.js&logoColor=white)
![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)
![Telegram](https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?logo=telegram)
![Google Calendar](https://img.shields.io/badge/Google-Calendar%20API-4285F4?logo=google-calendar)
![OpenRouter](https://img.shields.io/badge/AI-OpenRouter%20Free-FF6B6B)

---

## ✨ Fitur Unggulan

| Fitur | Deskripsi |
|---|---|
| 🗓 **Cek Agenda Hari Ini** | Tampilkan semua jadwal hari ini + info cuaca |
| 📅 **Cek Agenda Besok** | Tampilkan jadwal untuk esok hari |
| ➕ **Tambah Acara** | Buat acara baru di Google Calendar langsung dari Telegram |
| ✏️ **Edit Deskripsi** | Perbarui deskripsi acara yang sudah ada |
| 🗑️ **Hapus Acara** | Batalkan acara langsung dari chat |
| 🌤 **Cek Cuaca** | Info cuaca real-time berdasarkan lokasi GPS Anda |
| 🤖 **Bahasa Natural (AI)** | Perintah bebas tanpa format kaku, dipahami AI |
| ☀️ **Laporan Harian Otomatis** | Cron job kirim ringkasan jadwal + cuaca setiap pagi |

---

## 🧠 Cara Kerja

```
Pesan Telegram User
        │
        ▼
  OpenRouter AI (Free)
  ┌─────────────────────┐
  │  Parse intent &     │
  │  extract data       │
  └─────────────────────┘
        │
        ▼
  Intent Routing
  ├── cek_agenda_hari_ini  → Google Calendar API
  ├── cek_agenda_besok     → Google Calendar API
  ├── tambah_acara         → Google Calendar API (insert)
  ├── edit_deskripsi       → Google Calendar API (patch)
  ├── hapus_acara          → Google Calendar API (delete)
  ├── cek_cuaca            → WeatherAPI + GPS Location
  └── fallback             → Keyword Matching (backup)
        │
        ▼
  Balas ke Telegram
```

---

## 💬 Contoh Penggunaan (Bahasa Natural!)

Tidak perlu hafal format perintah kaku. Cukup bicara seperti biasa:

```
"jadwal hari ini apa aja?"
"besok ada acara apa?"
"lusa ada rapat klien jam 2 siang"
"tambah acara: Nongkrong 20-05-2026"
"edit deskripsi rapat klien
 update: meeting via zoom, link dikirim via WA"
"hapus acara rapat evaluasi tanggal 22 Mei"
"cuaca sekarang gimana?"
```

---

## 🏗️ Arsitektur

```
botTeleGcal/
├── api/
│   ├── webhook.js      # Handler pesan Telegram (utama)
│   └── cron.js         # Laporan harian otomatis (Vercel Cron)
├── vercel.json         # Konfigurasi deployment & cron schedule
└── package.json
```

**Stack Teknologi:**
- **Runtime:** Node.js (ES Modules)
- **Hosting:** Vercel Serverless Functions
- **AI Parser:** OpenRouter API (model gratis)
- **Kalender:** Google Calendar API v3 (OAuth2)
- **Cuaca:** WeatherAPI
- **Messaging:** Telegram Bot API

---

## 🚀 Panduan Deployment

### Prasyarat
- Akun [Vercel](https://vercel.com) (gratis)
- Akun [Google Cloud Console](https://console.cloud.google.com)
- Bot Telegram (buat via [@BotFather](https://t.me/BotFather))
- Akun [WeatherAPI](https://www.weatherapi.com) (gratis)
- Akun [OpenRouter](https://openrouter.ai) (gratis)

### Langkah 1: Clone & Deploy ke Vercel

```bash
git clone https://github.com/AuliaHakim1/pengingat-task-menggunakan-google-calender.git
cd pengingat-task-menggunakan-google-calender
```

Push ke GitHub, lalu import di Vercel Dashboard.

### Langkah 2: Setup Google OAuth2

1. Buka [Google Cloud Console](https://console.cloud.google.com)
2. Buat project baru → aktifkan **Google Calendar API**
3. Buat **OAuth 2.0 Client ID** (tipe: Web Application)
4. Buka [OAuth Playground](https://developers.google.com/oauthplayground)
5. Di settings (⚙️), centang *"Use your own OAuth credentials"* dan masukkan Client ID & Secret Anda
6. Pilih scope: `https://www.googleapis.com/auth/calendar`
7. Authorize → Exchange code → Salin **Refresh Token**

### Langkah 3: Setup Environment Variables di Vercel

Masuk ke **Vercel Dashboard → Settings → Environment Variables**, tambahkan:

| Variable | Deskripsi |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token bot dari @BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID Anda (untuk laporan pagi otomatis) |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID dari Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret dari Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | Refresh Token dari OAuth Playground |
| `CALENDAR_SIB_ID` | (Opsional) ID kalender Google tambahan |
| `WEATHER_API_KEY` | API Key dari WeatherAPI |
| `OPENROUTER_API_KEY` | API Key dari OpenRouter (gratis) |
| `CRON_SECRET` | String acak untuk keamanan endpoint cron |

### Langkah 4: Daftarkan Webhook Telegram

Setelah deploy, jalankan perintah ini di browser atau Postman:

```
https://api.telegram.org/bot<TOKEN_ANDA>/setWebhook?url=https://<nama-project>.vercel.app/api/webhook
```

Ganti `<TOKEN_ANDA>` dan `<nama-project>` dengan nilai milik Anda.

---

## ⏰ Laporan Harian Otomatis

Bot secara otomatis mengirimkan laporan pagi setiap hari (jam 07:00 WIB) ke `TELEGRAM_CHAT_ID` yang sudah dikonfigurasi. Laporan berisi:
- 🌤 Info cuaca terkini (lokasi statis di kode `cron.js`)
- 📅 Semua jadwal hari ini dari Google Calendar

> **Catatan:** Vercel Hobby Plan mendukung 1 cron job per hari (minimum 1x sehari). Jadwal ini sudah dikonfigurasi di `vercel.json`.

---

<div align="center">
  <p>Crafted by <b>Aulia Hakim</b> | Powered by Vercel Serverless & Google Calendar API</p>
</div>

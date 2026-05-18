import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end('Unauthorized');
  }

  try {
    // === 1. SETUP AUTH GOOGLE CALENDAR ===
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    // Masukin refresh token biar gak perlu login ulang tiap hari
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // === 2. SET TIMEFRAME HARI INI ===
    // Mengambil batas awal dan akhir hari ini (WIB / waktu lokal server)
    const sekarang = new Date();
    const awalHari = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate(), 0, 0, 0);
    const akhirHari = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate(), 23, 59, 59);

    // === 3. FETCH AGENDA DARI BEBERAPA GOOGLE CALENDAR ===
    // Masukin ID kalender yang mau dicek (kalender utama dan kalender SIB)
    const calendarIds = ['primary', process.env.CALENDAR_SIB_ID];
    let allEvents = [];

    // Looping buat narik jadwal dari semua kalender yang ada di array
    for (const calId of calendarIds) {
      if (!calId) continue; // Skip kalau ID kalendernya kosong/belum di-set
      try {
        const calendarRes = await calendar.events.list({
          calendarId: calId,
          timeMin: awalHari.toISOString(),
          timeMax: akhirHari.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        });
        allEvents = allEvents.concat(calendarRes.data.items || []);
      } catch (err) {
        console.error(`Gagal narik kalender ${calId}:`, err.message);
      }
    }

    // Urutin semua event gabungan berdasarkan waktu mulai
    allEvents.sort((a, b) => {
      const timeA = a.start.dateTime || a.start.date;
      const timeB = b.start.dateTime || b.start.date;
      return new Date(timeA) - new Date(timeB);
    });

    let agenda = "Gak ada agenda hari ini, santai cuy!";

    if (allEvents.length > 0) {
      agenda = allEvents
        .map((event, index) => {
          // Cek apakah event seharian penuh atau ada jamnya
          const waktuMulai = event.start.dateTime
            ? new Date(event.start.dateTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : 'Seharian';
          
          return `${index + 1}. [${waktuMulai}] ${event.summary}`;
        })
        .join('\n');
    }

    // === 4. FETCH CUACA (WeatherAPI) ===
    const weatherURL = `http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=Bekasi`;
    const weatherRes = await fetch(weatherURL);
    const weatherData = await weatherRes.json();
    const cuaca = weatherData.current.condition.text;
    const suhu = weatherData.current.temp_c;
    const lokasi = weatherData.location.name;

    // === 5. FORMAT & KIRIM TELEGRAM ===
    const textTelegram = `Halo! Ini update hari ini:\n\n📍 Lokasi: ${lokasi}\n🌤️ Cuaca: ${cuaca} (${suhu}°C)\n\n📅 Agenda Hari Ini:\n${agenda}`;

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: textTelegram,
      }),
    });

    return res.status(200).json({ success: true, message: 'Workflow lancar jaya!' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
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

    // === 2. SET TIMEFRAME HARI INI (FIX ZONA WAKTU WIB) ===
    // Karena Vercel pakai UTC, kita paksa bikin batasan hari ini pakai zona waktu Jakarta (WIB)
    const tglWIB = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'Asia/Jakarta', 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit' 
    }).format(new Date());

    const awalHari = new Date(`${tglWIB}T00:00:00+07:00`);
    const akhirHari = new Date(`${tglWIB}T23:59:59+07:00`);

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

    // === FORMAT AGENDA MIRIP N8N ===
    let agenda = "Gak ada agenda hari ini, santai cuy!";

    if (allEvents.length > 0) {
      agenda = allEvents
        .map((event) => {
          // 1. Ambil Waktu persis format n8n (ISO Date)
          let waktuMulai = event.start.date || 'Seharian Penuh'; // fallback kalau event seharian
          if (event.start.dateTime) {
            waktuMulai = event.start.dateTime; 
          }

          // 2. Ambil Judul dan Lokasi
          const judul = event.summary || 'Tanpa Judul';
          const lokasiEvent = event.location ? `\nLokasi: ${event.location}` : '';
          
          // 3. Ambil dan Bersihkan Deskripsi
          let deskripsi = '';
          if (event.description) {
            let descBersih = event.description
              .replace(/<br\s*[\/]?>/gi, '\n') // Ubah <br> jadi baris baru
              .replace(/<[^>]+>/g, '');        // Hapus sisa tag HTML kayak <a>, <b>, dll
            
            deskripsi = `\n\nDeskripsi:\n${descBersih}`;
          }

          // 4. Susun format template pesannya
          return `Acara: ${judul}\nWaktu: ${waktuMulai}${lokasiEvent}${deskripsi}`;
        })
        .join('\n\n------------------------\n\n'); // Garis pemisah kalau eventnya banyak
    }

    // === 4. FETCH CUACA (WeatherAPI) ===
    // Parameter location gw set Bekasi sesuai prompt awal lu, tapi lu bisa ganti jadi 'Jakarta' kalau mau plek ketiplek
    const weatherURL = `http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=Bekasi`;
    const weatherRes = await fetch(weatherURL);
    const weatherData = await weatherRes.json();
    const cuaca = weatherData.current.condition.text;
    const suhu = weatherData.current.temp_c;
    const lokasi = weatherData.location.name;

    // === 5. FORMAT & KIRIM TELEGRAM ===
    const textTelegram = `👋 Laporan Harian\n\n📍 Lokasi: ${lokasi}\n🌤 Kondisi: ${cuaca}\n🌡 Suhu: ${suhu}°C\n\n📅 Agenda Berikutnya:\n${agenda}`;

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
import { google } from 'googleapis';

export default async function handler(req, res) {
  // Wajib pakai metode POST karena Telegram ngirim datanya lewat POST
  if (req.method !== 'POST') {
    return res.status(200).send('Hanya menerima request POST dari Telegram');
  }

  // Ambil data pesan dari Telegram
  const message = req.body.message;
  
  // Kalau yang masuk bukan pesan teks atau lokasi, abaikan aja
  if (!message || (!message.text && !message.location)) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;

  // === ALUR 1: Jika User Mengirim Lokasi ===
  if (message.location) {
    try {
      const lat = message.location.latitude;
      const lon = message.location.longitude;
      
      const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${lat},${lon}`);
      const weatherData = await weatherRes.json();
      const cuaca = weatherData.current.condition.text;
      const suhu = weatherData.current.temp_c;
      const lokasi = weatherData.location.name;

      const textTelegram = `📍 Laporan Cuaca\n\nLokasi: ${lokasi}\n🌤 Kondisi: ${cuaca}\n🌡 Suhu: ${suhu}°C`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: textTelegram }),
      });
    } catch (error) {
      console.error("Gagal ambil cuaca:", error);
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: 'Waduh, gagal ngambil data cuaca nih.' }),
      });
    }
    return res.status(200).send('OK');
  }

  // === PASTIKAN ADA TEKS SEBELUM LANJUT ===
  if (!message.text) return res.status(200).send('OK');
  
  const teksMasuk = message.text.toLowerCase();

  // === ALUR 2: Jika User Minta Cuaca ===
  if (teksMasuk.includes('cuaca')) {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: 'Silakan kirim lokasi Anda untuk mendapatkan informasi cuaca terkini di daerah Anda.',
        reply_markup: {
          keyboard: [
            [{ text: '📍 Kirim Lokasi Saat Ini', request_location: true }]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }),
    });
    return res.status(200).send('OK');
  }

  // === ALUR 3: Laporan Penuh (Jadwal + Cuaca Statis) ===
  // Cek apakah pesan mengandung kata kunci nanyain jadwal
  if (teksMasuk.includes('halo') || teksMasuk.includes('kegiatan') || teksMasuk.includes('hari ini') || teksMasuk.includes('agenda')) {
    
    try {
      // === 1. SETUP AUTH GOOGLE CALENDAR ===
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );
      oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // === 2. SET TIMEFRAME WIB ===
      const tglWIB = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' 
      }).format(new Date());
      const awalHari = new Date(`${tglWIB}T00:00:00+07:00`);
      const akhirHari = new Date(`${tglWIB}T23:59:59+07:00`);

      // === 3. FETCH AGENDA ===
      const calendarIds = ['primary', process.env.CALENDAR_SIB_ID];
      let allEvents = [];

      for (const calId of calendarIds) {
        if (!calId) continue;
        try {
          const calendarRes = await calendar.events.list({
            calendarId: calId, timeMin: awalHari.toISOString(), timeMax: akhirHari.toISOString(),
            singleEvents: true, orderBy: 'startTime',
          });
          allEvents = allEvents.concat(calendarRes.data.items || []);
        } catch (err) {
          console.error(`Gagal narik kalender:`, err.message);
        }
      }

      allEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

      let agenda = "Gak ada agenda hari ini, santai cuy!";
      if (allEvents.length > 0) {
        agenda = allEvents.map((event) => {
          let waktuMulai = event.start.date || 'Seharian Penuh';
          if (event.start.dateTime) waktuMulai = event.start.dateTime;
          const judul = event.summary || 'Tanpa Judul';
          const lokasiEvent = event.location ? `\nLokasi: ${event.location}` : '';
          
          let deskripsi = '';
          if (event.description) {
            let descBersih = event.description.replace(/<br\s*[\/]?>/gi, '\n').replace(/<[^>]+>/g, '');
            deskripsi = `\n\nDeskripsi:\n${descBersih}`;
          }
          return `Acara: ${judul}\nWaktu: ${waktuMulai}${lokasiEvent}${deskripsi}`;
        }).join('\n\n------------------------\n\n');
      }

      // === 4. FETCH CUACA ===
      const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=Bekasi`);
      const weatherData = await weatherRes.json();
      const cuaca = weatherData.current.condition.text;
      const suhu = weatherData.current.temp_c;
      const lokasi = weatherData.location.name;

      // === 5. KIRIM BALIK KE TELEGRAM ===
      const textTelegram = `👋 Laporan Harian (Sesuai Permintaan)\n\n📍 Lokasi: ${lokasi}\n🌤 Kondisi: ${cuaca}\n🌡 Suhu: ${suhu}°C\n\n📅 Agenda Berikutnya:\n${agenda}`;

      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: textTelegram }),
      });

    } catch (error) {
      console.error(error);
      // Kirim pesan error ke user kalau gagal
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: 'Waduh, sistemnya lagi error nih ngecek jadwal.' }),
      });
    }
  } else {
    // Balesan kalau command gak dikenali
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: 'Gw cuma bot pengingat jadwal. Coba ketik "halo", "agenda", atau "cuaca".' }),
    });
  }

  // Wajib kirim 200 OK di akhir biar Telegram tau pesan udah diproses
  return res.status(200).send('OK');
}
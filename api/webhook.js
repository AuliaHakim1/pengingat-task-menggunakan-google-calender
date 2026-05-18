import { google } from 'googleapis';

// Helper untuk kirim pesan Telegram
async function sendTelegramMsg(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('Hanya menerima request POST');

  let chatId = null;
  let teksMasuk = '';
  let isLocation = false;
  let locationData = null;

  // 1. Cek jika pesan berupa Callback Query (dari tombol Inline)
  if (req.body.callback_query) {
    const callbackQuery = req.body.callback_query;
    chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    // Balas callback supaya loading icon di tombol Telegram hilang
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id }),
    });

    if (data === 'btn_agenda_hari_ini') teksMasuk = 'hari ini';
    if (data === 'btn_agenda_besok') teksMasuk = 'besok';
    if (data === 'btn_cuaca') teksMasuk = 'cuaca';
  } 
  // 2. Cek jika pesan teks biasa atau lokasi
  else if (req.body.message) {
    const message = req.body.message;
    chatId = message.chat.id;
    
    if (message.location) {
      isLocation = true;
      locationData = message.location;
    } else if (message.text) {
      teksMasuk = message.text.toLowerCase();
    }
  }

  // Jika tidak ada chatId, abaikan
  if (!chatId) return res.status(200).send('OK');

  // === FITUR 1: INTERAKTIF START ===
  if (teksMasuk === '/start' || teksMasuk === 'start') {
    await sendTelegramMsg(chatId, 'Halo! Saya asisten bot Anda. Silakan pilih menu di bawah ini:', {
      inline_keyboard: [
        [{ text: '🗓 Cek Agenda Hari Ini', callback_data: 'btn_agenda_hari_ini' }],
        [{ text: '📆 Cek Agenda Besok', callback_data: 'btn_agenda_besok' }],
        [{ text: '🌤 Cek Cuaca Saat Ini', callback_data: 'btn_cuaca' }]
      ]
    });
    return res.status(200).send('OK');
  }

  // === FITUR 2: LOKASI CUACA ===
  if (isLocation && locationData) {
    try {
      const { latitude: lat, longitude: lon } = locationData;
      const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${lat},${lon}`);
      const weatherData = await weatherRes.json();
      const textTelegram = `📍 Laporan Cuaca\n\nLokasi: ${weatherData.location.name}\n🌤 Kondisi: ${weatherData.current.condition.text}\n🌡 Suhu: ${weatherData.current.temp_c}°C`;
      await sendTelegramMsg(chatId, textTelegram);
    } catch (error) {
      console.error(error);
      await sendTelegramMsg(chatId, 'Waduh, gagal ngambil data cuaca nih.');
    }
    return res.status(200).send('OK');
  }

  // Minta Lokasi Cuaca
  if (teksMasuk.includes('cuaca')) {
    await sendTelegramMsg(chatId, 'Silakan kirim lokasi Anda untuk mendapatkan informasi cuaca terkini di daerah Anda.', {
      keyboard: [[{ text: '📍 Kirim Lokasi Saat Ini', request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true
    });
    return res.status(200).send('OK');
  }

  // === FITUR 3: TAMBAH JADWAL ===
  const tambahMatch = teksMasuk.match(/^tambah acara\s*:\s*(.*)/i);
  if (tambahMatch) {
    const content = tambahMatch[1];
    const dateMatch = content.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    
    if (!dateMatch) {
      await sendTelegramMsg(chatId, '❌ Format salah. Harap cantumkan tanggal dengan format DD-MM-YYYY.\nContoh: tambah acara : Rapat Klien 19-05-2026');
      return res.status(200).send('OK');
    }

    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    const year = dateMatch[3];
    const dateStr = `${year}-${month}-${day}`;
    
    let title = content.replace(dateMatch[0], '').replace(/\||-|:/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) title = 'Acara Baru';

    try {
      const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      
      await calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: title,
          start: { date: dateStr, timeZone: 'Asia/Jakarta' },
          end: { date: dateStr, timeZone: 'Asia/Jakarta' }
        }
      });
      await sendTelegramMsg(chatId, `✅ Berhasil menambahkan jadwal!\n\nAcara: ${title}\nTanggal: ${day}-${month}-${year}`);
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, '❌ Gagal menambahkan jadwal ke Google Calendar.');
    }
    return res.status(200).send('OK');
  }

  // === FITUR 4: CEK AGENDA (HARI INI / BESOK) ===
  const isCekJadwal = teksMasuk.includes('halo') || teksMasuk.includes('kegiatan') || teksMasuk.includes('hari ini') || teksMasuk.includes('agenda') || teksMasuk.includes('besok');
  
  if (isCekJadwal) {
    try {
      const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const isBesok = teksMasuk.includes('besok');
      const targetDate = new Date();
      if (isBesok) targetDate.setDate(targetDate.getDate() + 1); // Tambah 1 hari jika besok

      const tglWIB = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(targetDate);
      const awalHari = new Date(`${tglWIB}T00:00:00+07:00`);
      const akhirHari = new Date(`${tglWIB}T23:59:59+07:00`);

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
          console.error(err);
        }
      }

      allEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

      let agenda = `Tidak ada agenda untuk ${isBesok ? 'besok' : 'hari ini'}, santai cuy!`;
      if (allEvents.length > 0) {
        agenda = allEvents.map((event) => {
          let waktuMulai = event.start.date || 'Seharian Penuh';
          if (event.start.dateTime) {
            waktuMulai = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start.dateTime)) + ' WIB';
          }
          const judul = event.summary || 'Tanpa Judul';
          const lokasiEvent = event.location ? `\nLokasi: ${event.location}` : '';
          return `Acara: ${judul}\nWaktu: ${waktuMulai}${lokasiEvent}`;
        }).join('\n\n------------------------\n\n');
      }

      const greeting = isBesok ? '📅 Agenda Besok:' : '📅 Agenda Hari Ini:';
      
      // Jika cek hari ini secara teks (bukan tombol), sertakan cuaca statis sebagai fallback lama
      if (!isBesok && !req.body.callback_query && (teksMasuk.includes('halo') || teksMasuk.includes('hari ini'))) {
         const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=Bekasi`);
         const weatherData = await weatherRes.json();
         const textTelegram = `👋 Laporan Harian\n\n📍 Lokasi: ${weatherData.location.name}\n🌤 Kondisi: ${weatherData.current.condition.text}\n🌡 Suhu: ${weatherData.current.temp_c}°C\n\n${greeting}\n${agenda}`;
         await sendTelegramMsg(chatId, textTelegram);
      } else {
         await sendTelegramMsg(chatId, `${greeting}\n\n${agenda}`);
      }
      
    } catch (error) {
      console.error(error);
      await sendTelegramMsg(chatId, 'Waduh, sistemnya lagi error nih ngecek jadwal.');
    }
    return res.status(200).send('OK');
  }

  // Default fallback
  if (teksMasuk) {
    await sendTelegramMsg(chatId, 'Ketik /start untuk melihat menu, atau coba ketik:\ntambah acara : Rapat 19-05-2026');
  }
  return res.status(200).send('OK');
}
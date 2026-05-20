import { google } from 'googleapis';

// =============================================
// HELPER: Kirim pesan Telegram
// =============================================
async function sendTelegramMsg(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// =============================================
// HELPER: Setup Google Calendar Client
// =============================================
function getCalendarClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// =============================================
// HELPER: Ambil tanggal WIB saat ini
// =============================================
function getTodayWIB() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// =============================================
// HELPER: Parse pesan dengan OpenRouter AI
// =============================================
async function parseWithAI(text, today) {
  const systemPrompt = `Kamu adalah asisten parser perintah untuk bot Telegram kalender.
Tanggal hari ini (WIB): ${today}
Ekstrak intent dan data dari pesan bahasa Indonesia berikut.
Kembalikan HANYA JSON valid tanpa markdown, tanpa penjelasan, tanpa teks lain.

Intent yang tersedia:
- cek_agenda_hari_ini
- cek_agenda_besok
- tambah_acara (butuh: judul, tanggal YYYY-MM-DD, opsional: jam HH:MM, deskripsi)
- hapus_acara (butuh: judul, tanggal YYYY-MM-DD)
- edit_deskripsi (butuh: judul, tanggal YYYY-MM-DD, deskripsi_baru)
- cek_cuaca
- fallback (jika tidak ada intent yang cocok)

Format response JSON:
{
  "intent": "nama_intent",
  "judul": "judul acara jika ada",
  "tanggal": "YYYY-MM-DD jika ada",
  "jam": "HH:MM jika ada, null jika tidak disebutkan",
  "deskripsi": "teks deskripsi jika ada, null jika tidak ada"
}`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/AuliaHakim1/pengingat-task-menggunakan-google-calender',
        'X-Title': 'Bot Telegram Kalender'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 300
      })
    });

    const data = await res.json();

    // Log error dari OpenRouter jika ada
    if (data.error) {
      console.error('OpenRouter API error:', JSON.stringify(data.error));
      return { intent: 'ai_error', errorMsg: data.error.message || 'Unknown error' };
    }

    const rawContent = data.choices?.[0]?.message?.content?.trim();
    if (!rawContent) {
      console.error('OpenRouter empty response:', JSON.stringify(data));
      return { intent: 'fallback' };
    }

    // Bersihkan kalau ada markdown code block dari AI
    const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('OpenRouter fetch error:', err.message);
    return { intent: 'ai_error', errorMsg: err.message };
  }
}

// =============================================
// HELPER: Keyword fallback jika AI gagal
// =============================================
function parseWithKeyword(text, today) {
  const t = text.toLowerCase();
  if (t.includes('besok')) return { intent: 'cek_agenda_besok' };
  if (t.includes('hari ini') || t.includes('agenda') || t.includes('jadwal') || t.includes('halo') || t.includes('kegiatan')) return { intent: 'cek_agenda_hari_ini' };
  if (t.includes('cuaca')) return { intent: 'cek_cuaca' };
  if (t.includes('edit deskripsi') || t.includes('ubah deskripsi') || t.includes('tambah deskripsi')) return { intent: 'edit_deskripsi' };
  if (t.includes('hapus acara') || t.includes('batalkan acara') || t.includes('hapus jadwal')) return { intent: 'hapus_acara' };
  if (t.includes('tambah acara') || t.includes('buat jadwal') || t.includes('tambah jadwal')) return { intent: 'tambah_acara' };
  return { intent: 'fallback' };
}

// =============================================
// HELPER: Format event Google Calendar
// =============================================
function formatEvent(event) {
  let waktuMulai = event.start.date ? 'Seharian Penuh' : '';
  if (event.start.dateTime) {
    waktuMulai = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit'
    }).format(new Date(event.start.dateTime)) + ' WIB';
  }
  const judul = event.summary || 'Tanpa Judul';
  const lokasiEvent = event.location ? `\nLokasi: ${event.location}` : '';
  let deskripsi = '';
  if (event.description) {
    const descBersih = event.description.replace(/<br\s*[\/]?>/gi, '\n').replace(/<[^>]+>/g, '');
    deskripsi = `\nDeskripsi:\n${descBersih}`;
  }
  return `Acara: ${judul}\nWaktu: ${waktuMulai}${lokasiEvent}${deskripsi}`;
}

// =============================================
// HELPER: Ambil events dari semua kalender
// =============================================
async function fetchEvents(calendar, dateStr) {
  const awalHari = new Date(`${dateStr}T00:00:00+07:00`);
  const akhirHari = new Date(`${dateStr}T23:59:59+07:00`);
  const calendarIds = ['primary', process.env.CALENDAR_SIB_ID];
  let allEvents = [];

  for (const calId of calendarIds) {
    if (!calId) continue;
    try {
      const calRes = await calendar.events.list({
        calendarId: calId,
        timeMin: awalHari.toISOString(),
        timeMax: akhirHari.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
      allEvents = allEvents.concat(calRes.data.items || []);
    } catch (err) {
      console.error(`Gagal narik kalender ${calId}:`, err.message);
    }
  }

  allEvents.sort((a, b) =>
    new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date)
  );
  return allEvents;
}

// =============================================
// MAIN HANDLER
// =============================================
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('Hanya menerima POST');

  const message = req.body.message;
  if (!message || (!message.text && !message.location)) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;

  // === Tangani kiriman LOKASI (untuk cuaca) ===
  if (message.location) {
    try {
      const { latitude: lat, longitude: lon } = message.location;
      const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${lat},${lon}`);
      const weatherData = await weatherRes.json();
      await sendTelegramMsg(chatId,
        `📍 Laporan Cuaca\n\nLokasi: ${weatherData.location.name}\n🌤 Kondisi: ${weatherData.current.condition.text}\n🌡 Suhu: ${weatherData.current.temp_c}°C`
      );
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, 'Gagal mengambil data cuaca. Coba lagi ya!');
    }
    return res.status(200).send('OK');
  }

  const rawText = message.text || '';
  const today = getTodayWIB();

  // === Parse pesan dengan AI ===
  let parsed;
  try {
    parsed = await parseWithAI(rawText, today);
  } catch (err) {
    parsed = { intent: 'ai_error', errorMsg: err.message };
  }

  console.log('AI parsed:', JSON.stringify(parsed));

  // Jika AI gagal atau error, gunakan keyword fallback
  if (parsed.intent === 'ai_error') {
    console.log('AI failed, error:', parsed.errorMsg, '- switching to keyword fallback');
    // Kirim pesan debug sementara agar bisa diagnosa
    await sendTelegramMsg(chatId, `⚙️ [DEBUG] AI gagal: ${parsed.errorMsg}\nMenggunakan keyword fallback...`);
    parsed = parseWithKeyword(rawText, today);
  } else if (parsed.intent === 'fallback') {
    // Coba keyword dulu sebelum benar-benar fallback
    const kwParsed = parseWithKeyword(rawText, today);
    if (kwParsed.intent !== 'fallback') {
      parsed = kwParsed;
    }
  }

  console.log('Final intent:', parsed.intent);

  // =============================================
  // ROUTING BERDASARKAN INTENT
  // =============================================

  // --- CEK AGENDA HARI INI ---
  if (parsed.intent === 'cek_agenda_hari_ini') {
    try {
      const calendar = getCalendarClient();
      const events = await fetchEvents(calendar, today);
      const agenda = events.length > 0
        ? events.map(formatEvent).join('\n\n------------------------\n\n')
        : 'Tidak ada agenda hari ini, santai cuy! 🎉';

      const weatherRes = await fetch(`http://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=Bekasi`);
      const weatherData = await weatherRes.json();
      await sendTelegramMsg(chatId,
        `👋 Laporan Harian\n\n📍 Lokasi: ${weatherData.location.name}\n🌤 Kondisi: ${weatherData.current.condition.text}\n🌡 Suhu: ${weatherData.current.temp_c}°C\n\n📅 Agenda Hari Ini:\n${agenda}`
      );
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, `❌ Gagal cek agenda.\nError: ${err.message}`);
    }
    return res.status(200).send('OK');
  }

  // --- CEK AGENDA BESOK ---
  if (parsed.intent === 'cek_agenda_besok') {
    try {
      const calendar = getCalendarClient();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(tomorrow);

      const events = await fetchEvents(calendar, tomorrowStr);
      const agenda = events.length > 0
        ? events.map(formatEvent).join('\n\n------------------------\n\n')
        : 'Tidak ada agenda besok, kosong nih! 🎉';

      await sendTelegramMsg(chatId, `📅 Agenda Besok:\n\n${agenda}`);
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, `❌ Gagal cek agenda besok.\nError: ${err.message}`);
    }
    return res.status(200).send('OK');
  }

  // --- TAMBAH ACARA ---
  if (parsed.intent === 'tambah_acara') {
    const { judul, tanggal, jam, deskripsi } = parsed;
    if (!judul || !tanggal) {
      await sendTelegramMsg(chatId, '⚠️ Saya belum paham lengkap. Bisa sebutkan nama acara dan tanggalnya?');
      return res.status(200).send('OK');
    }
    try {
      const calendar = getCalendarClient();
      const nextDay = new Date(`${tanggal}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = nextDay.toISOString().split('T')[0];

      const reqBody = { summary: judul };
      if (jam) {
        reqBody.start = { dateTime: `${tanggal}T${jam}:00+07:00`, timeZone: 'Asia/Jakarta' };
        reqBody.end = { dateTime: `${tanggal}T${jam}:00+07:00`, timeZone: 'Asia/Jakarta' };
        // Default durasi 1 jam
        const endTime = new Date(`${tanggal}T${jam}:00+07:00`);
        endTime.setHours(endTime.getHours() + 1);
        reqBody.end.dateTime = endTime.toISOString();
      } else {
        reqBody.start = { date: tanggal };
        reqBody.end = { date: nextDayStr };
      }
      if (deskripsi) reqBody.description = deskripsi;

      await calendar.events.insert({ calendarId: 'primary', requestBody: reqBody });

      const [y, m, d] = tanggal.split('-');
      await sendTelegramMsg(chatId,
        `✅ Berhasil menambahkan jadwal!\n\nAcara: ${judul}\nTanggal: ${d}-${m}-${y}${jam ? `\nJam: ${jam} WIB` : ''}\nDeskripsi: ${deskripsi ? 'Ada ✓' : 'Tidak ada'}`
      );
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, `❌ Gagal menambahkan jadwal.\nError: ${err.message}`);
    }
    return res.status(200).send('OK');
  }

  // --- EDIT DESKRIPSI ---
  if (parsed.intent === 'edit_deskripsi') {
    // Jika AI tidak berhasil mengekstrak data, parse manual dari rawText
    let { judul, tanggal, deskripsi } = parsed;

    if (!judul || !deskripsi) {
      const lines = rawText.split('\n');
      const firstLine = lines[0];
      const restLines = lines.slice(1).join('\n').trim();

      // Ekstrak deskripsi dari baris ke-2 dst
      if (!deskripsi && restLines) deskripsi = restLines;

      // Ekstrak judul dari baris pertama (hapus kata perintah di depan)
      if (!judul) {
        judul = firstLine
          .replace(/edit deskripsi\s*/i, '')
          .replace(/untuk acara\s*/i, '')
          .replace(/untuk\s*/i, '')
          .replace(/acara\s*/i, '')
          .replace(/(\d{1,2})-(\d{1,2})-(\d{4})/, '') // hapus tanggal jika ada
          .trim();
      }

      // Ekstrak tanggal dari baris pertama jika belum ada
      if (!tanggal) {
        const dateMatch = firstLine.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
        if (dateMatch) {
          const d = dateMatch[1].padStart(2, '0');
          const m = dateMatch[2].padStart(2, '0');
          const y = dateMatch[3];
          tanggal = `${y}-${m}-${d}`;
        }
      }
    }

    if (!deskripsi) {
      await sendTelegramMsg(chatId,
        '⚠️ Saya tidak menemukan deskripsi barunya.\n\nFormat:\n"edit deskripsi [nama acara]\n[deskripsi barunya di sini...]"'
      );
      return res.status(200).send('OK');
    }

    try {
      const calendar = getCalendarClient();
      let target = null;

      if (tanggal) {
        const events = await fetchEvents(calendar, tanggal);
        target = events.find(ev => ev.summary?.toLowerCase().includes((judul || '').toLowerCase()));
      } else if (judul) {
        for (let i = 0; i <= 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const dateStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
          }).format(d);
          const events = await fetchEvents(calendar, dateStr);
          const found = events.find(ev => ev.summary?.toLowerCase().includes(judul.toLowerCase()));
          if (found) { target = found; break; }
        }
      }

      if (!target) {
        const hint = judul ? `"${judul}"` : 'yang dimaksud';
        await sendTelegramMsg(chatId,
          `❌ Acara ${hint} tidak ditemukan dalam 7 hari ke depan.\n\nCoba sebutkan tanggalnya juga, contoh:\n"edit deskripsi presentasi UJK 19-05-2026\ndeskripsi barunya..."`
        );
        return res.status(200).send('OK');
      }

      await calendar.events.patch({
        calendarId: 'primary',
        eventId: target.id,
        requestBody: { description: deskripsi }
      });
      await sendTelegramMsg(chatId, `✅ Deskripsi acara "${target.summary}" berhasil diperbarui!`);
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, `❌ Gagal edit deskripsi.\nError: ${err.message}`);
    }
    return res.status(200).send('OK');
  }



  // --- HAPUS ACARA ---
  if (parsed.intent === 'hapus_acara') {
    const { judul, tanggal } = parsed;
    if (!judul || !tanggal) {
      await sendTelegramMsg(chatId, '⚠️ Saya perlu tahu: nama acara dan tanggalnya untuk menghapus. Bisa sebutkan?');
      return res.status(200).send('OK');
    }
    try {
      const calendar = getCalendarClient();
      const events = await fetchEvents(calendar, tanggal);
      const target = events.find(ev => ev.summary?.toLowerCase().includes(judul.toLowerCase()));
      if (!target) {
        await sendTelegramMsg(chatId, `❌ Acara "${judul}" pada tanggal ${tanggal} tidak ditemukan.`);
        return res.status(200).send('OK');
      }
      await calendar.events.delete({ calendarId: 'primary', eventId: target.id });
      await sendTelegramMsg(chatId, `🗑️ Acara "${target.summary}" berhasil dihapus!`);
    } catch (err) {
      console.error(err);
      await sendTelegramMsg(chatId, `❌ Gagal menghapus acara.\nError: ${err.message}`);
    }
    return res.status(200).send('OK');
  }

  // --- CEK CUACA ---
  if (parsed.intent === 'cek_cuaca') {
    await sendTelegramMsg(chatId,
      'Silakan kirim lokasi Anda untuk mendapatkan informasi cuaca terkini! 🌤',
      {
        keyboard: [[{ text: '📍 Kirim Lokasi Saat Ini', request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    );
    return res.status(200).send('OK');
  }

  // --- FALLBACK ---
  await sendTelegramMsg(chatId,
    `Halo! Saya asisten bot kalender Anda. 😊\n\nSaya bisa:\n📅 Cek jadwal hari ini / besok\n➕ Tambah acara baru\n🗑️ Hapus acara\n✏️ Edit deskripsi acara\n🌤 Cek cuaca berdasarkan lokasi\n\nCukup bicara natural, contoh:\n"besok ada rapat jam 2 siang"\n"jadwal hari ini apa aja?"\n"hapus acara meeting tanggal 20 Mei"`
  );
  return res.status(200).send('OK');
}
// Unified release and commit
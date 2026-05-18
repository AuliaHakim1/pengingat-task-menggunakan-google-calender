import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end('Unauthorized');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Waktu sekarang
    const now = new Date();
    
    // Waktu 1 jam ke depan
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    const calendarIds = ['primary', process.env.CALENDAR_SIB_ID];
    let upcomingEvents = [];

    for (const calId of calendarIds) {
      if (!calId) continue;
      try {
        const calendarRes = await calendar.events.list({
          calendarId: calId,
          timeMin: now.toISOString(),
          timeMax: oneHourLater.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        });
        upcomingEvents = upcomingEvents.concat(calendarRes.data.items || []);
      } catch (err) {
        console.error(err);
      }
    }

    if (upcomingEvents.length > 0) {
      // Format pesan
      const agenda = upcomingEvents.map((event) => {
        let waktuMulai = '';
        if (event.start.dateTime) {
          waktuMulai = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start.dateTime)) + ' WIB';
        } else {
           // Kalau seharian penuh, skip aja reminder jam-jaman
           return null;
        }
        const judul = event.summary || 'Tanpa Judul';
        const lokasiEvent = event.location ? `\nLokasi: ${event.location}` : '';
        return `Acara: ${judul}\nWaktu: ${waktuMulai}${lokasiEvent}`;
      }).filter(Boolean).join('\n\n------------------------\n\n');

      if (agenda) {
        const textTelegram = `🚨 *REMINDER H-1 JAM*\nAda agenda yang akan segera dimulai:\n\n${agenda}`;

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: textTelegram,
            parse_mode: 'Markdown'
          }),
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Hourly cron success' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

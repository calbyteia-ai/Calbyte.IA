const nodemailer = require('nodemailer');

// Texto de una sola línea (nombre, correo, tipo)
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
// La descripción conserva los saltos de línea
const cleanText = (s, n) => String(s ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hits = new Map();

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Telegram respondió ${r.status}`);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (arr.length >= 5) return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
  hits.set(ip, [...arr, now]);

  const b = typeof req.body === 'object' && req.body ? req.body : {};
  if (b.web) return res.json({ ok: true }); // campo trampa anti-spam
  const d = {
    nombre: clean(b.nombre, 100),
    email: clean(b.email, 150),
    tipo: clean(b.tipo, 60),
    descripcion: cleanText(b.descripcion, 2000),
  };
  // El tipo ya no se valida contra una lista fija: así, si cambias las opciones del formulario, no se rompe el envío.
  if (d.nombre.length < 2 || !EMAIL.test(d.email) || d.tipo.length < 2 || d.descripcion.length < 20)
    return res.status(400).json({ error: 'Datos inválidos.' });

  const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_TO, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  const canMail = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
  const canTelegram = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
  if (!canMail && !canTelegram) return res.status(500).json({ error: 'Servicio no configurado.' });

  const tasks = [];
  if (canMail) {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
    tasks.push(t.sendMail({
      from: `"Web Calbyte.IA" <${GMAIL_USER}>`,
      to: MAIL_TO || GMAIL_USER,
      replyTo: `"${d.nombre.replace(/"/g, '')}" <${d.email}>`,
      subject: `Nueva cotización: ${d.tipo} - ${d.nombre}`,
      priority: 'high',
      text: `Nombre: ${d.nombre}\nCorreo: ${d.email}\nTipo: ${d.tipo}\nFecha: ${new Date().toISOString()}\n\nDescripción:\n${d.descripcion}`,
    }));
  }
  if (canTelegram) {
    tasks.push(sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
      `🔔 Nueva cotización\n\n${d.nombre}\n${d.email}\nServicio: ${d.tipo}\n\n${d.descripcion}`));
  }

  // Se esperan todos los envíos antes de responder (en Vercel la función se detiene al responder)
  const results = await Promise.allSettled(tasks);
  results.forEach(r => { if (r.status === 'rejected') console.error(r.reason?.message || r.reason); });
  if (results.some(r => r.status === 'fulfilled')) return res.json({ ok: true });
  return res.status(502).json({ error: 'No se pudo enviar la solicitud.' });
};

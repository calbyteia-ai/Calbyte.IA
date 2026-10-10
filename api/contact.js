const nodemailer = require('nodemailer');
const TIPOS = ['Excel / CSV','Limpieza de datos con Python','Informes automáticos','Bases de datos','Flujo con n8n / integración API','Bot para mi negocio','Otro'];
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const hits = new Map();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 15 * 60 * 1000);
  if (arr.length >= 5) return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta más tarde.' });
  hits.set(ip, [...arr, now]);

  const b = typeof req.body === 'object' && req.body ? req.body : {};
  if (b.web) return res.json({ ok: true });
  const d = { nombre: clean(b.nombre, 100), email: clean(b.email, 150), tipo: clean(b.tipo, 60), descripcion: clean(b.descripcion, 2000) };
  if (d.nombre.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email) || !TIPOS.includes(d.tipo) || d.descripcion.length < 20)
    return res.status(400).json({ error: 'Datos inválidos.' });

  const { GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return res.status(500).json({ error: 'Servicio no configurado.' });
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
    await t.sendMail({
      from: `"Web Calbyte.IA" <${GMAIL_USER}>`, to: MAIL_TO || GMAIL_USER,
      replyTo: `"${d.nombre.replace(/"/g, '')}" <${d.email}>`,
      subject: `Nueva cotización: ${d.tipo} - ${d.nombre}`,
      text: `Nombre: ${d.nombre}\nCorreo: ${d.email}\nTipo: ${d.tipo}\nFecha: ${new Date().toISOString()}\n\nDescripción:\n${d.descripcion}` });
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(502).json({ error: 'No se pudo enviar la solicitud.' }); }
};

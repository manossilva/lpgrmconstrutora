// api/capi.js — Meta Conversions API (integracao direta / server-side)
// Runtime: Vercel Serverless Function (Node.js)
//
// Variaveis de ambiente necessarias no painel da Vercel:
//   META_PIXEL_ID     -> 1024252233730344
//   META_CAPI_TOKEN   -> token de acesso gerado no Gerenciador de Eventos
//   META_TEST_EVENT   -> (opcional) codigo TESTxxxxx para a aba Eventos de teste

import crypto from 'crypto';

const API_VERSION = 'v21.0';

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

// A Meta exige SHA-256 de valores normalizados (minusculo, sem espacos/pontuacao).
const norm = {
  text: (v) => String(v || '').trim().toLowerCase(),
  email: (v) => String(v || '').trim().toLowerCase(),
  phone: (v) => String(v || '').replace(/\D/g, ''),
};

function hashIf(value) {
  return value ? sha256(value) : undefined;
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return undefined;
  const found = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return undefined;
  return String(fwd).split(',')[0].trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID;
  const TOKEN = process.env.META_CAPI_TOKEN;

  if (!PIXEL_ID || !TOKEN) {
    // Falha silenciosa: a landing page nunca deve quebrar por causa do tracking.
    return res.status(200).json({ skipped: 'missing_env' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const {
      event_name,
      event_id,
      event_source_url,
      action_source = 'website',
      user_data: ud = {},
      custom_data = {},
    } = body;

    if (!event_name || !event_id) {
      return res.status(400).json({ error: 'event_name_and_event_id_required' });
    }

    const cookies = req.headers.cookie;
    const nameParts = norm.text(ud.name).split(' ').filter(Boolean);

    const user_data = {
      em: hashIf(norm.email(ud.email)),
      ph: hashIf(norm.phone(ud.phone)),
      fn: hashIf(nameParts[0]),
      ln: hashIf(nameParts.slice(1).join(' ')),
      country: hashIf('br'),
      client_ip_address: clientIp(req),
      client_user_agent: req.headers['user-agent'],
      fbp: ud.fbp || readCookie(cookies, '_fbp'),
      fbc: ud.fbc || readCookie(cookies, '_fbc'),
    };

    Object.keys(user_data).forEach((k) => {
      if (user_data[k] === undefined || user_data[k] === '') delete user_data[k];
    });

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id, // mesmo ID usado no fbq -> deduplicacao com o Pixel
          event_source_url: event_source_url || req.headers.referer,
          action_source,
          user_data,
          custom_data,
        },
      ],
    };

    if (process.env.META_TEST_EVENT) {
      payload.test_event_code = process.env.META_TEST_EVENT;
    }

    const url =
      'https://graph.facebook.com/' + API_VERSION + '/' + PIXEL_ID + '/events';

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const out = await r.json();
    return res.status(r.ok ? 200 : 502).json(out);
  } catch (err) {
    return res.status(200).json({ error: 'capi_failed', detail: String(err && err.message) });
  }
}

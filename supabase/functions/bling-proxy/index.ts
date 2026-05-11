import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 });
  }

  const body = await req.text();
  const auth = req.headers.get('authorization');

  try {
    const res = await fetch('https://api.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; VortekProxy/1.0)',
        ...(auth ? { 'Authorization': auth } : {}),
      },
      body,
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ erro: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

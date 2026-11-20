// Cloudflare Pages Function: same-origin API proxy to the separately hosted JPTI Node API.
export async function onRequest(context) {
  const { request, env } = context;
  const configuredOrigin = String(env.JPTI_API_ORIGIN || '').trim();
  if (!configuredOrigin) {
    return Response.json({ error: 'JPTI_API_ORIGIN is not configured for this Pages deployment.' }, { status: 503 });
  }
  let origin;
  try { origin = new URL(configuredOrigin); }
  catch { return Response.json({ error: 'JPTI_API_ORIGIN must be a valid HTTPS origin.' }, { status: 500 }); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    return Response.json({ error: 'JPTI_API_ORIGIN must be an HTTPS origin without credentials, path, query or fragment.' }, { status: 500 });
  }
  const edgeSecret = String(env.JPTI_EDGE_SECRET || '');
  if (edgeSecret.length < 32) {
    return Response.json({ error: 'JPTI_EDGE_SECRET must be configured as a 32-character-or-longer Pages secret.' }, { status: 503 });
  }
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(request.headers);
  headers.set('x-jpti-edge-secret', edgeSecret);
  const forwarded = new Request(target.toString(), { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' });
  const response = await fetch(forwarded);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

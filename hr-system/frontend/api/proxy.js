/**
 * Same-origin API forwarder.
 *
 * The React app calls `${REACT_APP_API_URL}/...` with REACT_APP_API_URL=/api,
 * so requests stay on this origin and browsers never send a CORS preflight.
 * This sidesteps the intermittent OPTIONS 404 / CORS-block failures seen when
 * calling the backend's own *.vercel.app domain cross-origin (Vercel's
 * external-URL rewrites cannot target another *.vercel.app domain).
 */

const BACKEND = 'https://callcentral-hr-api.vercel.app';

// Hop-by-hop / proxy-injected headers that must not be forwarded upstream.
const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-forwarded-for',
  'x-vercel-id',
  'x-vercel-cache',
  'x-vercel-deployment-url',
  'x-vercel-forwarded-for',
  'x-vercel-forwarded-host',
  'x-vercel-forwarded-proto',
  'forwarded',
]);

// Response headers we must not copy back verbatim.
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
]);

module.exports = async (req, res) => {
  try {
    // Buffer the request body (login POSTs, PUTs, etc. are all small JSON).
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const hasBody = body.length > 0 && !['GET', 'HEAD'].includes(req.method);

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!SKIP_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    const upstream = await fetch(`${BACKEND}${req.url}`, {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
      redirect: 'manual',
    });

    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: 'API proxy error', error: err.message }));
  }
};

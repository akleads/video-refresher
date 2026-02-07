import crypto from 'node:crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(timestamp)
    .digest('hex');
  return Buffer.from(`${timestamp}:${hmac}`).toString('base64url');
}

export function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [timestamp, hmac] = decoded.split(':');
    if (!timestamp || !hmac) return false;

    // Check expiry
    if (Date.now() - parseInt(timestamp) > TOKEN_EXPIRY_MS) return false;

    // Timing-safe HMAC comparison
    const expected = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(timestamp)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    return false;
  }
}

export function checkPassword(input) {
  const expected = process.env.AUTH_PASSWORD;
  if (!expected || !input) return false;
  if (expected.length !== input.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(input, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

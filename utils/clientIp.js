function cleanIp(ip) {
  let s = String(ip || '').trim();
  if (!s) return '';
  // Remove IPv6-mapped IPv4 prefix.
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  return s;
}

export function getClientIpFromReq(req) {
  const xf = req?.headers?.['x-forwarded-for'];
  if (xf) {
    const first = String(Array.isArray(xf) ? xf[0] : xf)
      .split(',')[0]
      .trim();
    const cleaned = cleanIp(first);
    if (cleaned) return cleaned;
  }

  const real = req?.headers?.['x-real-ip'];
  if (real) {
    const cleaned = cleanIp(real);
    if (cleaned) return cleaned;
  }

  const direct = cleanIp(req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress);
  return direct || '';
}

export function getClientIpFromSocket(socket) {
  const xf = socket?.handshake?.headers?.['x-forwarded-for'];
  if (xf) {
    const first = String(Array.isArray(xf) ? xf[0] : xf)
      .split(',')[0]
      .trim();
    const cleaned = cleanIp(first);
    if (cleaned) return cleaned;
  }

  const real = socket?.handshake?.headers?.['x-real-ip'];
  if (real) {
    const cleaned = cleanIp(real);
    if (cleaned) return cleaned;
  }

  const direct = cleanIp(socket?.handshake?.address || socket?.conn?.remoteAddress || socket?.request?.socket?.remoteAddress);
  return direct || '';
}

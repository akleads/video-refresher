/**
 * Configure security headers for COEP compatibility.
 * Sets Cross-Origin-Resource-Policy: cross-origin so frontend
 * with COEP: require-corp can fetch from this API.
 */
export function securityHeaders() {
  return function(req, res, next) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  };
}

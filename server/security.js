// Seguridad base sin dependencias nuevas:
// - securityHeaders: cabeceras mínimas anti MIME-sniffing/clickjacking.
// - rateLimit: contador in-memory por IP para métodos que escriben
//   (POST/PUT/DELETE) — frena spam de pedidos y escrituras.
//   Las apps son single-process con SQLite local: un Map alcanza; un
//   multi-instance necesitaría store compartido (fuera de scope).

export function securityHeaders(req, res, next) {
  // nosniff: el browser no adivina el tipo real del recurso —
  // un .js/.json servido no se reinterpreta como otra cosa.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // clickjacking: la página no puede embeberse en un iframe ajeno.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

// Limita solo escrituras: los GET de lectura quedan libres — un
// cliente legítimo no debería poder ahogar la API mandando POSTs.
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map(); // ip → timestamps recientes
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    // Evicción lazy: entradas vencidas fuera; si el Map crece demasiado
    // (flood desde muchas IPs), purga las ya expiradas — acotado a
    // single-process, no hacen falta timers.
    if (hits.size > 5000) {
      for (const [k, ts] of hits) {
        if (!ts.length || now - ts[ts.length - 1] > windowMs) hits.delete(k);
      }
    }
    if (list.length >= max) {
      hits.set(key, list);
      // Retry-After: segundos hasta que expire el hit más viejo —
      // el harness (crear-orden en ráfaga) lo usa para el backoff.
      const retryAfter = Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000));
      return res
        .status(429)
        .set('Retry-After', retryAfter)
        .json({ error: 'demasiadas solicitudes — probá de nuevo en unos segundos' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

// Helper de validación: corta strings absurdamente largos antes de
// persistirlos (el límite JSON de 2mb no alcanza para campos libres).
export const capString = (v, max) =>
  typeof v === 'string' && v.length > max ? v.slice(0, max) : v;

/** Express 4 não captura rejeições de handlers async; este wrapper repassa ao next(). */
export const assincrono = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

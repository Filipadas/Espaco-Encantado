function getReturnTo(req) {
  var referer = req.get('referer');
  if (!referer) return '/';
  try {
    var url = new URL(referer);
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch (error) {}
  return '/';
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/entrar?returnTo=' + encodeURIComponent(getReturnTo(req)));
  next();
}

function requireAdmin(req, res, next) {
  var acceptHeader = req.get('Accept') || '';
  var wantsJson = /(^|,)\s*application\/json(?:\s*;|\s*(?:,|$))/i.test(acceptHeader);
  if (!req.session.user) {
    if (wantsJson) return res.status(401).json({ ok: false, message: 'Sua sessão de administrador expirou. Entre novamente para continuar.' });
    return res.redirect('/entrar?returnTo=' + encodeURIComponent(req.originalUrl || '/admin'));
  }
  if (req.session.user.role !== 'admin') {
    if (wantsJson) return res.status(403).json({ ok: false, message: 'Esta área é exclusiva para administradores.' });
    return res.status(403).render('erro', {
      title: 'Acesso negado',
      message: 'Esta área é exclusiva para administradores.',
      error: {},
      status: 403
    });
  }
  next();
}

module.exports = { requireLogin: requireLogin, requireAdmin: requireAdmin };

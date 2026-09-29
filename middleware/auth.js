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
  if (!req.session.user) return res.redirect('/login?returnTo=' + encodeURIComponent(getReturnTo(req)));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Acesso negado',
      message: 'Esta área é exclusiva para administradores.',
      error: {},
      status: 403
    });
  }
  next();
}

module.exports = { requireLogin: requireLogin, requireAdmin: requireAdmin };

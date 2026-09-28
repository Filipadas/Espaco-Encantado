function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
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

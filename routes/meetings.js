var express = require('express');
var Meeting = require('../models/Meeting');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();

router.post('/', requireLogin, async function(req, res, next) {
  try {
    if (req.session.user.role === 'admin') return res.status(403).render('error', { title: 'Acesso negado', message: 'Administradores não podem solicitar reuniões.', error: {}, status: 403 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.date) || !/^\d{2}:\d{2}$/.test(req.body.time)) {
      return res.redirect('/?reuniao=erro');
    }
    await Meeting.create({ user: req.session.user.id, date: req.body.date, time: req.body.time });
    res.redirect('/?reuniao=solicitada');
  } catch (error) { next(error); }
});

module.exports = router;

var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var uploadImagem = require('../utils/uploadImagem');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();

function uploadProfileImage(req, res, next) {
  uploadImagem.upload.single('profileImage')(req, res, function(error) {
    if (!error) return next();
    var message = error.code === 'LIMIT_FILE_SIZE' ? 'A foto deve ter no máximo 5 MB.' : (error.message || 'Não foi possível enviar a foto.');
    User.findById(req.session.user.id).then(function(profile) {
      res.status(400).render('usuarios-perfil', { title: 'Editar meu perfil', profile: profile, formError: message });
    }).catch(next);
  });
}

/* GET users listing. */
router.get('/', requireLogin, function(req, res) {
  res.redirect('/usuarios/perfil');
});

router.get('/perfil', requireLogin, async function(req, res, next) {
  try {
    res.render('usuarios-perfil', { title: 'Editar meu perfil', profile: await User.findById(req.session.user.id), formError: null });
  } catch (error) { next(error); }
});

router.post('/perfil', requireLogin, uploadProfileImage, async function(req, res, next) {
  try {
    function values(value) { return Array.isArray(value) ? value : (value === undefined ? [] : [value]); }
    var labels = values(req.body.addressLabel);
    var addressValues = values(req.body.addressValue);
    var cities = values(req.body.addressCity);
    var states = values(req.body.addressState);
    var ceps = values(req.body.addressCep);
    var addresses = labels.map(function(label, index) {
      return {
        label: String(label || '').trim(),
        address: String(addressValues[index] || '').trim(),
        city: String(cities[index] || '').trim(),
        state: String(states[index] || '').trim().toUpperCase(),
        cep: String(ceps[index] || '').trim()
      };
    }).filter(function(address) { return address.label || address.address || address.city || address.state || address.cep; });
    var data = { name: req.body.name, phone: req.body.phone, address: req.body.address, city: req.body.city, state: req.body.state, cep: req.body.cep, addresses: addresses };
    if (req.file) {
      try {
        data.profileImage = await uploadImagem(req.file, 'avatares');
      } catch (uploadError) {
        return res.status(400).render('usuarios-perfil', { title: 'Editar meu perfil', profile: await User.findById(req.session.user.id), formError: uploadError.message || 'Não foi possível enviar a foto.' });
      }
    }
    var user = await User.findByIdAndUpdate(req.session.user.id, data, { new: true, runValidators: true });
    req.session.user.name = user.name;
    req.session.user.profileImage = user.profileImage;
    res.redirect('/perfil');
  } catch (error) { next(error); }
});

router.get('/excluir', requireLogin, function(req, res) {
  res.render('usuarios-excluir', { title: 'Excluir conta', formError: null });
});

router.post('/excluir', requireLogin, async function(req, res, next) {
  try {
    var user = await User.findById(req.session.user.id);
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password)) return res.status(400).render('usuarios-excluir', { title: 'Excluir conta', formError: 'Senha incorreta.' });
    if (user.role === 'admin' && await User.countDocuments({ role: 'admin' }) < 2) return res.status(400).render('usuarios-excluir', { title: 'Excluir conta', formError: 'Transfira a função de administrador para outra conta antes de excluir esta conta.' });
    await User.findByIdAndDelete(user._id);
    req.session.destroy(function(error) { if (error) return next(error); res.redirect('/'); });
  } catch (error) { next(error); }
});

module.exports = router;

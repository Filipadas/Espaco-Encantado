var express = require('express');
var bcrypt = require('bcryptjs');
var multer = require('multer');
var path = require('path');
var User = require('../models/User');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();
var upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: function(req, file, callback) {
      callback(null, 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
    }
  })
});

/* GET users listing. */
router.get('/', requireLogin, function(req, res) {
  res.redirect('/users/profile');
});

router.get('/profile', requireLogin, async function(req, res, next) {
  try {
    res.render('profile-edit', { title: 'Editar meu perfil', profile: await User.findById(req.session.user.id), formError: null });
  } catch (error) { next(error); }
});

router.post('/profile', requireLogin, upload.single('profileImage'), async function(req, res, next) {
  try {
    var addresses = Array.isArray(req.body.addressLabel) ? req.body.addressLabel.map(function(label, index) {
      return { label: label, address: req.body.addressValue[index], city: req.body.addressCity[index], state: req.body.addressState[index] };
    }) : [];
    var data = { name: req.body.name, phone: req.body.phone, address: req.body.address, city: req.body.city, state: req.body.state, addresses: addresses };
    if (req.file) data.profileImage = '/uploads/' + req.file.filename;
    var user = await User.findByIdAndUpdate(req.session.user.id, data, { new: true, runValidators: true });
    req.session.user.name = user.name;
    req.session.user.profileImage = user.profileImage;
    res.redirect('/perfil');
  } catch (error) { next(error); }
});

router.get('/delete', requireLogin, function(req, res) {
  res.render('delete-account', { title: 'Excluir conta', formError: null });
});

router.post('/delete', requireLogin, async function(req, res, next) {
  try {
    var user = await User.findById(req.session.user.id);
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password)) return res.status(400).render('delete-account', { title: 'Excluir conta', formError: 'Senha incorreta.' });
    if (user.role === 'admin' && await User.countDocuments({ role: 'admin' }) < 2) return res.status(400).render('delete-account', { title: 'Excluir conta', formError: 'Transfira a função de administrador para outra conta antes de excluir esta conta.' });
    await User.findByIdAndDelete(user._id);
    req.session.destroy(function(error) { if (error) return next(error); res.redirect('/'); });
  } catch (error) { next(error); }
});

module.exports = router;

var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var upload = require('../middleware/uploads');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});

router.post('/profile', requireLogin, upload.single('image'), async function(req, res, next) {
  try {
    var data = {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state
    };
    if (req.file) data.imageUrl = '/uploads/' + req.file.filename;
    if (req.body.password) data.password = bcrypt.hashSync(String(req.body.password), 10);
    var user = await User.findByIdAndUpdate(req.session.user.id, data, { new: true, runValidators: true });
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
    res.redirect('/perfil?atualizado=1');
  } catch (error) { next(error); }
});

module.exports = router;

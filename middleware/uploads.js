var multer = require('multer');
var path = require('path');
var fs = require('fs');

var uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

var storage = multer.diskStorage({
  destination: uploadDirectory,
  filename: function(req, file, callback) {
    var extension = path.extname(file.originalname).toLowerCase();
    callback(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + extension);
  }
});

function imageOnly(req, file, callback) {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return callback(null, true);
  callback(new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.'));
}

module.exports = multer({ storage: storage, fileFilter: imageOnly, limits: { fileSize: 5 * 1024 * 1024 } });

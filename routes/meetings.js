var express = require('express');
var Meeting = require('../models/Meeting');
var User = require('../models/User');
var SiteSettings = require('../models/SiteSettings');
var meetingHoursConfig = require('../utils/meeting-hours');
var meetingHistoryUtils = require('../utils/meeting-history');
var business = require('../config/business');
var { requireLogin, requireAdmin } = require('../middleware/auth');
var router = express.Router();

function isValidDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function isFutureSlot(date, time) {
  return new Date(date + 'T' + time).getTime() > Date.now();
}

async function getConfiguredMeetingHours() {
  var settings = await SiteSettings.findOne({ key: 'main' }).select('meetingHours');
  return meetingHoursConfig.getMeetingHours(settings && settings.meetingHours);
}

function validSlot(date, time, hours) {
  return isValidDate(date) && meetingHoursConfig.isValidTime(time) && hours.indexOf(time) !== -1 && isFutureSlot(date, time);
}

router.get('/minhas', requireLogin, async function(req, res, next) {
  try {
    var allMeetings = await Meeting.find({ user: req.session.user.id }).sort({ date: 1, time: 1, createdAt: -1 });
    var now = new Date();
    var meetings = allMeetings.filter(function(meeting) { return !meetingHistoryUtils.isHistorical(meeting, now); });
    var meetingHistory = allMeetings.filter(function(meeting) { return meetingHistoryUtils.isHistorical(meeting, now); }).sort(function(a, b) {
      return (b.date + 'T' + b.time).localeCompare(a.date + 'T' + a.time);
    });
    res.render('reunioes-minhas', { title: 'Minhas reuniões', meetings: meetings, meetingHistory: meetingHistory });
  } catch (error) { next(error); }
});

router.post('/', requireLogin, async function(req, res, next) {
  try {
    var user = await User.findById(req.session.user.id).select('name email phone role');
    if (user && user.role === 'admin') return res.redirect('/?reuniao=admin#agenda');
    var hours = await getConfiguredMeetingHours();
    var date = String(req.body.date || '');
    var time = String(req.body.time || '');
    if (!validSlot(date, time, hours)) return res.redirect('/?reuniao=erro#agenda');
    if (await Meeting.exists({ date: date, time: time, status: { $ne: 'cancelled' } })) return res.redirect('/?reuniao=ocupado#agenda');
    await Meeting.create({ user: req.session.user.id, date: date, time: time, status: 'requested' });
    var formattedDate = date.split('-').reverse().join('/');
    var message = [
      'Olá! Meu nome é ' + (user.name || 'cliente') + ' e gostaria de solicitar uma reunião.',
      'Data desejada: ' + formattedDate,
      'Horário desejado: ' + time,
      user.email ? 'E-mail: ' + user.email : null,
      user.phone ? 'Telefone: ' + user.phone : null,
      'A solicitação foi enviada pelo site e aguarda confirmação.'
    ].filter(Boolean).join('\n');
    res.redirect('https://wa.me/' + business.whatsappNumber + '?text=' + encodeURIComponent(message));
  } catch (error) { next(error); }
});

router.post('/bloquear', requireAdmin, async function(req, res, next) {
  try {
    var hours = await getConfiguredMeetingHours();
    var date = String(req.body.date || '');
    var submittedTimes = Array.isArray(req.body.times) ? req.body.times : (req.body.times ? [req.body.times] : []);
    if (!submittedTimes.length && req.body.time) submittedTimes.push(req.body.time);
    var times = Array.from(new Set(submittedTimes.map(function(time) { return String(time || ''); })));
    if (!isValidDate(date) || !times.length || times.some(function(time) { return !validSlot(date, time, hours); })) return res.redirect('/?reuniao=erro#agenda');
    if (await Meeting.exists({ date: date, time: { $in: times }, status: { $ne: 'cancelled' } })) return res.redirect('/?reuniao=ocupado#agenda');
    await Meeting.insertMany(times.map(function(time) { return { user: req.session.user.id, date: date, time: time, status: 'unavailable' }; }));
    res.redirect('/?reuniao=bloqueado#agenda');
  } catch (error) { next(error); }
});

router.post('/desbloquear', requireAdmin, async function(req, res, next) {
  try {
    var date = String(req.body.date || '');
    var time = String(req.body.time || '');
    if (!isValidDate(date) || !meetingHoursConfig.isValidTime(time)) return res.redirect('/?reuniao=erro#agenda');
    var deleted = await Meeting.findOneAndDelete({ date: date, time: time, status: 'unavailable' });
    res.redirect('/?reuniao=' + (deleted ? 'liberado' : 'erro') + '#agenda');
  } catch (error) { next(error); }
});

module.exports = router;

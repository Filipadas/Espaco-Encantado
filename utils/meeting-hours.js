var DEFAULT_MEETING_HOURS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

function getMeetingHours(rawHours) {
  var hours = String(rawHours || '').split(',').map(function(value) { return value.trim(); }).filter(function(value, index, allValues) {
    return isValidTime(value) && allValues.indexOf(value) === index;
  });
  return hours.length ? hours : DEFAULT_MEETING_HOURS.slice();
}

module.exports = { getMeetingHours: getMeetingHours, isValidTime: isValidTime };

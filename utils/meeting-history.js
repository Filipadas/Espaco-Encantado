function hasPassed(meeting, now) {
  var scheduledAt = new Date(String(meeting.date || '') + 'T' + String(meeting.time || ''));
  return Number.isFinite(scheduledAt.getTime()) && scheduledAt.getTime() < now.getTime();
}

function isHistorical(meeting, now) {
  return meeting.status === 'cancelled' || hasPassed(meeting, now);
}

module.exports = { isHistorical: isHistorical };

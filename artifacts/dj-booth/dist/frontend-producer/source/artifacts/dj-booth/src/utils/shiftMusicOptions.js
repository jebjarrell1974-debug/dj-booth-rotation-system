const DEFAULT_START = '12:00';
const DEFAULT_END = '20:00';

function minutes(time, fallback) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
  if (!match) return minutes(fallback, fallback);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isDayShiftActive(dayShift, now = new Date()) {
  if (!dayShift?.enabled) return false;
  // Use the same defaults displayed in Options, including legacy configurations
  // that saved folder selections but omitted their start/end times.
  const start = minutes(dayShift.startTime, DEFAULT_START);
  const end = minutes(dayShift.endTime, DEFAULT_END);
  const current = now.getHours() * 60 + now.getMinutes();
  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function getActiveMusicGenres(options, now = new Date()) {
  const genres = isDayShiftActive(options?.dayShift, now)
    ? options.dayShift.genres
    : options?.activeGenres;
  // No selections means ALL for that shift, never inherit the other shift.
  return Array.isArray(genres) ? genres.filter(genre => typeof genre === 'string') : [];
}

export function filterTracksForActiveShift(tracks, options, now = new Date()) {
  const genres = getActiveMusicGenres(options, now);
  return genres.length ? tracks.filter(track => genres.includes(track?.genre)) : tracks;
}

export function filterAutomaticBreakSongs(names, options, tracks, manual, now = new Date()) {
  if (manual || !getActiveMusicGenres(options, now).length) return names;
  const allowedNames = new Set(filterTracksForActiveShift(tracks, options, now).map(track => track.name));
  // A prefilled automatic break from the previous shift must not bypass today's
  // pool. Unknown names are reselected by the server; explicit DJ queues stay put.
  return names.filter(name => allowedNames.has(name));
}

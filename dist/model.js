(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const initial = () => ({
    version: 1,
    config: {
      origin: 'Home, Abuja', destination: 'Impact Hub, Abuja', duration: 5, clockMode: 'simulation', transport: 'car',
      items: ['Phone', 'Power bank', 'Earbuds', 'Head warmer'],
      transit: { message: 'Message the meetup organiser', reason: 'Let them know I am on my way.', at: 2 },
      end: { message: 'Check the back seat', reason: 'My power bank and head warmer could be left there.' },
      saveParking: true, parkingNote: 'Front entrance · space B12'
    },
    ride: { stage: 'ready', elapsed: 0, events: [] }, parking: null
  });
  const event = (s, message) => { s.ride.events.unshift({ minute: s.ride.elapsed, message }); s.ride.events = s.ride.events.slice(0, 15); };
  const deliver = s => {
    const elapsedMinutes = s.ride.clockMode === 'real' ? (s.ride.clockAt - s.ride.startedAt) / 60000 : s.ride.elapsed;
    if (s.ride.transit?.status === 'scheduled' && elapsedMinutes >= s.ride.transit.at) {
      s.ride.transit.status = 'due';
      event(s, 'In-transit reminder delivered');
    }
    if (s.ride.preArrival?.status === 'scheduled' && remainingSeconds(s.ride) <= 120) {
      s.ride.preArrival.status = 'due';
      s.ride.preArrival.deliveredAt = s.ride.elapsed;
      event(s, s.ride.clockMode === 'real' && remainingSeconds(s.ride) < 115 ? 'Belongings alert delivered · recovered after timer delay' : 'Belongings alert delivered · 2 minutes before estimated arrival');
    }
  };
  function remainingSeconds(r) {
    return r.clockMode === 'real' ? Math.max(0, Math.ceil((r.etaAt - r.clockAt) / 1000)) : Math.max(0, (r.duration - r.elapsed) * 60);
  }
  function startRide(s, data = {}) {
    const r = s.ride;
    r.stage = 'inTransit';
    r.origin = s.config.origin; r.destination = s.config.destination;
    r.duration = Math.max(2, Math.min(999, Number(s.config.duration) || 5));
    r.clockMode = s.config.clockMode === 'real' ? 'real' : 'simulation';
    r.transport = s.config.transport === 'passenger' ? 'passenger' : 'car';
    r.startedAt = Number(data.nowMs) || Date.now(); r.clockAt = r.startedAt;
    r.id = String(r.startedAt);
    r.etaAt = r.startedAt + r.duration * 60000; r.etaReached = false;
    r.preArrival = { status: 'scheduled', deliveredAt: null, revision: 0 };
    r.transit = { ...clone(s.config.transit), status: 'scheduled' };
    r.end = { ...clone(s.config.end), done: false };
    r.items = s.config.items.map((name, index) => ({ id: index, name, checked: false }));
    r.saveParking = s.config.saveParking && r.transport === 'car'; r.parkingNote = s.config.parkingNote;
    event(s, r.clockMode === 'real' ? 'Ride started manually · estimated arrival set' : 'Ride started automatically');
    deliver(s);
  }
  function finishArrival(s, data = {}) {
    const r = s.ride;
    r.stage = 'arrived';
    if (r.transit.status === 'scheduled') { r.transit.status = 'missed'; event(s, 'Ride ended before the in-transit reminder was due'); }
    if (r.preArrival.status === 'scheduled') r.preArrival.status = 'missed';
    if (r.preArrival.status === 'due') r.preArrival.status = 'closed';
    r.arrivedAt = data.now || new Date().toISOString();
    event(s, 'Arrival detected · belongings and ride-end reminder delivered');
    if (r.saveParking) {
      s.parking = { location: r.destination, note: r.parkingNote, savedAt: r.arrivedAt, source: r.clockMode === 'real' ? 'note' : 'simulation' };
      event(s, 'Parking location saved');
    }
  }
  function transition(state, action, data = {}) {
    const s = clone(state), r = s.ride;
    switch (action) {
      case 'configure': {
        const c = data.config;
        if (c) s.config = clone(c);
        if (r.stage === 'inTransit' && data.updateTransit) {
          r.transit = { ...clone(s.config.transit), status: 'scheduled' };
          event(s, 'In-transit reminder updated'); deliver(s);
        }
        break;
      }
      case 'depart':
        if (r.stage !== 'ready') break;
        s.ride = { stage: 'detecting', elapsed: 0, events: [] };
        if (s.config.clockMode === 'real') startRide(s, data);
        else event(s, 'Simulated movement detected');
        break;
      case 'detect':
        if (r.stage !== 'detecting') break;
        startRide(s, data); break;
      case 'advance':
        if (r.stage !== 'inTransit' || r.clockMode === 'real') break;
        r.elapsed = Math.min(r.elapsed + 1, r.duration); deliver(s);
        if (r.elapsed >= r.duration) finishArrival(s, data);
        break;
      case 'nearArrival':
        if (r.stage !== 'inTransit' || r.clockMode === 'real' || r.elapsed >= r.duration - 2) break;
        r.elapsed = r.duration - 2; deliver(s); break;
      case 'tick':
        if (r.stage !== 'inTransit' || r.clockMode !== 'real') break;
        r.clockAt = Math.max(r.clockAt, Number(data.nowMs) || Date.now());
        r.elapsed = Math.floor((r.clockAt - r.startedAt) / 60000);
        deliver(s);
        if (remainingSeconds(r) === 0 && !r.etaReached) {
          r.etaReached = true; event(s, 'Estimated arrival reached · waiting for your confirmation');
        }
        break;
      case 'updateEta': {
        if (r.stage !== 'inTransit') break;
        const minutes = Number(data.minutes);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 999) break;
        if (r.clockMode === 'real') {
          r.clockAt = Math.max(r.clockAt, Number(data.nowMs) || Date.now());
          r.elapsed = Math.floor((r.clockAt - r.startedAt) / 60000);
          r.etaAt = r.clockAt + minutes * 60000;
          r.duration = (r.etaAt - r.startedAt) / 60000;
        } else r.duration = r.elapsed + minutes;
        r.etaReached = false;
        if (minutes > 2) r.preArrival = { status: 'scheduled', deliveredAt: null, revision: (r.preArrival.revision || 0) + 1 };
        event(s, 'Arrival estimate updated · ' + minutes + ' minutes remaining'); deliver(s);
        break;
      }
      case 'ackPreArrival':
        if (r.stage !== 'inTransit' || r.preArrival.status !== 'due') break;
        r.preArrival.status = 'done'; event(s, 'Pre-arrival belongings alert acknowledged'); break;
      case 'ackTransit':
        if (r.transit?.status !== 'due') break;
        r.transit.status = 'done'; event(s, 'In-transit reminder marked done'); break;
      case 'snooze':
        if (r.stage !== 'inTransit' || r.transit?.status !== 'due') break;
        r.transit.at = r.clockMode === 'real' ? (r.clockAt - r.startedAt) / 60000 + 1 : r.elapsed + 1; r.transit.status = 'scheduled';
        event(s, 'In-transit reminder snoozed for 1 minute'); break;
      case 'arrive':
        if (r.stage !== 'inTransit') break;
        finishArrival(s, data);
        break;
      case 'collect':
        if (r.stage !== 'arrived') break;
        r.items = r.items.map(item => item.id === Number(data.id) ? { ...item, checked: !item.checked } : item);
        break;
      case 'ackEnd':
        if (r.stage !== 'arrived' || r.end.done) break;
        r.end.done = true; event(s, 'Ride-end reminder marked done'); break;
      case 'newRide':
        if (r.stage !== 'arrived') break;
        if (!r.end.done || !r.items.every(item => item.checked) || r.transit.status === 'due') break;
        s.ride = { stage: 'ready', elapsed: 0, events: [] }; break;
      case 'cancelDetection':
        if (r.stage === 'detecting') s.ride = { stage: 'ready', elapsed: 0, events: [] };
        break;
      case 'saveParking':
        if (data.location?.trim()) {
          const location = data.location.trim().slice(0, 100);
          const previous = s.parking?.location === location ? s.parking : null;
          s.parking = { location, note: (data.note || '').trim().slice(0, 160), savedAt: data.now || new Date().toISOString(), source: previous?.source || 'note', ...(previous?.coords ? { coords: previous.coords } : {}) };
        }
        break;
      case 'captureParking': {
        const c = data.coords;
        if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) break;
        s.parking = { location: String(data.location || 'My parking spot').slice(0, 100), note: String(data.note || '').slice(0, 160), savedAt: data.now || new Date().toISOString(), source: 'gps', coords: { lat: c.lat, lng: c.lng, accuracy: Math.max(0, Number(c.accuracy) || 0) } };
        break;
      }
    }
    return s;
  }
  function restore(raw) {
    try {
      const s = JSON.parse(raw);
      if (s.version !== 1 || !s.config || !s.ride || !['ready', 'detecting', 'inTransit', 'arrived'].includes(s.ride.stage)) return initial();
      if (typeof s.config.origin !== 'string' || typeof s.config.destination !== 'string' || !Array.isArray(s.config.items) || !s.config.items.every(i => typeof i === 'string') || !s.config.transit || !s.config.end) return initial();
      if (['inTransit', 'arrived'].includes(s.ride.stage) && (!s.ride.transit || !s.ride.end || !Array.isArray(s.ride.items))) return initial();
      s.config.duration = Math.max(2, Math.min(999, Number(s.config.duration) || 5));
      s.config.clockMode = s.config.clockMode === 'real' ? 'real' : 'simulation';
      s.config.transport = s.config.transport === 'passenger' ? 'passenger' : 'car';
      if (['inTransit', 'arrived'].includes(s.ride.stage)) {
        s.ride.duration = Number(s.ride.duration) || Math.max(s.config.duration, s.ride.elapsed + 2);
        s.ride.clockMode = s.ride.clockMode === 'real' && Number.isFinite(s.ride.etaAt) && Number.isFinite(s.ride.startedAt) ? 'real' : 'simulation';
        s.ride.transport ||= 'car';
        s.ride.preArrival ||= { status: s.ride.stage === 'arrived' ? 'missed' : 'scheduled', deliveredAt: null, revision: 0 };
        if (s.ride.stage === 'inTransit' && s.ride.clockMode !== 'real') deliver(s);
      }
      return s;
    } catch { return initial(); }
  }
  const api = { initial, transition, restore, remainingSeconds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BoothyModel = api;
})(typeof window === 'object' ? window : globalThis);

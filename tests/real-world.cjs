const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../dist/model.js');
const START = Date.parse('2026-10-14T14:00:00Z');
const step = (s, action, data = {}) => M.transition(s, action, { nowMs: START, ...data });
function realRide(transport = 'car') {
  const s = M.initial(); s.config.clockMode = 'real'; s.config.transport = transport;
  return step(s, 'depart');
}

test('real rides start manually and alert at the two-minute boundary, not earlier', () => {
  let s = realRide(); assert.equal(s.ride.stage, 'inTransit');
  assert.equal(M.remainingSeconds(s.ride), 300);
  s = step(s, 'tick', { nowMs: START + 179999 });
  assert.equal(s.ride.preArrival.status, 'scheduled');
  s = step(s, 'tick', { nowMs: START + 180000 });
  assert.equal(M.remainingSeconds(s.ride), 120);
  assert.equal(s.ride.preArrival.status, 'due');
  assert.equal(s.ride.end.reason, s.config.end.reason);
  assert.equal(s.ride.end.done, false);
});

test('timer resume catches up but never assumes actual arrival or parks a moving vehicle', () => {
  let s = realRide(); const parked = { location: 'Old parking', note: 'Garage' }; s.parking = parked;
  s = M.restore(JSON.stringify(s));
  s = step(s, 'tick', { nowMs: START + 400000 });
  assert.equal(s.ride.stage, 'inTransit'); assert.equal(s.ride.etaReached, true);
  assert.equal(M.remainingSeconds(s.ride), 0); assert.deepEqual(s.parking, parked);
  assert.equal(s.ride.preArrival.status, 'due');
  assert.ok(s.ride.events.some(e => e.message.includes('recovered after timer delay')));
  s = step(s, 'arrive'); assert.equal(s.ride.stage, 'arrived');
  assert.equal(s.parking.location, s.config.destination); assert.equal(s.parking.source, 'note');
});

test('ETA corrections re-arm the warning and do not repeat handled alerts on each tick', () => {
  let s = realRide(); s = step(s, 'tick', { nowMs: START + 180000 }); s = step(s, 'ackPreArrival');
  s = step(s, 'updateEta', { nowMs: START + 180000, minutes: 6 });
  assert.equal(M.remainingSeconds(s.ride), 360); assert.equal(s.ride.preArrival.status, 'scheduled');
  assert.equal(s.ride.preArrival.revision, 1);
  s = step(s, 'tick', { nowMs: START + 419999 }); assert.equal(s.ride.preArrival.status, 'scheduled');
  s = step(s, 'tick', { nowMs: START + 420000 }); assert.equal(s.ride.preArrival.status, 'due');
  s = step(s, 'ackPreArrival'); s = step(s, 'tick', { nowMs: START + 421000 });
  assert.equal(s.ride.preArrival.status, 'done');
  assert.equal(s.ride.events.filter(e => e.message.includes('Belongings alert delivered')).length, 2);
});

test('real reminder snoozes for a full minute from the exact moment it is snoozed', () => {
  let s = realRide(); s = step(s, 'tick', { nowMs: START + 130000 });
  assert.equal(s.ride.transit.status, 'due');
  s = step(s, 'snooze');
  s = step(s, 'tick', { nowMs: START + 189999 }); assert.equal(s.ride.transit.status, 'scheduled');
  s = step(s, 'tick', { nowMs: START + 190000 }); assert.equal(s.ride.transit.status, 'due');
});

test('passenger rides do not overwrite GPS parking; same-location note edits retain coordinates', () => {
  let s = realRide('passenger');
  s = step(s, 'captureParking', { location: 'My car', note: 'Bay 8', coords: { lat: 9.08, lng: 7.49, accuracy: 12 } });
  const parked = s.parking; s = step(s, 'arrive'); assert.deepEqual(s.parking, parked);
  s = step(s, 'saveParking', { location: 'My car', note: 'Bay 8, near gate' });
  assert.deepEqual(s.parking.coords, parked.coords);
  s = step(s, 'saveParking', { location: 'A different place', note: 'North entrance' });
  assert.equal(s.parking.coords, undefined); assert.equal(s.parking.source, 'note');
});

test('invalid GPS and ETA inputs keep the previous state', () => {
  const s = realRide();
  assert.deepEqual(step(s, 'captureParking', { coords: { lat: 190, lng: 7 } }), s);
  assert.deepEqual(step(s, 'updateEta', { minutes: -3 }), s);
  assert.deepEqual(step(s, 'advance'), s);
  assert.deepEqual(step(s, 'nearArrival'), s);
});

function device({ permission = 'default', supported = true, gpsError = null, workerError = false } = {}) {
  const stored = new Map(), shown = [], events = []; let requests = 0;
  const Notification = supported ? function (title, options) { shown.push({ title, options }); } : undefined;
  if (Notification) { Notification.permission = permission; Notification.requestPermission = async () => { requests++; return Notification.permission = 'granted'; }; }
  const worker = { showNotification: async (title, options) => { if (workerError) throw Error('browser rejected'); shown.push({ title, options }); }, getNotifications: async () => [] };
  const navigator = {
    serviceWorker: { register: async () => worker, ready: Promise.resolve(worker) },
    geolocation: { getCurrentPosition(ok, fail, options) { events.push(options); if (gpsError) fail({ code: gpsError }); else ok({ coords: { latitude: 9.08, longitude: 7.49, accuracy: 20 } }); } }
  };
  const window = { Notification, isSecureContext: true };
  const context = vm.createContext({ window, Notification, navigator, localStorage: { getItem:k=>stored.get(k), setItem:(k,v)=>stored.set(k,v) }, location: {}, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/device.js'), 'utf8'), context);
  return { api: window.BoothyDevice, shown, stored, events, requests: () => requests };
}

test('notifications are never requested on load and only activate after an explicit enable action', async () => {
  const d = device(); assert.equal(d.requests(), 0);
  await d.api.signal('Reminder', 'Original reason', 'trip'); assert.equal(d.shown.length, 0);
  assert.equal(await d.api.toggleNotifications(), 'enabled'); assert.equal(d.requests(), 1);
  await d.api.signal('Reminder', 'Original reason', 'trip');
  assert.equal(d.shown.length, 1); assert.equal(d.shown[0].options.body, 'Original reason');
  assert.equal(d.shown[0].options.tag, 'trip');
  assert.equal(await d.api.toggleNotifications(), 'off');
});

test('blocked/unsupported notification permission keeps in-app operation; phone failures are reported', async () => {
  const blocked = device({ permission: 'denied' }); assert.equal(await blocked.api.toggleNotifications(), 'blocked'); assert.equal(blocked.requests(), 0);
  const unavailable = device({ supported: false }); assert.equal(await unavailable.api.toggleNotifications(), 'unavailable');
  const failure = device({ workerError: true }); await failure.api.toggleNotifications();
  assert.equal(await failure.api.signal('Reminder', 'Reason', 'trip'), false);
});

test('GPS capture reports a fix, denial, and timeout without requesting anything on load', async () => {
  const d = device(); assert.equal(d.events.length, 0);
  const coords = await d.api.captureParking(); assert.equal(coords.accuracy, 20); assert.equal(coords.lat, 9.08);
  assert.equal(d.events[0].timeout, 15000);
  await assert.rejects(device({ gpsError: 1 }).api.captureParking(), /declined/);
  await assert.rejects(device({ gpsError: 3 }).api.captureParking(), /timed out/);
});

test('Home Screen assets exist and the service worker does not cache private pages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/manifest.webmanifest')));
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(__dirname, '../dist', icon.src)));
  const worker = fs.readFileSync(path.join(__dirname, '../dist/sw.js'), 'utf8');
  assert.ok(!worker.includes('caches.')); assert.ok(!worker.includes('setInterval'));
});

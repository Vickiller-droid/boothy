const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../dist/model.js');
const step = (s, a, data) => M.transition(s, a, data);
const depart = (s = M.initial()) => step(step(s, 'depart'), 'detect');
const arrival = (s, now = '2026-10-14T13:30:00Z') => step(s, 'arrive', { now });

test('departure detection starts the ride and snapshots the original reasons', () => {
  const original = M.initial();
  let s = step(original, 'depart');
  assert.equal(s.ride.stage, 'detecting');
  assert.equal(original.ride.stage, 'ready');
  s = step(s, 'detect');
  assert.equal(s.ride.stage, 'inTransit');
  assert.equal(s.ride.end.reason, original.config.end.reason);
  assert.equal(s.ride.items.length, 4);
  assert.deepEqual(step(s, 'depart'), s);
});

test('in-transit delivery, snooze, and acknowledgement keep the reason', () => {
  let s = depart();
  const reason = s.ride.transit.reason;
  s = step(s, 'advance');
  assert.equal(s.ride.transit.status, 'scheduled');
  s = step(s, 'advance');
  assert.equal(s.ride.transit.status, 'due');
  s = step(s, 'snooze');
  assert.equal(s.ride.transit.at, 3);
  s = step(s, 'advance');
  assert.equal(s.ride.transit.status, 'due');
  assert.equal(s.ride.transit.reason, reason);
  s = step(s, 'ackTransit');
  assert.equal(s.ride.transit.status, 'done');
});

test('active reminder edits at a past minute deliver immediately', () => {
  let s = depart(); s = step(s, 'advance'); s = step(s, 'advance');
  s = step(s, 'configure', { config: { ...s.config, transit: { message: 'Call my sister', reason: 'She needs my arrival time.', at: 1 } }, updateTransit: true });
  assert.equal(s.ride.transit.status, 'due');
  assert.equal(s.ride.transit.reason, 'She needs my arrival time.');
});

test('arrival delivers the end reminder and belongings; parking survives reload and the next ride', () => {
  let s = depart(); s = step(s, 'advance'); s = step(s, 'advance'); s = step(s, 'ackTransit'); s = arrival(s);
  assert.equal(s.ride.stage, 'arrived');
  assert.equal(s.ride.end.done, false);
  assert.ok(s.ride.items.every(i => !i.checked));
  assert.equal(s.parking.location, 'Impact Hub, Abuja');
  assert.equal(s.parking.note, 'Front entrance · space B12');
  assert.deepEqual(M.restore(JSON.stringify(s)), s);
  assert.equal(step(s, 'newRide').ride.stage, 'arrived');
  s = step(s, 'ackEnd');
  for (const item of s.ride.items) s = step(s, 'collect', { id: item.id });
  const saved = s.parking;
  s = step(s, 'newRide');
  assert.equal(s.ride.stage, 'ready'); assert.deepEqual(s.parking, saved);
  s = depart(s); assert.deepEqual(s.parking, saved);
});

test('early arrival records a reminder as not delivered, rather than silently firing it', () => {
  const s = arrival(depart());
  assert.equal(s.ride.transit.status, 'missed');
  assert.ok(s.ride.events.some(e => e.message.includes('before the in-transit')));
  assert.equal(s.ride.end.done, false);
});

test('an unhandled transit reminder remains due after arrival and prevents completion', () => {
  let s = depart(); s = step(s, 'advance'); s = step(s, 'advance'); s = arrival(s); s = step(s, 'ackEnd');
  for (const item of s.ride.items) s = step(s, 'collect', { id: item.id });
  assert.equal(s.ride.transit.status, 'due');
  assert.equal(step(s, 'newRide').ride.stage, 'arrived');
  s = step(s, 'ackTransit'); assert.equal(step(s, 'newRide').ride.stage, 'ready');
});

test('edits for the next ride do not overwrite the current arrival reason', () => {
  let s = depart(); const original = s.ride.end.reason;
  s = step(s, 'configure', { config: { ...s.config, end: { message: 'New message', reason: 'New reason' }, items: ['Laptop'] } });
  s = arrival(s);
  assert.equal(s.ride.end.reason, original); assert.equal(s.ride.items.length, 4);
});

test('turning off parking capture keeps the last saved location', () => {
  let s = step(M.initial(), 'saveParking', { location: 'Home', note: 'By the gate' });
  s = step(s, 'configure', { config: { ...s.config, saveParking: false } });
  s = arrival(depart(s));
  assert.equal(s.parking.location, 'Home');
});

test('corrupt storage recovers and cancelled detection cannot start a ride', () => {
  assert.deepEqual(M.restore('{bad'), M.initial());
  assert.deepEqual(M.restore('{"version":1}'), M.initial());
  let s = step(M.initial(), 'depart'); s = step(s, 'cancelDetection'); s = step(s, 'detect');
  assert.equal(s.ride.stage, 'ready');
});

// Exercise the shipped UI and delegated handlers in a minimal DOM adapter.
// This is a script integration check, not a rendered-browser layout test.
function app(saved, failStorage = false, initialTime = Date.now()) {
  const nodes = new Map();
  for (const id of ['main', 'view', 'page-eyebrow', 'page-title', 'page-subtitle', 'notice-region', 'context-panel', 'storage-warning', 'toast']) {
    nodes.set('#' + id, { innerHTML: '', textContent: '', hidden: true, focus() {}, scrollIntoView() {} });
  }
  const events = {}, timers = new Map(), storage = new Map(); let tid = 0, virtualTime = initialTime, interval;
  if (saved) storage.set('boothy-ride-lab-v1', saved);
  const document = { activeElement: {}, querySelector: q => nodes.get(q) || null, querySelectorAll: () => ['ride', 'reminders', 'parking'].map(t => ({ dataset: { tab: t }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} })), addEventListener: (n, cb) => { events[n] = cb; } };
  const window = { addEventListener() {}, scrollTo() {} };
  class ClockDate extends Date { static now() { return virtualTime; } }
  const context = vm.createContext({ window, document, Date: ClockDate, location: { hash: '' }, localStorage: { getItem(k) { if (failStorage) throw Error('denied'); return storage.get(k) ?? null; }, setItem(k, v) { if (failStorage) throw Error('denied'); storage.set(k, v); } }, setTimeout(cb, ms) { timers.set(++tid, { cb, ms }); return tid; }, clearTimeout(id) { timers.delete(id); }, setInterval(cb) { interval = cb; }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/model.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), context);
  return {
    html: q => nodes.get(q).innerHTML,
    warning: () => !nodes.get('#storage-warning').hidden,
    state: () => JSON.parse(storage.get('boothy-ride-lab-v1')),
    stored: () => storage.get('boothy-ride-lab-v1'),
    click(action, id, value) { return events.click({ target: { closest(selector) { return selector === '[data-action]' ? { dataset: { action, id, value } } : null; } } }); },
    advanceTime(ms) { virtualTime += ms; interval?.(); },
    tab(tab) { events.click({ target: { closest: selector => selector === '[data-tab]' ? { dataset: { tab } } : null } }); },
    detect() { for (const [id, t] of timers) if (t.ms === 1600) { timers.delete(id); t.cb(); } },
    submit(type, values) {
      const elements = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, setCustomValidity() {}, reportValidity: () => true }]));
      const form = { dataset: { form: type }, reportValidity: () => true, elements: { namedItem: name => elements[name] } };
      events.submit({ preventDefault() {}, target: { closest: () => form } });
    }
  };
}

test('shipped UI handlers complete the departure → transit → arrival → parking → reload loop', () => {
  const ui = app();
  assert.match(ui.html('#view'), /Simulate departure/);
  ui.click('depart'); assert.match(ui.html('#view'), /Confirming simulated travel/);
  ui.detect(); assert.match(ui.html('#view'), /Jump to 2 min before arrival/);
  ui.click('advance'); ui.click('advance');
  assert.match(ui.html('#notice-region'), /Message the meetup organiser/);
  assert.match(ui.html('#notice-region'), /YOUR ORIGINAL REASON/);
  ui.click('snooze'); assert.equal(ui.html('#notice-region'), '');
  ui.click('advance'); ui.click('ackTransit');
  ui.click('arrive'); assert.match(ui.html('#view'), /My power bank and head warmer could be left there/);
  ui.click('ackEnd');
  for (let id = 0; id < 4; id++) ui.click('collect', String(id));
  assert.match(ui.html('#view'), /All set. Nothing left behind/);
  ui.tab('parking'); assert.match(ui.html('#view'), /Front entrance · space B12/);
  ui.click('parkingPrompt'); assert.match(ui.html('#notice-region'), /Your car is at Impact Hub, Abuja/);
  const reloaded = app(ui.stored()); reloaded.tab('parking');
  assert.match(reloaded.html('#view'), /Front entrance · space B12/);
  reloaded.tab('ride'); reloaded.click('newRide');
  assert.equal(reloaded.state().parking.location, 'Impact Hub, Abuja');
  assert.match(reloaded.html('#view'), /Simulate departure/);
});

test('reminder form accepts custom messages; user input renders as text', () => {
  const ui = app(); ui.tab('reminders');
  ui.submit('reminders', { transitMessage: '<img src=x onerror=alert(1)>', transitReason: 'Why & when', endMessage: 'Collect my bag', endReason: 'My notebook is inside.', items: 'Bag, Bag, Phone', at: '1' });
  assert.deepEqual(ui.state().config.items, ['Bag', 'Phone']);
  ui.click('depart'); ui.detect(); ui.click('advance');
  assert.match(ui.html('#notice-region'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!ui.html('#notice-region').includes('<img'));
  ui.click('ackTransit'); ui.click('arrive');
  assert.match(ui.html('#view'), /My notebook is inside/);
});

test('UI still runs when localStorage is blocked and tells the user', () => {
  const ui = app(null, true); assert.equal(ui.warning(), true);
  ui.click('depart'); ui.detect(); ui.click('advance'); ui.click('arrive');
  assert.match(ui.html('#view'), /You’ve arrived/);
});

test('the pre-arrival alert fires exactly 2 minutes before ETA, once, then arrives automatically', () => {
  let s = depart();
  assert.equal(s.ride.duration, 5);
  assert.equal(s.ride.preArrival.status, 'scheduled');
  s = step(s, 'advance'); s = step(s, 'advance');
  assert.equal(s.ride.preArrival.status, 'scheduled');
  s = step(s, 'advance');
  assert.equal(s.ride.duration - s.ride.elapsed, 2);
  assert.equal(s.ride.preArrival.status, 'due');
  assert.equal(s.ride.preArrival.deliveredAt, 3);
  assert.equal(s.ride.stage, 'inTransit');
  s = step(s, 'ackPreArrival');
  assert.equal(s.ride.end.done, false);
  assert.ok(s.ride.items.every(i => !i.checked));
  s = M.restore(JSON.stringify(s));
  assert.equal(s.ride.preArrival.status, 'done');
  s = step(s, 'advance'); s = step(s, 'advance');
  assert.equal(s.ride.stage, 'arrived');
  assert.equal(s.ride.elapsed, 5);
  assert.equal(s.ride.events.filter(e => e.message.includes('Belongings alert delivered')).length, 1);
  assert.equal(s.parking.location, 'Impact Hub, Abuja');
});

test('custom trip duration schedules the same 2-minute warning; a 2-minute trip warns at departure', () => {
  let s = M.initial();
  s.config.duration = 8; s = depart(s);
  s = step(s, 'nearArrival');
  assert.equal(s.ride.elapsed, 6); assert.equal(s.ride.preArrival.status, 'due');
  s = M.initial(); s.config.duration = 2; s = depart(s);
  assert.equal(s.ride.elapsed, 0); assert.equal(s.ride.preArrival.status, 'due');
});

test('existing saved rides are upgraded without losing belongings, reasons, or parking', () => {
  const legacy = depart();
  delete legacy.config.duration; delete legacy.ride.duration; delete legacy.ride.preArrival;
  legacy.ride.elapsed = 7;
  legacy.parking = { location: 'My previous spot', note: 'Near the gate', savedAt: '2026-10-14T13:30:00Z' };
  const s = M.restore(JSON.stringify(legacy));
  assert.equal(s.ride.stage, 'inTransit');
  assert.equal(s.ride.duration - s.ride.elapsed, 2);
  assert.equal(s.ride.preArrival.status, 'due');
  assert.deepEqual(s.ride.items, legacy.ride.items);
  assert.equal(s.ride.end.reason, legacy.ride.end.reason);
  assert.equal(s.parking.note, 'Near the gate');
});

test('shipped UI displays the warning, countdown, original reason, and automatic arrival', () => {
  const ui = app();
  ui.click('depart'); ui.detect();
  assert.match(ui.html('#view'), /5 minutes to arrival/);
  ui.click('advance'); ui.click('advance'); ui.click('ackTransit');
  assert.ok(!ui.html('#notice-region').includes('BEFORE YOU ARRIVE'));
  ui.click('advance');
  assert.match(ui.html('#notice-region'), /2 minutes to arrival. Get your belongings ready/);
  assert.match(ui.html('#notice-region'), /My power bank and head warmer could be left there/);
  assert.match(ui.html('#notice-region'), /Power bank/);
  const reload = app(ui.stored());
  assert.match(reload.html('#notice-region'), /2 minutes to arrival/);
  reload.click('ackPreArrival');
  assert.ok(!reload.html('#notice-region').includes('BEFORE YOU ARRIVE'));
  reload.click('advance'); assert.match(reload.html('#view'), /1 minute to arrival/);
  reload.click('advance');
  assert.match(reload.html('#view'), /You’ve arrived/);
  assert.match(reload.html('#view'), /Before you leave the car/);
  assert.match(reload.html('#view'), /My power bank and head warmer could be left there/);
});

test('shipped real-ride UI keeps the clock, ETA corrections, reminders, and arrival confirmation connected', async () => {
  const start = Date.parse('2026-10-14T14:00:00Z');
  const ui = app(null, false, start);
  await ui.click('chooseClock', undefined, 'real'); assert.match(ui.html('#view'), /Start my ride/);
  await ui.click('depart'); assert.equal(ui.state().ride.clockMode, 'real');
  assert.match(ui.html('#view'), /05:00/);
  ui.advanceTime(180000); assert.match(ui.html('#notice-region'), /02:00 to estimated arrival/);
  assert.match(ui.html('#notice-region'), /My power bank and head warmer could be left there/);
  await ui.click('ackPreArrival'); await ui.click('ackTransit');
  ui.submit('eta', { minutes: '4' }); assert.equal(ui.state().ride.preArrival.status, 'scheduled');
  ui.advanceTime(120000); assert.match(ui.html('#notice-region'), /Get your belongings ready/);
  await ui.click('ackPreArrival'); ui.advanceTime(120000);
  assert.equal(ui.state().ride.stage, 'inTransit'); assert.match(ui.html('#notice-region'), /Have you arrived/);
  await ui.click('arrive'); assert.match(ui.html('#view'), /confirmed by you/);
  assert.equal(ui.state().parking.source, 'note');
});

test('static delivery has no external assets; mobile sizing and accessibility foundations exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../dist/styles.css'), 'utf8');
  assert.match(html, /name="viewport"/); assert.match(html, /aria-live="polite"/);
  for (const file of ['model.js', 'app.js', 'styles.css', 'icon.svg']) assert.ok(fs.existsSync(path.join(__dirname, '../dist', file)));
  assert.ok(!/https?:\/\//.test(html.replace('http://www.w3.org/2000/svg', '')));
  assert.match(css, /@media\(max-width:650px\)/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-width:0/); assert.match(css, /focus-visible/);
});

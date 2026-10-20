(function () {
  'use strict';
  const KEY = 'boothy-ride-lab-v1';
  const M = window.BoothyModel;
  let storageOK = true, state;
  try { state = M.restore(localStorage.getItem(KEY)); } catch { state = M.initial(); storageOK = false; }
  let tab = ['ride', 'reminders', 'parking'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'ride';
  let detectionTimer, toastTimer, parkingPrompt = false, capturingParking = false;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const mini = (name, green = false) => `<span class="mini-icon ${green ? 'green' : ''}">${icon(name)}</span>`;
  const button = (action, text, style = '', extra = '', name = '') => `<button type="button" class="button ${style}" data-action="${action}" ${extra}>${name ? icon(name) : ''}${text}</button>`;
  const clock = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const isReal = () => (state.ride.clockMode || state.config.clockMode) === 'real';
  const tag = (kind, r = state.ride) => `boothy-${r.id || 'ride'}-${kind}${kind === 'before' ? '-' + (r.preArrival?.revision || 0) : ''}`;
  function signal(title, body, kind) {
    window.BoothyDevice?.signal(title, body, tag(kind)).then(ok => { if (!ok) toast('Phone notification could not be shown. Your reminder is still visible in Boothy.'); });
  }
  function signalChanges(previous) {
    const r = state.ride;
    if (r.preArrival?.status === 'due' && previous.preArrival?.status !== 'due') signal('Get your belongings ready', `${r.end.message}. ${r.end.reason} Items: ${r.items.map(i => i.name).join(', ')}.`, 'before');
    if (r.transit?.status === 'due' && previous.transit?.status !== 'due') signal(r.transit.message, r.transit.reason, 'transit');
    if (r.etaReached && !previous.etaReached && !(r.preArrival?.status === 'due' && previous.preArrival?.status !== 'due')) signal('Have you arrived?', 'Your estimated arrival time has passed. Confirm arrival or update your estimate.', 'eta');
    if (r.stage === 'arrived' && previous.stage !== 'arrived') signal('Before you leave the vehicle', `${r.end.message}. ${r.end.reason} Collect: ${r.items.map(i => i.name).join(', ')}.`, 'end');
    if (previous.preArrival?.status === 'due' && r.preArrival?.status !== 'due') window.BoothyDevice?.close(tag('before', previous));
    if (previous.transit?.status === 'due' && r.transit?.status !== 'due') window.BoothyDevice?.close(tag('transit', previous));
    if (r.end?.done && !previous.end?.done) window.BoothyDevice?.close(tag('end'));
    if (previous.etaReached && (!r.etaReached || r.stage === 'arrived')) window.BoothyDevice?.close(tag('eta', previous));
  }
  function updateClockLabels() {
    const seconds = M.remainingSeconds(state.ride);
    const countdown = $('#ride-countdown'); if (countdown) countdown.textContent = clock(seconds);
    const eta = $('#ride-eta'); if (eta) eta.textContent = seconds > 0 ? `${clock(seconds)} until estimated arrival` : 'Estimate reached · confirm arrival';
    const alert = $('#arrival-countdown'); if (alert) alert.textContent = seconds > 0 ? `${clock(seconds)} to estimated arrival. Get your belongings ready.` : 'Your arrival estimate has passed. Keep your belongings ready.';
  }
  function toast(message) {
    clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { storageOK = false; }
    $('#storage-warning').hidden = storageOK;
  }
  function send(action, data) {
    const previous = state.ride;
    const previousStage = state.ride.stage;
    const previousAlert = state.ride.preArrival?.status;
    state = M.transition(state, action, { nowMs: Date.now(), ...data });
    const tickOnly = action === 'tick' && previous.elapsed === state.ride.elapsed && previous.transit.status === state.ride.transit.status && previous.preArrival.status === state.ride.preArrival.status && previous.etaReached === state.ride.etaReached;
    if (tickOnly) { updateClockLabels(); return; }
    save();
    if (action === 'tick') {
      // Keep drafts intact when a reminder becomes due while someone is editing.
      $('#notice-region').innerHTML = notices(); $('#context-panel').innerHTML = context();
      if (tab === 'ride' && !document.querySelector('details[open] form[data-form="eta"]')) $('#view').innerHTML = transitView();
      updateClockLabels();
    } else render();
    signalChanges(previous);
    if (previousStage !== 'arrived' && state.ride.stage === 'arrived') {
      tab = 'ride'; location.hash = 'ride'; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (state.ride.preArrival?.status === 'due' && previousAlert !== 'due') {
      $('#notice-region').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (state.ride.stage === 'detecting' && !detectionTimer) {
      detectionTimer = setTimeout(() => { detectionTimer = null; send('detect'); toast('Simulated movement detected. Your ride started automatically.'); }, 1600);
    }
  }
  function changeTab(next) {
    tab = next; location.hash = next; render();
    $('#main').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const reason = text => `<div class="reason-box"><small>YOUR ORIGINAL REASON</small><p>${escape(text)}</p></div>`;
  function map(parking = false) {
    const r = state.ride;
    const ratio = r.stage === 'arrived' ? 1 : r.stage === 'inTransit' ? Math.min(r.elapsed / r.duration, .96) : 0;
    const cx = 114 + 290 * ratio, cy = 139 - 91 * ratio;
    return `<div class="route-map ${parking ? 'parking-map' : ''} ${r.stage}"><span class="map-label">${parking ? 'SAVED SPOT' : isReal() ? 'TRIP OVERVIEW' : 'YOUR SIMULATED ROUTE'}</span>
    <svg viewBox="0 0 520 190" preserveAspectRatio="xMidYMid slice" aria-label="Illustrative route diagram, not a real map" role="img">
      <rect width="520" height="190" fill="var(--map-base)"/>
      <g fill="var(--map-block)"><rect x="30" y="44" width="71" height="50" rx="10"/><rect x="145" y="24" width="65" height="72" rx="9"/><rect x="280" y="119" width="67" height="48" rx="9"/><rect x="437" y="103" width="67" height="51" rx="9"/></g>
      <g fill="none" stroke="var(--map-road)" stroke-width="17"><path d="M-10 123 116 122 170 145 248 145 302 105 348 70 430 70 537 14"/><path d="M122-10v90l-30 91v30M255-10v91l28 43v80M408-10v97l-25 70v45"/></g>
      <g stroke="var(--map-edge)" stroke-width="1" fill="none"><path d="M-10 114 118 114 174 137 245 137 294 99 345 62 428 62 537 6M-10 132 114 132 167 154 251 154 308 112 351 79 432 79 537 24"/></g>
      <g fill="var(--map-tree)"><circle cx="56" cy="161" r="14"/><circle cx="217" cy="113" r="10"/><circle cx="471" cy="42" r="12"/><circle cx="332" cy="27" r="15"/><circle cx="42" cy="23" r="8"/></g>
      <path class="map-route" d="M114 139 169 144 248 144 302 105 349 70 404 49" fill="none" stroke="#ee622c" stroke-width="3" stroke-linecap="round"/>
      <circle cx="114" cy="139" r="8" fill="white" stroke="#819078" stroke-width="2"/><circle cx="114" cy="139" r="3" fill="#819078"/>
      <g transform="translate(404 48)"><circle r="18" fill="${parking ? '#2d6a52' : '#ee622c'}"/><circle r="25" fill="none" stroke="${parking ? '#2d6a52' : '#ee622c'}" stroke-opacity=".14" stroke-width="6"/>${parking ? '<text text-anchor="middle" y="6" class="parking-letter">P</text>' : '<path d="M0 9s-6-5-6-10a6 6 0 1 1 12 0c0 5-6 10-6 10Z" stroke="white" fill="none" stroke-width="1.7"/><circle cy="-1" r="2" fill="white"/>'}</g>
      ${!parking && r.stage !== 'arrived' ? `<g class="map-car" transform="translate(${cx} ${cy}) rotate(-12)"><rect x="-17" y="-12" width="34" height="24" rx="8" fill="#2c4936" stroke="white" stroke-width="2"/><path d="M-9-5H9M-9 5H9" stroke="#bacab3" stroke-width="3" stroke-linecap="round"/><path d="M-10-11v-3M10-11v-3M-10 11v3M10 11v3" stroke="#273d2d" stroke-width="3"/></g>` : ''}
    </svg><span class="map-caption">Illustration · not a live map</span></div>`;
  }
  function tripForm() {
    const c = state.config;
    return `<details class="form-details"><summary>Edit route & parking details</summary><form data-form="trip">
      <label class="field">From<input name="origin" value="${escape(c.origin)}" required maxlength="100"></label>
      <label class="field">To<input name="destination" value="${escape(c.destination)}" required maxlength="100"></label>
      <label class="field">${c.clockMode === 'real' ? 'Minutes until arrival (your estimate)' : 'Simulated trip length (minutes)'}<input type="number" name="duration" min="2" max="999" value="${c.duration}" required><span class="field-note">Boothy alerts you 2 minutes before this estimated arrival.</span></label>
      <label class="field">How are you travelling?<select name="transport"><option value="car" ${c.transport === 'car' ? 'selected' : ''}>Driving my own car</option><option value="passenger" ${c.transport === 'passenger' ? 'selected' : ''}>Passenger · taxi, bus or someone else's car</option></select><span class="field-note">Passenger rides keep your previous parking note and do not save the vehicle as your car.</span></label>
      <label class="checkbox-label"><input type="checkbox" name="saveParking" ${c.saveParking ? 'checked' : ''}><span>Save this arrival as my parking location</span></label>
      <label class="field">Parking note<input name="parkingNote" value="${escape(c.parkingNote)}" maxlength="160" placeholder="e.g. Near the entrance, space B12"><span class="field-note">${c.clockMode === 'real' ? 'Save an exact GPS spot from Parking after you park.' : 'A simulated spot for this test. It stays saved between rides.'}</span></label>
      <button class="button outline full" type="submit">Save trip details</button></form></details>`;
  }
  function readyView() {
    const c = state.config, detecting = state.ride.stage === 'detecting';
    return `${detecting ? '' : `<div class="mode-picker" role="group" aria-label="Choose ride mode">${button('chooseClock', 'Test a ride', c.clockMode === 'simulation' ? 'selected' : '', `data-value="simulation" aria-pressed="${c.clockMode === 'simulation'}"`, 'car')}${button('chooseClock', 'Use on a ride', c.clockMode === 'real' ? 'selected' : '', `data-value="real" aria-pressed="${c.clockMode === 'real'}"`, 'clock')}</div>`}<section class="card">${map()}<div class="card-pad"><div class="card-top"><span class="section-label">TODAY'S TRIP</span><span class="pill ${detecting ? 'orange' : 'neutral'}"><span></span>${detecting ? 'Detecting movement' : 'Not started'}</span></div>
      <div class="trip-stops"><div class="stop"><small>FROM</small><strong>${escape(c.origin)}</strong></div>${icon('arrow')}<div class="stop"><small>TO</small><strong>${escape(c.destination)}</strong></div></div>
      <h2 class="stage-heading">${detecting ? 'Looks like you’re on the move.' : 'Ready when you are.'}</h2>
      <p class="help">${detecting ? 'Boothy is turning simulated movement into an active ride. Your reminders are coming along.' : c.clockMode === 'real' ? 'Set your route and minutes until arrival. Start the countdown when your ride begins, and keep Boothy open for timely alerts.' : 'Simulate movement and Boothy will start a ride. Then step through each reminder, at your pace.'}</p>
      ${detecting ? `<div class="detecting-indicator"><span></span>Confirming simulated travel…</div>${button('cancelDetection', 'Cancel detection', 'outline full')}` : button('depart', c.clockMode === 'real' ? 'Start my ride' : 'Simulate departure', 'primary full', '', 'arrow')}
      ${detecting ? '' : tripForm()}</div></section>
      <section class="card ready-list"><div class="compact-head"><h3>Before you go</h3><button class="text-button" data-tab="reminders">Edit ${icon('edit')}</button></div><p class="small-copy">${c.duration}-minute ${c.clockMode === 'real' ? 'estimate' : 'sample ride'} · belongings alert 2 minutes before arrival.</p><div class="item-chips">${c.items.map(i => `<span class="item-chip">${escape(i)}</span>`).join('')}</div></section>${alertOptions()}`;
  }
  function transitView() {
    const r = state.ride;
    const remaining = Math.ceil(M.remainingSeconds(r) / 60), real = r.clockMode === 'real';
    return `<section class="card">${map()}<div class="card-pad"><div class="card-top"><span class="section-label">RIDE IN PROGRESS</span><span class="pill"><span></span>On the move</span></div>
      <div class="trip-stops"><div class="stop"><small>FROM</small><strong>${escape(r.origin)}</strong></div>${icon('arrow')}<div class="stop"><small>TO</small><strong>${escape(r.destination)}</strong></div></div>
      <div class="divider"></div><h2 class="stage-heading">${real && r.etaReached ? 'Are you there yet?' : 'Let the ride unfold.'}</h2><div class="elapsed">${real ? `<strong id="ride-countdown">${clock(M.remainingSeconds(r))}</strong><span>until your estimate</span>` : `${r.elapsed.toString().padStart(2, '0')}<span>simulated minutes</span>`}</div>
      <div class="eta-line ${remaining <= 2 ? 'near' : ''}">${icon('pin')}<strong ${real ? 'id="ride-eta"' : ''}>${real ? M.remainingSeconds(r) ? `${clock(M.remainingSeconds(r))} until estimated arrival` : 'Estimate reached · confirm arrival' : `${remaining} ${remaining === 1 ? 'minute' : 'minutes'} to arrival`}</strong><span>${real ? 'Your estimate' : 'Simulated ETA'}</span></div>
      <p class="help">${r.transit.status === 'scheduled' ? `Your in-transit reminder is due at minute ${Math.ceil(r.transit.at)}. ${real ? 'The clock runs while Boothy is active.' : 'Advance the clock to test it.'}` : r.transit.status === 'due' ? 'Your in-transit reminder is here. Its original reason is shown above.' : 'Your in-transit reminder is done. Arrival will bring up your belongings check.'}</p>
      ${real ? `<div class="button-row">${button('arrive', 'I’ve arrived · check my belongings', 'dark full', '', 'bag')}</div><p class="status-caption">Your ETA is a time estimate, not location detection. Confirm when you arrive.</p>` : `<div class="simulation-controls"><span class="section-label">TRIP SIMULATOR</span><div class="button-row">${button('advance', 'Advance 1 min', 'outline', '', 'plus')}${remaining > 2 ? button('nearArrival', 'Jump to 2 min before arrival', 'dark', '', 'pin') : button('arrive', 'Simulate arrival', 'dark', '', 'pin')}</div></div><p class="status-caption">The clock moves when you advance it. At 2 minutes remaining, Boothy alerts you; at 0, you arrive automatically.</p>`}
      <details class="form-details"><summary>Traffic or a changed plan? Update arrival estimate</summary><form data-form="eta"><label class="field">Minutes until arrival<input name="minutes" type="number" min="1" max="999" value="${Math.max(1, remaining)}" required></label><button type="submit" class="button outline full">Update estimate</button><p class="small-copy">If the ride is delayed, Boothy will alert again 2 minutes before the new estimate.</p></form></details></div></section>
      <section class="card ready-list"><div class="compact-head"><h3>Need a nudge along the way?</h3><button class="text-button" data-tab="reminders">Set reminder ${icon('arrow')}</button></div><p class="small-copy">Change the message, its reason, or the minute it should appear.</p></section>${eventLog()}`;
  }
  function eventLog() {
    if (!state.ride.events.length) return '';
    return `<details class="card card-pad"><summary style="font-size:12px;cursor:pointer">Trip activity · ${state.ride.events.length} events</summary><ul class="timeline">${state.ride.events.map(e => `<li><time>${String(e.minute).padStart(2, '0')} min</time><span>${escape(e.message)}</span></li>`).join('')}</ul></details>`;
  }
  function arrivalView() {
    const r = state.ride, count = r.items.filter(i => i.checked).length;
    const completed = r.end.done && count === r.items.length && r.transit.status !== 'due';
    return `<section class="card"><div class="arrived-banner"><span class="arrival-check">${icon('check')}</span><div><h2>You’ve arrived.</h2><p>${escape(r.destination)} · ${r.elapsed} ${r.clockMode === 'real' ? 'minutes · confirmed by you' : 'simulated minutes'}</p></div></div>
      <div class="card-pad ${r.end.done ? 'end-done' : ''}"><div class="card-top"><span class="section-label">RIDE-END REMINDER</span><span class="pill ${r.end.done ? '' : 'orange'}">${r.end.done ? 'Done' : 'Now due'}</span></div><h3 class="reminder-message">${escape(r.end.message)}</h3>${reason(r.end.reason)}
      ${r.end.done ? `<p class="success-line">${icon('check')}Reminder handled. The original reason stays here.</p>` : button('ackEnd', 'I’ve handled this', 'primary full', '', 'check')}
      ${r.transit.status === 'missed' ? '<p class="transit-late">The ride ended before your in-transit reminder was due. It was not delivered. Start another ride to test it.</p>' : ''}
      </div></section>
      <section class="card card-pad"><div class="section-title">${mini('bag', true)}<div><h2>Before you leave the car</h2><p class="small-copy">Check every item. Leave nothing behind.</p></div></div><div class="compact-head"><span class="muted">Belongings collected</span><span>${count} / ${r.items.length}</span></div>
      <div class="check-progress"><span style="width:${count / r.items.length * 100}%"></span></div>
      <div class="checklist">${r.items.map(i => `<button class="check-item ${i.checked ? 'checked' : ''}" data-action="collect" data-id="${i.id}" aria-pressed="${i.checked}"><span class="check-box">${i.checked ? icon('check') : ''}</span>${escape(i.name)}${i.checked ? '<span class="checked-caption">Got it</span>' : ''}</button>`).join('')}</div>
      ${count === r.items.length ? `<p class="success-line">${icon('check')}Everything is with you.</p>` : '<p class="small-copy">Tap each item once it’s in your hands or bag.</p>'}
      ${r.saveParking && state.parking ? `<div class="parking-summary">${mini('pin', true)}<div><strong>Your parking ${state.parking.source === 'gps' ? 'location' : 'note'} is saved</strong><p>${escape(state.parking.location)}<br>${escape(state.parking.note)}</p><button class="text-button" data-tab="parking">${r.clockMode === 'real' ? 'Save exact GPS spot' : 'View parking note'} ${icon('arrow')}</button></div></div>` : `<p class="small-copy">${r.transport === 'passenger' ? 'Passenger ride · your previous parking note is kept.' : 'Parking saving was off for this ride. Any previous parking note is still kept.'}</p>`}</section>
      ${completed ? `<section class="card completed-card"><h2>All set. Nothing left behind.</h2><p class="help">Your reminders are handled. Your parking note stays with you.</p>${button('newRide', 'Try another ride', 'dark full', '', 'reset')}</section>` : `<p class="status-caption">Handle the ride-end reminder${r.transit.status === 'due' ? ', the in-transit reminder,' : ''} and check every belonging to finish this test.</p>`}${eventLog()}`;
  }
  function remindersView() {
    const c = state.config, active = state.ride.stage === 'inTransit';
    return `<form data-form="reminders"><section class="card form-card"><div class="section-title">${mini('clock')}<div><h2>During the ride</h2><p class="small-copy">A timely nudge, with context.</p></div></div>
      <label class="field">Remind me to<input name="transitMessage" value="${escape(c.transit.message)}" required maxlength="140" placeholder="e.g. Message the organiser"></label>
      <label class="field">Why does it matter?<textarea name="transitReason" required maxlength="280" placeholder="The reason I set this reminder">${escape(c.transit.reason)}</textarea></label>
      <label class="field">At this minute of the ride<input type="number" name="at" min="1" max="999" value="${c.transit.at}" required><span class="field-note">${active ? `You’re at minute ${state.ride.elapsed}. A past minute delivers the reminder immediately.` : 'Use the simulator’s “Advance 1 min” button to reach this minute.'}</span></label>
      ${active ? '<p class="small-copy">Saving schedules this reminder for your current ride.</p>' : ''}</section>
      <section class="card form-card"><div class="section-title">${mini('bell')}<div><h2>Before you arrive</h2><p class="small-copy">Alert 2 minutes before arrival, then check again when the ride ends.</p></div></div>
      <label class="field">Remind me to<input name="endMessage" value="${escape(c.end.message)}" required maxlength="140"></label>
      <label class="field">Why did I set this?<textarea name="endReason" required maxlength="280">${escape(c.end.reason)}</textarea></label>
      <div class="divider"></div><label class="field">Belongings to check<input name="items" value="${escape(c.items.join(', '))}" required maxlength="400"><span class="field-note">Separate items with commas. Up to 12 items.</span></label>
      ${state.ride.stage !== 'ready' ? '<p class="small-copy">Belongings and ride-end changes apply to your next ride. This ride keeps the original message and reason.</p>' : ''}</section>
      <button class="button primary full" type="submit">${icon('check')}Save reminders</button><p class="status-caption">Every reminder keeps its message and reason. Choose extra alert channels below.</p></form>${alertOptions()}`;
  }
  function alertOptions() {
    const device = window.BoothyDevice;
    const prefs = device?.options() || {}, capabilities = device?.capabilities() || {};
    const notificationStatus = device?.status() || 'unavailable';
    return `<section class="card card-pad alert-settings"><div class="section-title">${mini('bell')}<div><h2>How should Boothy nudge you?</h2><p class="small-copy">In-app reminders are always on.</p></div></div>
      <label class="checkbox-label"><input type="checkbox" data-alert="sound" ${prefs.sound ? 'checked' : ''} ${capabilities.sound ? '' : 'disabled'}><span>Play a short sound${capabilities.sound ? '' : ' · unavailable here'}</span></label>
      <label class="checkbox-label"><input type="checkbox" data-alert="vibration" ${prefs.vibration ? 'checked' : ''} ${capabilities.vibration ? '' : 'disabled'}><span>Vibrate${capabilities.vibration ? ' on supported devices' : ' · unavailable here'}</span></label>
      <div class="button-row">${button('notifications', notificationStatus === 'enabled' ? 'Turn phone alerts off' : 'Enable phone alerts', 'outline small', notificationStatus === 'unavailable' || notificationStatus === 'blocked' ? 'disabled' : '', 'bell')}${button('testAlert', 'Test alert', 'outline small', '', 'check')}</div>
      <p class="status-caption">${notificationStatus === 'enabled' ? 'Phone notifications are enabled.' : notificationStatus === 'blocked' ? 'Phone alerts are blocked. Change this site’s notification permission in your browser settings.' : notificationStatus === 'unavailable' ? 'Phone alerts are unavailable in this browser. On iPhone, open Boothy from a Home Screen app to check support.' : 'Phone alerts ask for permission only when you enable them.'} Keep Boothy open for timely reminders; locked or closed pages cannot guarantee the alert schedule.</p></section>`;
  }
  function dateLabel(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? 'Saved on this device' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function parkingView() {
    const p = state.parking;
    const gps = p?.coords;
    return `${p ? `<section class="card">${map(true)}<div class="card-pad"><div class="card-top"><span class="section-label">YOUR LAST SAVED SPOT</span><span class="pill ${gps ? '' : 'neutral'}">${gps ? 'GPS saved' : p.source === 'simulation' ? 'Simulated spot' : 'Location note'}</span></div><h2 class="reminder-message">${escape(p.location)}</h2><p class="help">${escape(p.note) || 'No additional note.'}</p>${button('parkingPrompt', 'Remind me where I parked', 'dark full', '', 'pin')}
      ${gps ? `<p class="gps-detail">${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} · accuracy ±${Math.round(gps.accuracy)} m</p><a class="button outline full" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(gps.lat + ',' + gps.lng)}&travelmode=walking" target="_blank" rel="noopener noreferrer">${icon('arrow')}Walking directions in Maps</a>${gps.accuracy > 80 ? '<p class="small-copy">The GPS fix is broad. Keep a landmark or bay number in your note, or capture again outdoors.</p>' : ''}` : '<p class="small-copy">This is a text note, not a measured GPS position. Capture your current spot below if you’re beside your car.</p>'}
      <p class="saved-time">Saved ${escape(dateLabel(p.savedAt))}. Kept between rides and page reloads.</p></div></section>` : `<section class="card empty-state">${mini('pin', true)}<h2>A spot worth remembering.</h2><p>Save a location note, or capture your current GPS spot when you’re beside your car.</p>${button('goRide', 'Go to your ride', 'outline', '', 'arrow')}</section>`}
      <section class="card form-card"><div class="section-title">${mini('edit', true)}<div><h2>${p ? 'Update your parking note' : 'Save a parking note'}</h2><p class="small-copy">Keep enough detail to find your car.</p></div></div><form data-form="parking">
      <label class="field">Location<input name="location" value="${escape(p?.location || '')}" placeholder="e.g. Impact Hub, Abuja" required maxlength="100"></label>
      <label class="field">How will I find it?<textarea name="note" maxlength="160" placeholder="e.g. Front entrance, space B12">${escape(p?.note || '')}</textarea></label>
      <button class="button outline full" type="submit">Save parking note</button></form><div class="divider"></div>${button('captureParking', capturingParking ? 'Capturing location…' : 'Save my current GPS spot', 'dark full', capturingParking ? 'disabled' : '', 'pin')}<p class="status-caption">Location permission is requested only when you tap this button. GPS coordinates stay on this device; opening Maps shares that saved spot with Google Maps.</p></section>`;
  }
  function notices() {
    const r = state.ride;
    let result = '';
    if (r.stage === 'inTransit' && r.preArrival?.status === 'due') {
      const remaining = Math.ceil(M.remainingSeconds(r) / 60);
      result += `<section class="reminder-alert pre-arrival-alert" role="alert"><div class="card-top"><span class="section-label">BEFORE YOU ARRIVE</span><span class="pill orange">${r.clockMode === 'real' ? 'Arrival approaching' : 'Alerted 2 min before'}</span></div><h2 class="reminder-message" ${r.clockMode === 'real' ? 'id="arrival-countdown"' : ''}>${r.clockMode === 'real' ? M.remainingSeconds(r) ? `${clock(M.remainingSeconds(r))} to estimated arrival. Get your belongings ready.` : 'Your arrival estimate has passed. Keep your belongings ready.' : `${remaining} ${remaining === 1 ? 'minute' : 'minutes'} to arrival. Get your belongings ready.`}</h2><p class="pre-arrival-message">${escape(r.end.message)}</p>${reason(r.end.reason)}<div class="item-chips">${r.items.map(i => `<span class="item-chip">${escape(i.name)}</span>`).join('')}</div><p class="small-copy">Have these ready before you step out. You’ll confirm each item when the ride ends.</p>${button('ackPreArrival', 'I’m getting ready', 'primary full', '', 'bag')}</section>`;
    }
    if (r.stage === 'inTransit' && r.clockMode === 'real' && r.etaReached) result += `<section class="reminder-alert" role="alert"><span class="section-label">ARRIVAL CHECK</span><h2 class="reminder-message">Have you arrived?</h2><p class="help">Your estimated time has passed. If traffic changed the plan, update the arrival estimate on your ride.</p>${button('arrive', 'Yes · check my belongings', 'dark full', '', 'bag')}</section>`;
    if (r.transit?.status === 'due') result += `<section class="reminder-alert"><div class="card-top"><span class="section-label">${r.stage === 'arrived' ? 'UNHANDLED IN-TRANSIT REMINDER' : 'IN-TRANSIT REMINDER'}</span><span class="pill orange">Now due · ${r.transit.at} min</span></div><h2 class="reminder-message">${escape(r.transit.message)}</h2>${reason(r.transit.reason)}<div class="button-row">${button('ackTransit', 'Done', 'primary', '', 'check')}${r.stage === 'inTransit' ? button('snooze', 'Snooze 1 min', 'outline', '', 'clock') : ''}</div></section>`;
    if (parkingPrompt && state.parking) result += `<section class="reminder-alert"><div class="card-top"><span class="section-label">PARKING REMINDER</span><span class="pill neutral">Your saved note</span></div><h2 class="reminder-message">Your car is at ${escape(state.parking.location)}.</h2>${reason(state.parking.note || 'You saved this location so you could find your car after the ride.')}${button('dismissParking', 'Got it', 'outline', '', 'check')}</section>`;
    return result;
  }
  function context() {
    const r = state.ride, c = state.config;
    const step = ['ready', 'detecting'].includes(r.stage) ? 0 : r.stage === 'inTransit' ? 1 : 2;
    const transit = r.transit || c.transit, end = r.end || c.end;
    return `<section class="card card-pad"><h3 class="aside-title">The ride, step by step</h3><ol class="steps">${[
      ['Departure', isReal() ? 'Set an estimate. Start your ride manually.' : 'Simulate movement. Boothy starts the ride.'], ['In transit', 'At 2 minutes to arrival, get your belongings ready.'], ['Arrival', 'Handle reminders. Check your belongings.']
    ].map((s, i) => `<li class="${step === i ? 'current' : step > i ? 'done' : ''}"><span class="step-num">${step > i ? '✓' : '0' + (i + 1)}</span><div><strong>${s[0]}</strong><p>${s[1]}</p></div></li>`).join('')}</ol></section>
    <section class="card card-pad"><h3 class="aside-title">Coming along with you</h3><div class="preview-row">${mini('clock')}<div><strong>${escape(transit.message)}</strong><p>${transit.status === 'done' ? 'Handled' : transit.status === 'missed' ? 'Not delivered · ride ended early' : 'In transit · minute ' + Math.ceil(transit.at)}</p></div></div><div class="preview-row">${mini('bell')}<div><strong>${escape(end.message)}</strong><p>${end.done ? 'Handled' : '2 min before arrival · again at ride end'}</p></div></div><div class="preview-row">${mini('pin')}<div><strong>Remember your parking</strong><p>${state.parking ? 'A saved spot is ready to recall' : c.saveParking && c.transport === 'car' ? 'Parking note saved on arrival' : 'Passenger mode keeps your saved note'}</p></div></div></section>
    <div class="gentle-note"><strong><span class="note-star">✳</span> Context makes the difference.</strong>An alarm says something is due. Boothy reminds you what, and why.</div>`;
  }
  function render() {
    const focus = document.activeElement;
    const action = focus?.dataset?.action, itemId = focus?.dataset?.id;
    const titles = {
      ride: ["LET'S GET YOU THERE", 'Your ride, remembered.', "A nudge at the right moment. A reason you'll recognise."],
      reminders: ['GIVE THE NUDGE A REASON', 'Make it mean something.', 'Set the message. Keep the why.'],
      parking: ['FOR THE WALK BACK', 'Right where you left it.', 'A small note that saves a long search.']
    };
    const title = titles[tab];
    const mode = $('#mode-notice');
    if (mode) mode.innerHTML = `<span class="simulation-dot"></span><strong>${isReal() ? 'Ride timer mode' : 'Simulation mode'}</strong><span>${isReal() ? 'Your manual arrival estimate · keep Boothy open for timely alerts.' : 'Trips and locations are simulated. Test every state at your pace.'}</span>`;
    $('#page-eyebrow').textContent = title[0]; $('#page-title').textContent = title[1]; $('#page-subtitle').textContent = title[2];
    document.querySelectorAll('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.tab === tab); if (el.dataset.tab === tab) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    $('#notice-region').innerHTML = notices();
    $('#view').innerHTML = tab === 'reminders' ? remindersView() : tab === 'parking' ? parkingView() : state.ride.stage === 'inTransit' ? transitView() : state.ride.stage === 'arrived' ? arrivalView() : readyView();
    $('#context-panel').innerHTML = context();
    $('#storage-warning').hidden = storageOK;
    if (action) document.querySelector(`[data-action="${action}"]${itemId !== undefined ? `[data-id="${itemId}"]` : ''}`)?.focus({ preventScroll: true });
  }
  document.addEventListener('click', async e => {
    const navigation = e.target.closest('[data-tab]');
    if (navigation) { changeTab(navigation.dataset.tab); return; }
    const control = e.target.closest('[data-action]');
    if (!control) return;
    const a = control.dataset.action;
    if (a === 'toggleTheme') { window.BoothyTheme?.toggle(); return; }
    if (a === 'chooseClock' && state.ride.stage === 'ready') {
      send('configure', { config: { ...state.config, clockMode: control.dataset.value === 'real' ? 'real' : 'simulation' } }); return;
    }
    if (a === 'notifications') {
      const status = await window.BoothyDevice?.toggleNotifications();
      toast(status === 'enabled' ? 'Phone alerts enabled. Keep Boothy open for the ride timer.' : status === 'off' ? 'Phone alerts are off.' : status === 'blocked' ? 'Notification access is blocked. In-app alerts are still on.' : 'Phone alerts are unavailable in this browser.');
      const panel = document.querySelector('.alert-settings'); if (panel) panel.outerHTML = alertOptions(); else render(); return;
    }
    if (a === 'testAlert') {
      window.BoothyDevice?.unlockAudio(); const ok = await window.BoothyDevice?.test();
      toast(ok === false ? 'Phone alert could not be shown. In-app reminders still work.' : 'Test alert triggered. Sound and vibration depend on your device and selected options.'); return;
    }
    if (a === 'captureParking') {
      if (capturingParking) return;
      const form = document.querySelector('form[data-form="parking"]');
      const locationText = form?.elements.namedItem('location').value.trim() || state.parking?.location || 'My parking spot';
      const note = form?.elements.namedItem('note').value.trim() || state.parking?.note || '';
      capturingParking = true; control.disabled = true; control.textContent = 'Capturing location…';
      try { const coords = await window.BoothyDevice.captureParking(); send('captureParking', { coords, location: locationText, note }); toast('GPS parking spot saved with its accuracy.'); }
      catch (error) { toast(error.message); }
      finally {
        capturingParking = false;
        const captureButton = document.querySelector('[data-action="captureParking"]');
        if (captureButton) { captureButton.disabled = false; captureButton.innerHTML = icon('pin') + 'Save my current GPS spot'; }
      }
      return;
    }
    if (a === 'goRide') { changeTab('ride'); return; }
    if (a === 'parkingPrompt' || a === 'dismissParking') { parkingPrompt = a === 'parkingPrompt'; render(); if (parkingPrompt) $('#notice-region').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (a === 'cancelDetection') { clearTimeout(detectionTimer); detectionTimer = null; }
    if (a === 'depart') window.BoothyDevice?.unlockAudio();
    send(a, { id: control.dataset.id });
    if (a === 'newRide') toast('Ready for another ride. Your parking note is still saved.');
    if (a === 'snooze') toast(isReal() ? 'Snoozed for 1 minute.' : 'Snoozed. Advance 1 minute to see the same reminder again.');
  });
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (!form.reportValidity()) return;
    const f = name => form.elements.namedItem(name);
    const text = name => f(name).value.trim();
    const requireText = name => {
      if (text(name)) return true;
      f(name).setCustomValidity('Please enter a message, not just spaces.'); f(name).reportValidity(); return false;
    };
    if (form.dataset.form === 'trip') {
      if (state.ride.stage !== 'ready' || !['origin', 'destination'].every(requireText)) return;
      send('configure', { config: { ...state.config, origin: text('origin'), destination: text('destination'), duration: Number(f('duration').value), transport: f('transport').value, saveParking: f('saveParking').checked, parkingNote: text('parkingNote') } });
      toast('Route and parking details saved.');
    } else if (form.dataset.form === 'reminders') {
      if (!['transitMessage', 'transitReason', 'endMessage', 'endReason', 'items'].every(requireText)) return;
      const items = [...new Set(text('items').split(',').map(i => i.trim()).filter(Boolean))].slice(0, 12);
      if (!items.length) { f('items').setCustomValidity('Add at least one belonging.'); f('items').reportValidity(); return; }
      send('configure', { config: { ...state.config, items, transit: { message: text('transitMessage'), reason: text('transitReason'), at: Number(f('at').value) }, end: { message: text('endMessage'), reason: text('endReason') } }, updateTransit: state.ride.stage === 'inTransit' });
      toast('Reminders saved with their original reasons.'); changeTab('ride');
    } else if (form.dataset.form === 'eta') {
      send('updateEta', { minutes: Number(f('minutes').value) }); toast('Arrival estimate updated. The 2-minute alert follows the new estimate.');
    } else if (form.dataset.form === 'parking') {
      if (!requireText('location')) return;
      send('saveParking', { location: text('location'), note: text('note') }); parkingPrompt = false; render(); toast('Parking note saved on this device.');
    }
  });
  document.addEventListener('input', e => { if (e.target.setCustomValidity) e.target.setCustomValidity(''); });
  document.addEventListener('change', e => {
    if (e.target.dataset.alert) window.BoothyDevice?.setOption(e.target.dataset.alert, e.target.checked);
  });
  function syncClock() {
    if (state.ride.clockMode === 'real' && state.ride.stage === 'inTransit') send('tick', { nowMs: Date.now() });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncClock(); });
  window.addEventListener('storage', e => {
    if (e.key === KEY && e.newValue) { state = M.restore(e.newValue); render(); syncClock(); }
  });
  window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (['ride', 'reminders', 'parking'].includes(next) && next !== tab) { tab = next; render(); } });
  window.BoothyTheme?.sync();
  render();
  if (state.ride.stage === 'detecting') send('depart');
  syncClock();
  setInterval(syncClock, 1000);
})();

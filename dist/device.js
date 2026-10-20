(function () {
  'use strict';
  const key = 'boothy-alert-options-v1';
  let options = { sound: false, vibration: false, notifications: false };
  try { options = { ...options, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { /* In-app alerts remain available. */ }
  let registration, audio;
  if (navigator.serviceWorker && window.isSecureContext) {
    registration = navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);
  }
  function save() { try { localStorage.setItem(key, JSON.stringify(options)); } catch { /* Session preference only. */ } }
  function unlockAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try { audio ||= new Audio(); audio.resume().catch(() => {}); } catch { /* Browser may disallow sound. */ }
  }
  function beep() {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.frequency.setValueAtTime(740, audio.currentTime);
    oscillator.frequency.setValueAtTime(980, audio.currentTime + .15);
    gain.gain.setValueAtTime(.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.12, audio.currentTime + .03);
    gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .4);
    oscillator.start(); oscillator.stop(audio.currentTime + .42);
  }
  async function notify(title, body, tag) {
    if (options.sound) beep();
    if (options.vibration && navigator.vibrate) navigator.vibrate([180, 80, 180]);
    if (!options.notifications || !window.Notification || Notification.permission !== 'granted') return true;
    try {
      const worker = await registration;
      if (worker) await worker.showNotification(title, { body, tag, icon: 'icon-192.png', data: { url: './#ride' } });
      else {
        const n = new Notification(title, { body, tag, icon: 'icon-192.png' });
        n.onclick = () => { window.focus(); location.hash = 'ride'; n.close(); };
      }
      return true;
    } catch { return false; }
  }
  function status() {
    if (!window.Notification || !window.isSecureContext) return 'unavailable';
    if (Notification.permission === 'denied') return 'blocked';
    if (options.notifications && Notification.permission === 'granted') return 'enabled';
    return 'off';
  }
  window.BoothyDevice = {
    options: () => ({ ...options }), status, unlockAudio,
    capabilities: () => ({ sound: Boolean(window.AudioContext || window.webkitAudioContext), vibration: Boolean(navigator.vibrate), gps: Boolean(navigator.geolocation) }),
    setOption(name, value) { if (['sound', 'vibration'].includes(name)) { options[name] = Boolean(value); if (name === 'sound' && value) unlockAudio(); save(); } },
    async toggleNotifications() {
      if (status() === 'enabled') { options.notifications = false; save(); return 'off'; }
      if (status() === 'unavailable' || status() === 'blocked') return status();
      // Called directly from an explicit button click, before any other await.
      const permission = await Notification.requestPermission();
      options.notifications = permission === 'granted'; save(); return status();
    },
    signal: notify,
    test: () => notify('Boothy · Test alert', 'A reminder with its reason. Keep Boothy open for the ride timer.', 'boothy-test'),
    close(tag) {
      if (registration) registration.then(worker => worker?.getNotifications({ tag })).then(items => items?.forEach(n => n.close())).catch(() => {});
    },
    captureParking() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('This browser cannot capture a location. You can still save a parking note.')); return; }
        navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }), error => {
          reject(new Error(error.code === 1 ? 'Location access was declined. Your saved parking note is still kept.' : error.code === 3 ? 'Location capture timed out. Try again outdoors, or save a note.' : 'Your location is unavailable. Try again outdoors, or save a note.'));
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      });
    }
  };
})();

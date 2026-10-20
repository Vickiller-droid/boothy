# Boothy Ride Lab

A buildless mobile-first interactive prototype. Open `dist/index.html` with a static host. No external dependencies or runtime services are required.

## Test the ride

1. Edit the trip and reminders, or use the sample defaults.
2. Simulate departure. After 1.6 seconds, simulated movement starts the ride automatically.
3. Advance the clock to the reminder minute. Verify its message and original reason; snooze or mark it done.
4. Advance to 2 minutes before the estimated arrival, or use the jump button. The belongings alert shows the original ride-end message, reason, and items. Acknowledge it, then advance to minute 5 for automatic arrival (or simulate arrival). Handle the ride-end reminder and check each belonging.
5. Open Parking and recall the saved spot. Reload, then start a new ride; the parking note remains.

State is kept in browser localStorage, scoped to this Site. “Test a ride” uses a manually advanced simulated clock. “Use on a ride” uses a real countdown from a manual arrival estimate, with saved timestamps and a confirmation step at arrival. Both offer the two-minute belongings warning and preserve the reminder reason.

The real timer catches up when the page resumes, but browsers can suspend background pages. Keep Boothy open for timely alerts. There is no native automatic ride detection, live routing ETA, or scheduled push backend. Phone notifications use the browser's Notifications API after explicit permission, with sound/vibration as selected. The service worker only handles notifications and does not cache private pages.

Passenger rides preserve existing parking. Driving one's own car can save a parking note. The Parking screen can capture current GPS coordinates on request, show the reported accuracy, and open walking directions in Maps. Coordinates remain on the device unless the user opens the Maps link.

Run the workflow and device-adapter verification with `node --test tests/*.cjs`.

Use the moon/sun button in the header to switch between light and dark mode. On the first visit, Boothy follows the device's color preference. A manual choice is saved on the device, separately from the ride state, and is applied before the page renders.

See `docs/research-and-plan.md` for the comparable-app research, decisions, implemented scope, and native mobile roadmap.

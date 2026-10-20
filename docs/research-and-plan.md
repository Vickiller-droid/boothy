# Boothy: research, decisions, and implementation

Reviewed 14 October 2026. Research uses the products' own support documentation and platform documentation. This is a workflow comparison, not an exhaustive market-size or trademark analysis.

## Relevant products

| Product | Documented behavior | Decision for Boothy |
| --- | --- | --- |
| [Transit GO](https://help.transitapp.com/article/549-how-to-use-go) | Guides a selected journey, supports approaching-stop notifications and optional spoken alerts. | Make the active ride and approaching arrival the primary flow. Provide selectable alert channels, keep the original reason, and support ETA corrections. |
| [Apple Reminders](https://support.apple.com/en-us/102484) | Reminders can contain extra context and links, rather than only a bare alarm. | Preserve the message and reason in the ride snapshot. Completing an alert must not erase its context. |
| [Apple Maps parked car](https://support.apple.com/guide/iphone/get-directions-to-your-parked-car-ipha13ef1c2e/ios) | Parking detection uses car Bluetooth/CarPlay disconnection, location services, and vehicle-exit context. | Separate a passenger ride from driving one's own car. Keep existing parking on passenger rides. Do not equate a countdown reaching zero with leaving a car. |
| [Google Maps parking, Android](https://support.google.com/maps/answer/7257797?co=GENIE.Platform%3DAndroid&hl=en) | Offers manual parking saving and parking details. | Offer an explicit GPS capture button, a human-readable note, accuracy information, and a link for walking directions. |
| [Tasks.org location reminders](https://tasks.org/docs/location/) | Uses location permission and geofences to remind on arrival/departure. | Request location only for an action that needs it. Keep a text-note fallback when permission is declined. |
| [Google Keep / Tasks migration](https://support.google.com/tasks/answer/16540694?hl=en) | Current documentation says Keep location reminders are no longer available. | Do not base the product on obsolete comparisons or claim Keep still provides that behavior. |

## Implemented in the private web prototype

1. **Two explicit modes.** Simulation remains available for rapid testing. “Use on a ride” starts a real foreground countdown from a manual estimate.
2. **Time-based state survives a reload.** The real timer derives elapsed time from saved timestamps. It catches up when the page resumes; it does not count one callback as one second.
3. **Two-minute warning with ETA correction.** A changed estimate re-arms the warning when the updated arrival is more than two minutes away. Alert acknowledgement does not complete the ride-end reminder or collect belongings.
4. **Actual arrival requires confirmation.** An expired real estimate asks “Have you arrived?” Simulation still advances automatically for testing. This avoids marking a car as parked while stuck in traffic.
5. **Selectable alerts.** In-app alerts remain on. Sound, vibration, and phone notifications are opt-in. Phone notifications use a service worker where available; enabling them requires a user click. A test button checks the selected channels.
6. **Transport-aware parking.** Passenger rides preserve the previous parking spot. Car rides can save a location note. GPS capture occurs only after an explicit action, records reported accuracy, and stores coordinates locally.
7. **Home Screen metadata.** App manifest and icons support adding Boothy to a Home Screen on compatible browsers. This does not create an offline or locked-screen scheduling guarantee.
8. **Preserved interaction state.** Clock updates do not erase an open reminder/ETA draft. Denied location access keeps the previous spot. Dark-mode preferences and ride state remain separate.

## Important implementation boundaries

[MDN's Page Visibility documentation](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) describes timer throttling in hidden pages. A service worker is not a persistent timer process. The current web client can show system notifications when its code runs, but cannot promise a punctual two-minute notification after the browser is suspended, locked, or closed. The UI states that Boothy should remain open.

[MDN's Notifications guide](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API) recommends a user gesture for notification permission and persistent service-worker notifications on mobile. [WebKit's Home Screen web-push documentation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) documents Home Screen app requirements on iOS/iPadOS. There is no push server or scheduled backend in this version. The notification service worker does not cache private pages.

[Geolocation.getCurrentPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition) requires browser permission and may return an uncertain position or fail. Boothy records accuracy and offers notes rather than representing every fix as exact. [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) can open directions without a Maps API key. Only clicking that link sends the saved destination to Maps.

## Next product phase: native automatic ride detection

This is a reasoned implementation recommendation, not a claim that it is already built.

An Android-first MVP should use the [Activity Recognition Transition API](https://developer.android.com/develop/sensors-and-location/location/transitions) for vehicle/walking transitions, with explicit permissions and manual start/end fallback. A confirmed destination and a routing ETA source are still needed for an actual “two minutes before arrival” prediction. Activity detection alone does not know where the person intends to get off.

Proposed native flow: vehicle-enter candidate → confirm ride/destination → active ride → approaching destination → confirm arrival/vehicle exit → belongings check → parking saved for own-car mode. Combine several signals rather than triggering arrival from one brief stop. Test traffic stops, transfers, poor GPS, lost permissions, and battery restrictions before making reliability claims.

Acceptance criteria: the pre-arrival message contains the belongings and original reason; ETA changes do not duplicate old alerts unnecessarily; a passenger ride never overwrites the user's parking; a denied permission preserves manual operation; resume does not fabricate arrival; completed checks remain visible until the next ride.

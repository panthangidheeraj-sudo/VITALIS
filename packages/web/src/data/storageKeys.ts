/**
 * Every localStorage key this app writes, in one place.
 *
 * Settings' "remove all data stored on this device" used to carry its own
 * hand-written list of keys, and that list had drifted: it missed
 * `vitalis.ownerUid` — the per-browser identity that links this device to
 * its cases on the server — along with the notification state and the intro
 * flag. A privacy control that promises to remove everything and quietly
 * leaves the identifier behind is the one kind of drift that must not
 * happen, and it happened precisely because the list lived apart from the
 * stores that create the keys.
 *
 * Adding a new persisted key means adding it HERE; the clear-data button
 * reads this array rather than repeating it.
 */
export const VITALIS_STORAGE_KEYS = [
  // Health data the user entered.
  'vitalis.vitals.v1',
  'vitalis.medications.v1',
  'vitalis.profile.v1',
  // Emergency contacts' names and phone numbers — personal data about people
  // OTHER than the device owner, which is exactly why clearing device data
  // must not leave it behind either.
  'vitalis.contacts.v1',
  // Assistant conversations.
  'vitalis.chatSessions.v1',
  'vitalis.chatActiveSession.v1',
  // Device preferences and state.
  'vitalis.language.v1',
  'vitalis.notifications.enabled',
  'vitalis.notifications.firedToday',
  'vitalis.introShown.v1',
  // The anonymous per-browser id sent to the backend as `ownerUid`.
  'vitalis.ownerUid',
] as const;

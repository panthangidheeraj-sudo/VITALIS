/**
 * Browser-native medication reminder notifications.
 *
 * HONEST ABOUT WHAT THIS IS: there is no service worker and no push
 * subscription here, so this only fires while VITALIS is open in a browser
 * tab — it polls the reminder list every 30s and compares against the
 * clock. That is a real, stated limitation, not "notifications" in the
 * closed-tab/OS-push sense. Settings.tsx says this to the user in plain
 * words rather than implying more than the code delivers.
 *
 * Permission is requested ONLY from `requestPermission()`, called from an
 * explicit toggle the user clicks — never on page load, which is exactly
 * the pattern browsers penalize (auto-dismissed or auto-denied prompts).
 */

const ENABLED_KEY = 'vitalis.notifications.enabled';
const NOTIFIED_KEY = 'vitalis.notifications.firedToday';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export function isEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false');
  } catch {
    // Best-effort.
  }
}

/** Must be called from a user gesture (a click handler) — browsers ignore
 * or auto-deny permission requests made any other way. */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

/** "HH:MM" (24h) parsed loosely from free text like "8:00 AM" or "20:30".
 * Returns undefined for anything unparseable — those reminders still work
 * for manual taken/due tracking, they just can't be scheduled. */
export function parseTimeToMinutes(at: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(at.trim());
  if (match === null) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return undefined;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function todayKey(): string {
  return new Date().toDateString();
}

function firedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as { day?: string; ids?: readonly string[] });
    if (parsed.day !== todayKey()) return new Set();
    return new Set(parsed.ids ?? []);
  } catch {
    return new Set();
  }
}

function markFired(id: string): void {
  const set = firedSet();
  set.add(id);
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify({ day: todayKey(), ids: [...set] }));
  } catch {
    // Best-effort.
  }
}

/**
 * Checks the reminder list against the current time and fires at most one
 * `Notification` per reminder per calendar day (tracked in `firedSet`, keyed
 * by day so it naturally resets tomorrow — no separate cleanup needed). A
 * reminder that's been deleted from `reminders` since the last check simply
 * can never match here again, which is the entire "cancel" behavior for
 * this poll-based approach.
 */
export function checkDueReminders(reminders: readonly { readonly id: string; readonly name: string; readonly at: string; readonly takenToday: boolean }[]): void {
  if (getPermission() !== 'granted' || !isEnabled()) return;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const fired = firedSet();

  for (const r of reminders) {
    if (r.takenToday || fired.has(r.id)) continue;
    const target = parseTimeToMinutes(r.at);
    if (target === undefined) continue;
    // A 2-minute window: the check runs every 30s, but the tab could be
    // backgrounded and throttled by the browser, so a 1-minute-wide catch
    // is not reliable — 2 minutes is generous without risking firing twice
    // for the same reminder on two different days.
    if (nowMinutes >= target && nowMinutes <= target + 2) {
      new Notification('VITALIS — medication reminder', {
        body: `${r.name} — due ${r.at}`,
        tag: `vitalis-med-${r.id}`,
      });
      markFired(r.id);
    }
  }
}

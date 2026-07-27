/**
 * Helpers for the `HH:MM:SS` times the booking form stores (`defaultCheckInTime`
 * / `defaultCheckOutTime`, matching the DB `time` columns and the zod regex in
 * `signupFormSchema`), versus the `HH:MM` or `HH:MM:SS` an `<input type="time">`
 * actually emits.
 *
 * The form used to build its stored value by appending `":00"` to whatever the
 * control gave back. Chrome renders a seconds segment whenever the value it was
 * given has one (the form seeds "16:00:00"), so `onChange` returned "15:00:00"
 * and the stored value became "15:00:00:00" — which fails validation, turns the
 * field red, blocks the step, and renders as an empty control on the way back.
 */

const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * Normalizes an `<input type="time">` value to `HH:MM:SS`.
 * Returns "" for an empty or unparseable value (the control is cleared, and
 * validation reports a missing time rather than silently keeping a stale one).
 */
export function toTimeOfDay(inputValue: string): string {
  const match = TIME_OF_DAY.exec(inputValue.trim());
  if (!match) return "";

  const [, hours, minutes, seconds = "00"] = match;
  return `${hours.padStart(2, "0")}:${minutes}:${seconds}`;
}

/**
 * Renders a stored `HH:MM:SS` as the `HH:MM` an `<input type="time">` expects,
 * so the control never shows a seconds segment (and never round-trips one back).
 */
export function toTimeInputValue(stored: string | undefined | null): string {
  if (!stored) return "";

  const match = TIME_OF_DAY.exec(stored.trim());
  if (!match) return "";

  const [, hours, minutes] = match;
  return `${hours.padStart(2, "0")}:${minutes}`;
}

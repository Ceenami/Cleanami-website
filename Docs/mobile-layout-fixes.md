# Mobile dashboard form alignment

The property time help text sits outside the field columns. Property size,
laundry and time fields stack on phones; wider layouts align the controls even
when a label wraps. Shared cards shrink correctly and use smaller phone padding.
Native date/time inputs and other editable controls have bounded widths, 16px
phone text and a minimum 44px height. Hidden uploads and checkbox sizing retain
their existing behavior.

Related fixes cover:

- Property details/editing and the customer property summary/request card.
- Add-property and create-job dialogs: bounded dynamic viewport height, internal
  scrolling, full-width phone actions and usable close targets. The pinned
  add-property heading has scroll clearance for the fields below it.
- Cleaner hierarchy: long names wrap, role controls fit, and add/remove/save
  actions remain reachable.
- Checklist management: a phone list replaces the wide table on small screens;
  long filenames wrap and file actions have usable targets. The table remains on
  larger screens. Link input and action stack on phones.
- Customer contact editing and extra-clean booking: long details wrap and form
  controls fit the screen.

This changes presentation only. Existing ownership/role checks, server actions,
request payloads, booking rules and pricing behavior are retained. It adds no
database migration.

Verification uses the actual React components and built production stylesheet,
with synthetic API/action/router substitutes. Viewport widths: 320, 390, 430,
768, 1024 and 1440px; dialogs also checked at 390 × 480px. The checks exercise
property save, roster add/save, checklist-link action, dialog close, hidden upload
sizing, control bounds, phone font size and alignment. All 150 Chromium checks
passed. Typecheck, changed-file lint (zero warnings) and the production Next build
also passed. The build retains unrelated baseline warnings.

Windows WebKit verification was attempted, but its browser runtime closed during
navigation; it did not produce a passing suite. Physical iPhone keyboard and
browser-toolbar behavior still need a device check.

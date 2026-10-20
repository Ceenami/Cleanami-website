const { spawnSync } = require("node:child_process");
const path = require("node:path");
if (!process.env.EXECUTION_TZ_CHILD) {
  for (const tz of ["UTC", "America/New_York", "Asia/Kolkata"]) {
    const run = spawnSync(process.execPath, [__filename], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, TZ: tz, EXECUTION_TZ_CHILD: "1" },
      encoding: "utf8",
    });
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    if (run.status) process.exit(run.status ?? 1);
  }
} else {
  process.env.TSX_TSCONFIG_PATH = path.join(__dirname, "../tsconfig.json");
  require("tsx/cjs");
  const assert = require("node:assert/strict"),
    ical = require("node-ical");
  const {
    rentalSchedule,
    easternInstant,
    calendarDay,
  } = require("../lib/jobs/execution-policy.ts");
  const dates = [
    ["20261022", "20261023", "2026-10-23T14:00:00.000Z"],
    ["20261031", "20261101", "2026-11-01T15:00:00.000Z"],
    ["20270313", "20270314", "2027-03-14T14:00:00.000Z"],
  ];
  for (const [start, end, expected] of dates) {
    const event = ical.sync.parseICS(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:stable\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    ).stable;
    const first = rentalSchedule(event, undefined, {
      defaultCheckOutTime: "10:00:00",
      defaultCheckInTime: "16:00:00",
    });
    assert.equal(first.start.toISOString(), expected);
    assert.equal(
      calendarDay(event.end),
      `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6)}`,
    );
    const changed = rentalSchedule(event, undefined, {
      defaultCheckOutTime: "11:00:00",
      defaultCheckInTime: "17:00:00",
    });
    assert.equal(+changed.start - +first.start, 3600000);
    assert.equal(+changed.deadline - +first.deadline, 3600000);
  }
  const explicit = {
    end: new Date("2026-10-23T15:45:00Z"),
    datetype: "date-time",
  };
  assert.equal(
    rentalSchedule(explicit, undefined, {
      defaultCheckOutTime: "10:00",
    }).start.toISOString(),
    explicit.end.toISOString(),
  );
  const next = {
    start: new Date("2026-10-23T18:00:00Z"),
    datetype: "date-time",
  };
  assert.equal(
    rentalSchedule(explicit, next, {}).deadline.toISOString(),
    next.start.toISOString(),
  );
  assert.throws(() => easternInstant("2027-03-14", "02:30"), /does not exist/);
  assert.throws(() => easternInstant("2026-11-01", "01:30"), /Ambiguous/);
  assert.throws(() => easternInstant("2026-10-22", "25:00"), /Invalid/);
  console.log(
    `PASS timezone ${process.env.TZ}: parsed DATE, defaults, explicit feed, next guest, DST gap/fold`,
  );
}

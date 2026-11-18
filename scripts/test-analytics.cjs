const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
let checks = 0;
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
function compile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const analytics = compile("lib/analytics.ts");
function setup({ host = "cleannami.com", mode = "production", storage = new Map(), contactLabel, noWindow = false, throwing = false } = {}) {
  const window = {
    location: { hostname: host },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  if (throwing) window.gtag = () => { throw new Error("blocked tag"); };
  const exports = {};
  vm.runInNewContext(analytics, {
    exports, ...(noWindow ? {} : { window }),
    process: { env: { NODE_ENV: mode, NEXT_PUBLIC_GOOGLE_ADS_CONTACT_LABEL: contactLabel } },
  });
  return { api: exports, window, events: () => (window.dataLayer ?? []).map(command => Array.from(command)).filter(command => command[0] === "event") };
}
for (const host of ["cleannami.com", "www.cleannami.com", "cleannami.ceenami.com", "CLEANNAMI.COM"]) {
  check(`production initialization and early click: ${host}`, () => {
    const { api, window, events } = setup({ host });
    api.trackBookingStart();
    assert.equal(events()[0][2].send_to, "AW-17499794760/NY5gCKPU594bEMjaxphB");
    assert.equal(events()[1][1], "booking_form_open");
    assert.equal(events()[1][2].send_to, "G-43JSM385K7");
    const initializedLength = window.dataLayer.length;
    api.initializeGoogleTracking();
    assert.equal(window.dataLayer.length, initializedLength);
    assert.deepEqual(Array.from(window.dataLayer[0]).slice(0, 1), ["js"]);
  });
}
for (const options of [
  { host: "localhost" }, { host: "127.0.0.1" }, { host: "cleannami.com.attacker.example" },
  { host: "phase3a-test--sensational-crepe-5b0e1a.netlify.app" },
  { host: "deploy-preview-1--sensational-crepe-5b0e1a.netlify.app" },
  { mode: "development" }, { noWindow: true },
]) {
  check(`no live tracking: ${JSON.stringify(options)}`, () => {
    const { api, events } = setup(options);
    api.trackBookingStart(); api.trackAppointmentClick(); api.trackContactClick("phone");
    api.trackPaidBooking({ transactionId: "pi_123", amountCents: 100 });
    assert.equal(events().length, 0);
  });
}
check("calendar click is separate from completed appointment/purchase", () => {
  const { api, events } = setup(); api.trackAppointmentClick();
  assert.equal(events()[0][2].send_to, "AW-17499794760/nbASCOrI5N4bEMjaxphB");
  assert.equal(events()[1][1], "book_appointment_click");
  assert.equal(events().length, 2);
});
check("verified default Contact action is distinct from Purchase", () => {
  const { api, events } = setup(); api.trackContactClick("email");
  assert.equal(events()[0][2].send_to, "AW-17499794760/wQ47CITTlskbEMjaxphB");
  assert.equal(events()[1][1], "contact_click");
  api.trackPaidBooking({ transactionId: "pi_actual_purchase", amountCents: 100 });
  assert.equal(events()[2][2].send_to, "AW-17499794760/zER5CNvZ0YsbEMjaxphB");
});
for (const contactLabel of ["", "AW-123/wrong", "label with spaces"]) {
  check(`unknown/invalid Contact label never emits Ads conversion: ${contactLabel}`, () => {
    const { api, events } = setup({ contactLabel }); api.trackContactClick("email");
    assert.equal(events().length, 1);
    assert.equal(events()[0][1], "contact_click");
    assert.equal(events()[0][2].contact_method, "email");
    assert.equal(JSON.stringify(events()).includes("@"), false);
  });
}
check("configured Contact action, no contact identifiers", () => {
  const { api, events } = setup({ contactLabel: "verified_label-123" }); api.trackContactClick("phone");
  assert.equal(events()[0][2].send_to, "AW-17499794760/verified_label-123");
  assert.deepEqual(Object.keys(events()[1][2]).sort(), ["contact_method", "send_to"]);
  api.trackContactClick("invalid"); assert.equal(events().length, 2);
});
const paid = { transactionId: "pi_real_identity", amountCents: 12345 };
check("accurate paid amount, stable action/identity, duplicate suppression", () => {
  const { api, events } = setup(); api.trackPaidBooking(paid); api.trackPaidBooking(paid);
  assert.equal(events().length, 1);
  assert.equal(events()[0][2].value, 123.45);
  assert.equal(events()[0][2].currency, "USD");
  assert.equal(events()[0][2].transaction_id, paid.transactionId);
  assert.equal(events()[0][2].send_to, "AW-17499794760/zER5CNvZ0YsbEMjaxphB");
  api.trackPaidBooking({ ...paid, transactionId: "pi_second_purchase" }); assert.equal(events().length, 2);
});
check("purchase replay across page reload is suppressed within tab", () => {
  const storage = new Map(); setup({ storage }).api.trackPaidBooking(paid);
  const second = setup({ storage }); second.api.trackPaidBooking(paid);
  assert.equal(second.events().length, 0);
  assert.equal([...storage.values()].join("").includes("12345"), false);
});
check("blocked/corrupt storage preserves conversion and in-memory suppression", () => {
  for (const storage of [
    { get: () => "malformed json", set: () => {} },
    { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); } },
  ]) {
    const { api, events } = setup({ storage });
    api.trackPaidBooking(paid); api.trackPaidBooking(paid); assert.equal(events().length, 1);
  }
});
check("invalid payment payloads do not emit", () => {
  const { api, events } = setup();
  for (const value of [null, {}, { ...paid, amountCents: 0 }, { ...paid, amountCents: -1 },
    { ...paid, amountCents: 1.5 }, { ...paid, amountCents: Infinity },
    { ...paid, amountCents: "100" }, { ...paid, transactionId: "person@example.com" }]) api.trackPaidBooking(value);
  assert.equal(events().length, 0);
});
check("throwing tag cannot break customer interactions", () => {
  const { api } = setup({ throwing: true });
  assert.doesNotThrow(() => { api.trackBookingStart(); api.trackAppointmentClick(); api.trackContactClick("phone"); api.trackPaidBooking(paid); });
});
check("event transport failure after initialization does not mark paid event sent", () => {
  const { api, window, events } = setup(); api.initializeGoogleTracking();
  const queue = window.gtag;
  window.gtag = () => { throw new Error("transport failure"); };
  assert.doesNotThrow(() => { api.trackBookingStart(); api.trackAppointmentClick(); api.trackContactClick("email"); api.trackPaidBooking(paid); });
  window.gtag = queue;
  api.trackPaidBooking(paid); assert.equal(events().length, 1);
});
check("purchase history remains bounded and contains transaction IDs only", () => {
  const storage = new Map(), { api } = setup({ storage });
  for (let index = 0; index < 270; index++) api.trackPaidBooking({ transactionId: `pi_${index}`, amountCents: 100 });
  const history = JSON.parse([...storage.values()][0]);
  assert.equal(history.length, 256); assert.equal(history[0], "pi_14"); assert.equal(history[255], "pi_269");
});
check("calendar navigation and callback survive a failing tag", () => {
  const { api } = setup({ throwing: true });
  let opened = 0, callback = 0;
  const exports = {};
  vm.runInNewContext(compile("components/FounderCard.tsx"), { exports,
    window: { open: () => opened++ }, require: id => {
      if (id === "@/lib/analytics") return api;
      if (id === "react/jsx-runtime") return require(id);
      if (id === "next/image") return { default: "img" };
      if (id === "lucide-react") return { Calendar: "span", ArrowRight: "span" };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const tree = exports.FounderCard({ onBookCall: () => callback++, onContinue: () => {} });
  function buttons(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(buttons);
    return [...(node.type === "button" ? [node] : []), ...buttons(node.props?.children)];
  }
  buttons(tree)[0].props.onClick();
  assert.equal(opened, 1); assert.equal(callback, 1);
});
check("contact link keeps browser default navigation and cancellation", () => {
  let calls = 0;
  const exports = {};
  vm.runInNewContext(compile("components/ContactLink.tsx"), { exports, require: id => {
    if (id === "@/lib/analytics") return { trackContactClick: () => calls++ };
    if (id === "react/jsx-runtime") return require(id);
    throw new Error(`Unexpected import ${id}`);
  } });
  const link = exports.ContactLink({ contactMethod: "email", href: "mailto:example@example.com", children: "Email" });
  const event = { defaultPrevented: false };
  link.props.onClick(event);
  assert.equal(calls, 1); assert.equal(event.defaultPrevented, false); assert.equal(link.props.href, "mailto:example@example.com");
  exports.ContactLink({ contactMethod: "phone", onClick: e => { e.defaultPrevented = true; } }).props.onClick({ defaultPrevented: false });
  assert.equal(calls, 1);
});
console.log(`${checks} analytics checks passed; no network or database used.`);

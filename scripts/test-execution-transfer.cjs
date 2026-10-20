// Transport regressions with a fake TUS stack; hosted Storage acceptance is separate.
const path = require("node:path"),
  Module = require("node:module"),
  assert = require("node:assert/strict");
const esbuild = require("node:module").createRequire(require.resolve("tsx"))(
  "esbuild",
);
let jwt = "synthetic-cleaner-jwt",
  options,
  created = 0,
  aborted = 0;
class Upload {
  constructor(blob, config) {
    options = config;
    created++;
    this.blob = blob;
  }
  async findPreviousUploads() {
    return [];
  }
  resumeFromPreviousUpload() {}
  abort() {
    aborted++;
    return Promise.resolve();
  }
  start() {
    const underlying = { timeout: 0 };
    options.onBeforeRequest({ getUnderlyingObject: () => underlying });
    assert.equal(underlying.timeout, 45000);
    options.onProgress(this.blob.size, this.blob.size);
    options.onSuccess();
  }
}
global.transport = {
  Upload,
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: jwt ? { access_token: jwt } : null },
      }),
    },
  }),
  accessToken: async () => jwt,
  cleanerApi: { get: async () => ({}), post: async () => ({}) },
};
(async () => {
  const bundle = await esbuild.build({
    entryPoints: [path.join(__dirname, "../lib/cleaner/execution-transfer.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    plugins: [
      {
        name: "transport-adapters",
        setup(build) {
          build.onResolve(
            { filter: /tus-js-client|supabase\/client|cleaner-api/ },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const Upload=globalThis.transport.Upload; export const createClient=globalThis.transport.createClient; export const accessToken=globalThis.transport.accessToken; export const cleanerApi=globalThis.transport.cleanerApi;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = new Module(__filename);
  module._compile(bundle.outputFiles[0].text, __filename);
  const { transferPhoto } = module.exports;
  const reservation = {
    verified: false,
    path: "cleaner/job/issued/stable.jpg",
    token: "synthetic-signed-path-token",
    endpoint: "https://storage.invalid/upload/resumable",
    bucket: "evidence-photos",
  };
  let progress = 0;
  await transferPhoto(
    new Blob(["image"], { type: "image/jpeg" }),
    reservation,
    (p) => (progress = p),
    new AbortController().signal,
  );
  assert.equal(options.headers.authorization, "Bearer synthetic-cleaner-jwt");
  assert.equal(options.headers["x-signature"], reservation.token);
  assert.equal(options.headers["x-upsert"], undefined);
  assert.equal(await options.fingerprint(), "execution:" + reservation.path);
  assert.equal(progress, 100);
  assert.equal(options.chunkSize, 6 * 1024 * 1024);
  console.log(
    "PASS signed TUS includes fresh cleaner JWT, stable identity, no overwrite and bounded request timeout",
  );
  const count = created;
  jwt = null;
  await assert.rejects(
    () =>
      transferPhoto(
        new Blob(["image"]),
        reservation,
        () => {},
        new AbortController().signal,
      ),
    /Sign in/,
  );
  assert.equal(created, count);
  console.log(
    "PASS missing session retains local evidence instead of starting an unauthenticated transfer",
  );
  jwt = "another-fresh-token";
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      transferPhoto(
        new Blob(["image"]),
        reservation,
        () => {},
        controller.signal,
      ),
    /Sign in/,
  );
  assert.equal(created, count);
  console.log("PASS account/logout cancellation prevents a new transfer");
  await transferPhoto(
    new Blob(["image"]),
    { ...reservation, verified: true },
    () => {},
    new AbortController().signal,
  );
  assert.equal(created, count);
  console.log("PASS acknowledged upload retries do not resend bytes");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

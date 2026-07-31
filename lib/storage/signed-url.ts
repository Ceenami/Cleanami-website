import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

// Buckets that hold non-public files. They are set `public = false` by
// migration 0013 and served exclusively through short-lived signed URLs minted
// server-side with the service role. Never call getPublicUrl on these.
export const EVIDENCE_BUCKET = "evidence-photos";
export const CHECKLISTS_BUCKET = "checklists";
export const PRICING_BUCKET = "pricing-files";

// One hour is plenty for a page view / opening a file in a new tab, and short
// enough that a leaked URL expires quickly.
const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Normalize a stored value to a storage object key so it can be signed.
 *
 * New rows store the object path directly. Rows written while the buckets were
 * public store a full URL (`.../object/public/<bucket>/<path>`); strip that
 * prefix so legacy rows keep working after the bucket goes private. Anything
 * that is neither is assumed to already be a path and returned unchanged.
 */
export function toStoragePath(bucket: string, value: string): string {
  const marker = `/object/public/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx !== -1) {
    // The path segment of a public URL is percent-encoded.
    return decodeURIComponent(value.slice(idx + marker.length));
  }
  return value;
}

/** Mint a signed URL for a single stored value. Returns null on failure. */
export async function createSignedUrl(
  bucket: string,
  value: string,
  expiresIn: number = DEFAULT_TTL_SECONDS
): Promise<string | null> {
  const supabase = createAdminClient();
  const path = toStoragePath(bucket, value);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data) {
    console.error(`[signed-url] ${bucket}/${path}`, error);
    return null;
  }
  return data.signedUrl;
}

/**
 * Which of `values` do not exist as objects in `bucket`.
 *
 * Signing is the existence probe: `createSignedUrls` returns a per-path error
 * for anything it cannot resolve, so one round-trip answers for the whole set
 * without a `list` call per directory.
 *
 * Used to stop a caller asserting evidence it never uploaded — the API records
 * client-supplied object paths, and nothing else checks that they are real.
 */
export async function findMissingObjects(
  bucket: string,
  values: string[]
): Promise<string[]> {
  if (values.length === 0) return [];

  const supabase = createAdminClient();
  const paths = values.map((value) => toStoragePath(bucket, value));
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, 60);

  // Fail closed: if the probe itself broke we cannot prove the objects exist.
  if (error || !data) {
    console.error(`[signed-url] existence probe ${bucket}`, error);
    return values;
  }

  const missing: string[] = [];
  data.forEach((entry, i) => {
    if (!entry.signedUrl) missing.push(values[i]);
  });
  return missing;
}

/**
 * Mint signed URLs for many stored values in one round-trip. The returned array
 * is index-aligned with the input; any entry that fails to sign is null.
 */
export async function createSignedUrls(
  bucket: string,
  values: string[],
  expiresIn: number = DEFAULT_TTL_SECONDS
): Promise<(string | null)[]> {
  if (values.length === 0) return [];

  const supabase = createAdminClient();
  const paths = values.map((value) => toStoragePath(bucket, value));
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (error || !data) {
    console.error(`[signed-url] batch ${bucket}`, error);
    return values.map(() => null);
  }

  // createSignedUrls preserves input order and returns a per-path error field.
  return data.map((entry) => entry.signedUrl ?? null);
}

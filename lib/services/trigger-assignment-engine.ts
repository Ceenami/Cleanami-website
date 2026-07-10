import "server-only";

/** Invoke the Supabase job-assignment-engine edge function (same as nightly sync). */
export async function triggerAssignmentEngine(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("[triggerAssignmentEngine] Missing Supabase env vars");
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/job-assignment-engine`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    const result = await response.json();
    if (!result?.success) {
      console.error(
        "[triggerAssignmentEngine] Engine returned failure:",
        result?.error ?? response.status
      );
    }
  } catch (error) {
    console.error("[triggerAssignmentEngine] Request failed:", error);
  }
}

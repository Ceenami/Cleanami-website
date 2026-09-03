"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResidentialFormData } from "@/lib/validations/residential";
import {
  normalizeResidentialFormData,
  serializeResidentialFormForServer,
} from "@/lib/validations/residential/serialize";
import {
  SESSION_SERVICE_TYPE_KEY,
  readSessionServiceType,
} from "@/lib/validations/booking-session";

/**
 * Session persistence for the residential wizard.
 *
 * It talks to the **same** `/api/onboarding/session` route the vacation-rental
 * wizard uses, and stores into the same `onboarding_sessions.form_data` jsonb
 * column. No migration: the column is a blob, and both its serialisers spread
 * unknown keys rather than whitelisting, which was checked before this was
 * written rather than assumed.
 *
 * It is a separate hook rather than a generic over `useSessionPersistence` for
 * one reason: that hook revives `firstCleanDate` into a `Date` on the way in
 * and flattens it on the way out, machinery the residential form has no use for
 * because its date is a `YYYY-MM-DD` string end to end. Sharing it would mean
 * casting `ResidentialFormData` through `SignupFormData`, which is exactly the
 * shortcut that lets the two flows start overwriting each other.
 *
 * `serviceType` lives inside `form_data`, so a resumed session lands back in
 * the wizard it came from.
 */
/** What comes back from the shared session route: the form plus the routing key. */
type StoredResidentialForm = ResidentialFormData & Record<string, unknown>;

interface SessionSnapshot {
  success: boolean;
  sessionId?: string;
  currentStep?: number;
  formData?: StoredResidentialForm;
  error?: string;
}

async function apiSession(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: object
): Promise<SessionSnapshot> {
  try {
    const res = await fetch("/api/onboarding/session", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as SessionSnapshot;
    return {
      ...json,
      formData: json.formData
        ? (normalizeResidentialFormData(json.formData) as StoredResidentialForm)
        : undefined,
    };
  } catch {
    return { success: false };
  }
}

export function useResidentialSession(options: {
  debounceMs?: number;
  onSessionLoaded?: (data: {
    formData: ResidentialFormData;
    currentStep: number;
  }) => void;
}) {
  const { debounceMs = 1500, onSessionLoaded } = options;

  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [hasExistingSession, setHasExistingSession] = useState(false);
  const [existingSessionData, setExistingSessionData] =
    useState<SessionSnapshot | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedRef = useRef(false);
  const onSessionLoadedRef = useRef(onSessionLoaded);

  useEffect(() => {
    onSessionLoadedRef.current = onSessionLoaded;
  }, [onSessionLoaded]);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    void (async () => {
      setIsLoadingSession(true);
      const loaded = await apiSession("GET");
      // Only offer to resume a session that is actually a residential one. A
      // vacation-rental session belongs to the other wizard, and offering to
      // "continue" it here would drop the customer into a form full of fields
      // that no longer exist.
      if (
        loaded.success &&
        readSessionServiceType(loaded.formData) === "residential_one_time"
      ) {
        setHasExistingSession(true);
        setExistingSessionData(loaded);
      } else if (!loaded.success) {
        await apiSession("POST");
      }
      setIsLoadingSession(false);
    })();
  }, []);

  const acceptExistingSession = useCallback(() => {
    if (existingSessionData?.success) {
      onSessionLoadedRef.current?.({
        formData: existingSessionData.formData ?? {},
        currentStep: existingSessionData.currentStep ?? 1,
      });
      setHasExistingSession(false);
    }
  }, [existingSessionData]);

  const startFreshSession = useCallback(async () => {
    await apiSession("DELETE", {});
    await apiSession("POST");
    setHasExistingSession(false);
    setExistingSessionData(null);
  }, []);

  const doSave = useCallback(
    async (formData: ResidentialFormData, currentStep: number) => {
      await apiSession("PATCH", {
        formData: {
          ...serializeResidentialFormForServer(formData),
          // The routing key. Written on every save so a session abandoned
          // before step 1 still knows which wizard it belongs to.
          [SESSION_SERVICE_TYPE_KEY]: "residential_one_time",
        },
        currentStep,
        priceDetails: null,
      });
    },
    []
  );

  const saveProgress = useCallback(
    (formData: ResidentialFormData, currentStep: number) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void doSave(formData, currentStep);
      }, debounceMs);
    },
    [debounceMs, doSave]
  );

  const saveProgressNow = useCallback(
    async (formData: ResidentialFormData, currentStep: number) => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      await doSave(formData, currentStep);
    },
    [doSave]
  );

  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    []
  );

  return {
    isLoadingSession,
    hasExistingSession,
    existingSessionData,
    acceptExistingSession,
    startFreshSession,
    saveProgress,
    saveProgressNow,
  };
}

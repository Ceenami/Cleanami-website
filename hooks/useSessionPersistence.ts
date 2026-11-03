"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { hasSavedBookingProgress } from "@/lib/validations/booking-session";
import {
  reviveSignupFormDataFromJson,
  serializeSignupFormDataForServer,
  type SerializableSignupFormData,
} from "@/lib/validations/bookng-modal/serialize-signup-form";

interface SessionData {
  success: boolean;
  sessionId?: string;
  currentStep?: number;
  formData?: Partial<SignupFormData>;
  priceDetails?: PriceDetails | null;
  error?: string;
}

interface UseSessionPersistenceOptions {
  debounceMs?: number;
  skipInitialLoad?: boolean;
  onSessionLoaded?: (data: {
    formData: Partial<SignupFormData>;
    currentStep: number;
    priceDetails: PriceDetails | null;
  }) => void;
}

interface UseSessionPersistenceReturn {
  isLoadingSession: boolean;
  hasExistingSession: boolean;
  existingSessionData: SessionData | null;
  acceptExistingSession: () => void;
  startFreshSession: () => Promise<void>;
  saveProgress: (
    formData: Partial<SignupFormData>,
    currentStep: number,
    priceDetails: PriceDetails | null
  ) => void;
  saveProgressNow: (
    formData: Partial<SignupFormData>,
    currentStep: number,
    priceDetails: PriceDetails | null
  ) => Promise<boolean>;
  sessionId: string | null;
}

async function apiSession(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: object
): Promise<SessionData> {
  try {
    const res = await fetch("/api/onboarding/session", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json()) as Omit<SessionData, "formData"> & {
      formData?: Partial<SerializableSignupFormData>;
    };

    // JSON has no Date type — rebuild `firstCleanDate` before it reaches form
    // state, or a resumed booking cannot get past the subscription step.
    return {
      ...json,
      formData: reviveSignupFormDataFromJson(json.formData),
    };
  } catch {
    return { success: false };
  }
}

export function useSessionPersistence(
  options: UseSessionPersistenceOptions = {}
): UseSessionPersistenceReturn {
  const { debounceMs = 1000, onSessionLoaded, skipInitialLoad = false } = options;

  const [isLoadingSession, setIsLoadingSession] = useState(!skipInitialLoad);
  const [hasExistingSession, setHasExistingSession] = useState(false);
  const [existingSessionData, setExistingSessionData] =
    useState<SessionData | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedRef = useRef(false);
  const onSessionLoadedRef = useRef(onSessionLoaded);

  useEffect(() => {
    onSessionLoadedRef.current = onSessionLoaded;
  }, [onSessionLoaded]);

  // Load or create session on mount
  useEffect(() => {
    if (hasInitializedRef.current || skipInitialLoad) return;
    hasInitializedRef.current = true;

    async function init() {
      setIsLoadingSession(true);
      const loaded = await apiSession("GET");

      if (loaded.success && hasSavedBookingProgress(loaded)) {
        setHasExistingSession(true);
        setExistingSessionData(loaded);
        setSessionId(loaded.sessionId ?? null);
      } else if (!loaded.success) {
        const created = await apiSession("POST");
        if (created.success) {
          setSessionId(created.sessionId ?? null);
        }
      }

      setIsLoadingSession(false);
    }

    init();
  }, [skipInitialLoad]);

  const acceptExistingSession = useCallback(() => {
    if (existingSessionData?.success) {
      onSessionLoadedRef.current?.({
        formData: existingSessionData.formData ?? {},
        currentStep: existingSessionData.currentStep ?? 1,
        priceDetails: existingSessionData.priceDetails ?? null,
      });
      setHasExistingSession(false);
    }
  }, [existingSessionData]);

  const startFreshSession = useCallback(async () => {
    await apiSession("DELETE");
    const created = await apiSession("POST");
    if (created.success) {
      setSessionId(created.sessionId ?? null);
    }
    setHasExistingSession(false);
    setExistingSessionData(null);
  }, []);

  const doSave = useCallback(
    async (
      formData: Partial<SignupFormData>,
      currentStep: number,
      priceDetails: PriceDetails | null
    ) => {
      const result = await apiSession("PATCH", {
        formData: serializeSignupFormDataForServer(formData as SignupFormData),
        currentStep,
        priceDetails,
      });
      return result.success;
    },
    []
  );

  const saveProgress = useCallback(
    (
      formData: Partial<SignupFormData>,
      currentStep: number,
      priceDetails: PriceDetails | null
    ) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void doSave(formData, currentStep, priceDetails);
      }, debounceMs);
    },
    [debounceMs, doSave]
  );

  const saveProgressNow = useCallback(
    async (
      formData: Partial<SignupFormData>,
      currentStep: number,
      priceDetails: PriceDetails | null
    ) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      return doSave(formData, currentStep, priceDetails);
    },
    [doSave]
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    isLoadingSession,
    hasExistingSession,
    existingSessionData,
    acceptExistingSession,
    startFreshSession,
    saveProgress,
    saveProgressNow,
    sessionId,
  };
}

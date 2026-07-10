"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { SignupFormData, PriceDetails } from "@/lib/validations/bookng-modal";
import { serializeSignupFormDataForServer } from "@/lib/validations/bookng-modal/serialize-signup-form";

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
  ) => Promise<void>;
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
    });
    return (await res.json()) as SessionData;
  } catch {
    return { success: false };
  }
}

export function useSessionPersistence(
  options: UseSessionPersistenceOptions = {}
): UseSessionPersistenceReturn {
  const { debounceMs = 1000, onSessionLoaded } = options;

  const [isLoadingSession, setIsLoadingSession] = useState(true);
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
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    async function init() {
      setIsLoadingSession(true);
      const loaded = await apiSession("GET");

      if (loaded.success) {
        setHasExistingSession(true);
        setExistingSessionData(loaded);
        setSessionId(loaded.sessionId ?? null);
      } else {
        const created = await apiSession("POST");
        if (created.success) {
          setSessionId(created.sessionId ?? null);
        }
      }

      setIsLoadingSession(false);
    }

    init();
  }, []);

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
      await apiSession("PATCH", {
        formData: serializeSignupFormDataForServer(formData as SignupFormData),
        currentStep,
        priceDetails,
      });
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
      await doSave(formData, currentStep, priceDetails);
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

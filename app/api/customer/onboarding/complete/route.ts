import { NextRequest, NextResponse } from "next/server";
import { completeOnboardingForPayment } from "@/lib/services/complete-onboarding.service";
import {
  deserializeSignupFormDataFromServer,
  SerializableSignupFormData,
} from "@/lib/validations/bookng-modal/serialize-signup-form";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let paymentIntentId: string | null = null;
    let formDataJson: string | null = null;
    let checklistFiles: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const data = await request.formData();
      paymentIntentId = data.get("paymentIntentId")?.toString() ?? null;
      formDataJson = data.get("formData")?.toString() ?? null;
      checklistFiles = data
        .getAll("checklistFiles")
        .filter((entry): entry is File => entry instanceof File);
    } else {
      const json = (await request.json()) as {
        paymentIntentId?: string;
        formData?: SerializableSignupFormData;
      };
      paymentIntentId = json.paymentIntentId ?? null;
      formDataJson = json.formData ? JSON.stringify(json.formData) : null;
    }

    if (!paymentIntentId || !formDataJson) {
      return NextResponse.json(
        { error: "Missing payment or booking details." },
        { status: 400 }
      );
    }

    const parsedFormData = JSON.parse(formDataJson) as SerializableSignupFormData;
    const formData = deserializeSignupFormDataFromServer(parsedFormData);

    if (checklistFiles.length > 0) {
      formData.checklistFile = checklistFiles;
    }

    const result = await completeOnboardingForPayment(
      formData,
      paymentIntentId
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/customer/onboarding/complete]", error);
    return NextResponse.json(
      { error: "Could not finalize your subscription. Please contact support." },
      { status: 500 }
    );
  }
}

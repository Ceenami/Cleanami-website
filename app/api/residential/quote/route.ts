import { NextRequest, NextResponse } from "next/server";
import { toPublicResidentialQuote } from "@/lib/pricing/residential";
import { evaluateResidentialSale } from "@/lib/pricing/residential-sales";

/**
 * Live price + refusal for the residential wizard.
 *
 * The vacation-rental form asks `/api/pricing` for a number and decides for
 * itself whether to show a custom-quote card. Residential cannot work that way:
 * "Can we sell this?" is a bigger question than "what does it cost?" — a
 * 5 bed / 5 bath home prices fine and is
 * staffing-custom. So the server answers both at once, and the form renders
 * whichever it gets back.
 *
 * Returns a price with 200, or a refusal with 200 and `refused: true`. A
 * refusal is a normal outcome of a quote, not an error — a 4xx here would make
 * the form's fetch treat "we cannot clean this home" as a network failure and
 * keep showing a stale price.
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const result = evaluateResidentialSale(body);

    if (!result.ok) {
      return NextResponse.json({
        refused: true,
        reason: result.reason,
        message: result.error,
      });
    }

    const quote = toPublicResidentialQuote(result.terms);
    if (quote.arrivalWindowKeys.length === 0) {
      return NextResponse.json({
        refused: true,
        reason: "no_window",
        message:
          "This clean cannot finish within our working day. Please contact CleanNami for a custom quote.",
      });
    }
    return NextResponse.json(quote);
  } catch (error) {
    console.error("[POST /api/residential/quote]", error);
    return NextResponse.json(
      { error: "Failed to calculate price" },
      { status: 500 },
    );
  }
}

import "server-only";
/** Only deliberate application messages cross the portal boundary. Driver and
 * provider exceptions can contain SQL parameters, identifiers or secrets. */
export class RentalFinanceError extends Error {
  constructor(message: string) { super(message); this.name = "RentalFinanceError"; }
}
export const financeErrorMessage = (error: unknown, fallback = "Financial action needs review. Reload its recorded status before retrying.") =>
  error instanceof RentalFinanceError ? error.message : fallback;

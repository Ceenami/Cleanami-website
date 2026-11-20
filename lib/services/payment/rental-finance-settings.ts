import "server-only";
import { RentalFinanceError } from "./rental-finance-error";
export const RENTAL_FINANCE_POLICY = "property_prepaid_separate_fee_v1";
export const rentalFinanceReady = () => process.env.RENTAL_FINANCE_SCHEMA_READY === "true";
export function newRentalFinancePolicy() {
  if (process.env.RENTAL_FINANCE_ENROLLMENT !== "true") return undefined;
  if (!rentalFinanceReady() || process.env.MONEY_RECOVERY_SCHEMA_READY !== "true" ||
      process.env.JOB_EXECUTION_SCHEMA_READY !== "true" || process.env.JOB_EXECUTION_ENROLLMENT !== "true" ||
      process.env.ASSIGNMENT_OFFERS_SCHEMA_READY !== "true" || process.env.ASSIGNMENT_OFFERS_ENROLLMENT !== "true")
    throw new RentalFinanceError("Prepaid credit and separate fees require compatible schema, execution and accepted-assignment enrollment before purchase");
  if (process.env.SUBSCRIPTION_MINIMUM_SCHEMA_READY !== "true" || process.env.SUBSCRIPTION_MINIMUM_ENROLLMENT !== "true" ||
      process.env.SUBSCRIPTION_TERM_SCHEMA_READY !== "true" || process.env.SUBSCRIPTION_TERM_ENROLLMENT !== "true")
    throw new RentalFinanceError("New credit purchases require the disclosed 30-day minimum and selected term-end policy");
  return RENTAL_FINANCE_POLICY;
}

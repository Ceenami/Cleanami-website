export type AdminJobOperations = {
  customerName: string | null;
  serviceLabel: string;
  paymentLabel: string;
  checklistLabel: string;
  evidenceLabel: string;
  photoCount: number;
  cleaners: Array<{
    id: string;
    name: string;
    role: string;
    source: string | null;
  }>;
  warnings: string[];
};

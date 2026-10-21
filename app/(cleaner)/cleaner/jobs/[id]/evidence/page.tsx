import { getExecutionContract } from "@/lib/services/job-execution-contract";
import { ExecutionEvidenceClient } from "@/components/cleaner/ExecutionEvidenceClient";
import { EvidencePacketClient } from "@/components/cleaner/EvidencePacketClient";

export default async function CleanerEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (await getExecutionContract(id)) return <ExecutionEvidenceClient jobId={id} />;
  return <EvidencePacketClient jobId={id} />;
}

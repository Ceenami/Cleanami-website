import { EvidencePacketClient } from "@/components/cleaner/EvidencePacketClient";

export default async function CleanerEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EvidencePacketClient jobId={id} />;
}

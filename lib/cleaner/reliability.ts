export function getReliabilityColor(score: number): string {
  if (score >= 95) return "text-green-600";
  if (score >= 80) return "text-yellow-600";
  return "text-red-600";
}


export const getStatusBadge = (status: string) => {
  switch (status) {
    case "in-progress":
      return "bg-blue-100 text-blue-800";
    case "assigned":
      return "bg-yellow-100 text-yellow-800";
    case "unassigned":
      return "bg-gray-100 text-gray-800";
    case "completed":
      return "bg-green-100 text-green-800";
    case "canceled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-200 text-gray-800";
  }
};
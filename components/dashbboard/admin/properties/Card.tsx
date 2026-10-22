export const Card = ({ icon, title, children, contentPadding = "space-y-4" }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  contentPadding?: string;
}) => (
  <div className="dashboard-form min-w-0 rounded-lg bg-white p-4 shadow-md sm:p-6">
    <div className="mb-4 flex items-start gap-3 border-b pb-3">
      <div className="shrink-0 text-gray-500">{icon}</div>
      <h3 className="min-w-0 text-lg font-semibold text-gray-800">{title}</h3>
    </div>
    <div className={`min-w-0 ${contentPadding}`}>{children}</div>
  </div>
);

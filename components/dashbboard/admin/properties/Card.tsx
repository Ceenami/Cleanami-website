export const Card = ({ icon, title, children, contentPadding = "space-y-4" }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  contentPadding?: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-md">
    <div className="flex items-center mb-4 border-b pb-3">
      <div className="text-gray-500">{icon}</div>
      <h3 className="ml-3 text-lg font-semibold text-gray-800">{title}</h3>
    </div>
    <div className={contentPadding}>{children}</div>
  </div>
);
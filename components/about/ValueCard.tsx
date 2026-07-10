interface ValueCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export const ValueCard = ({ icon, title, description }: ValueCardProps) => (
  <div className="text-center">
    <div className="mx-auto bg-brand rounded-full p-4 w-20 h-20 flex items-center justify-center mb-4">
      {icon}
    </div>
    <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
    <p className="text-gray-600">{description}</p>
  </div>
);

import Image from "next/image";

interface TeamMemberCardProps {
  imgSrc: string;
  name: string;
  title: string;
}

export const TeamMemberCard = ({
  imgSrc,
  name,
  title,
}: TeamMemberCardProps) => (
  <div className="text-center">
    <Image
      src={imgSrc}
      alt={name}
      width={400}
      height={800}
      className="w-32 h-32 rounded-full mx-auto mb-4 object-cover shadow-lg"
    />
    <h4 className="font-bold text-lg">{name}</h4>
    <p className="text-gray-500">{title}</p>
  </div>
);

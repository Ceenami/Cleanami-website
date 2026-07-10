'use client'

import { useEffect, useState } from "react";

export const ClientTime = ({
  dateString,
}: {
  dateString: Date;
}) => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || !dateString) {
    return <span>N/A</span>; 
  }

  const dateTime = new Date(dateString).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return <span>{dateTime}</span>;
};
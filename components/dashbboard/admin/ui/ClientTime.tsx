'use client'

import { useEffect, useState } from "react";

export const ClientTime = ({
  dateString,
  dateOnly = false,
}: {
  dateString: Date;
  /**
   * Drop the time of day. For a residential clean the stored instant is the
   * start of an arrival window, so printing it to the minute promises a
   * precision nobody was given - the window label carries the real answer.
   */
  dateOnly?: boolean;
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
    ...(dateOnly ? {} : { hour: "2-digit" as const, minute: "2-digit" as const }),
  });

  return <span>{dateTime}</span>;
};
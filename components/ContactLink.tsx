"use client";

import type { ComponentProps } from "react";
import { trackContactClick } from "@/lib/analytics";

type Props = ComponentProps<"a"> & { contactMethod: "email" | "phone" };

export function ContactLink({ contactMethod, onClick, ...props }: Props) {
  return <a {...props} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented) trackContactClick(contactMethod);
  }} />;
}

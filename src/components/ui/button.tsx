// Adapted from shadcn/ui's MIT-licensed Button primitive. See /third-party-notices.txt.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva("button", {
  variants: {
    variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost" },
    size: { default: "button-default", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({ className, variant, size, type = "button", ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={twMerge(clsx(buttonVariants({ variant, size }), className))} {...props} />;
}

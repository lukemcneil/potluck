"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Tiny client-only button that triggers the browser's print dialog.
 * Print styling lives in `app/globals.css` under `@media print`.
 */
export function PrintButton() {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => window.print()}
    >
      <Printer className="size-3.5" />
      Print
    </Button>
  );
}

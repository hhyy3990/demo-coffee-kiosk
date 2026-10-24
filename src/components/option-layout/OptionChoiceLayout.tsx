import type { ReactNode } from "react";
import "./option-choice-layout.css";

export interface OptionChoiceLayoutProps {
  children: ReactNode;
  /** A caller-validated layout choice. `null` keeps the existing choice-pills layout. */
  columns: 1 | 2 | null;
  groupId: "temperature" | "size" | "cup";
}

export function OptionChoiceLayout({
  children,
  columns,
  groupId,
}: OptionChoiceLayoutProps) {
  const layoutClass =
    columns === 1
      ? "option-choice-layout--single-column"
      : columns === 2
        ? "option-choice-layout--two-column"
        : "";

  return (
    <div
      className={["choice-pills", layoutClass].filter(Boolean).join(" ")}
      data-option-ai-columns={columns ?? undefined}
      data-option-ai-group={groupId}
    >
      {children}
    </div>
  );
}

export default OptionChoiceLayout;

import { useState } from "react";
import type { AgentQuestion } from "@openclaude-studio/acp";
import { Button } from "./Button.js";
import { ChoiceRow } from "./ChoiceRow.js";
import { cn } from "../lib/cn.js";

/**
 * Renders a set of interactive questions the agent asked the user (via the
 * `AskUserQuestion` tool) as a step-by-step approval flow. Each question is a
 * step in the stepper; the user picks options and the final step submits the
 * collected answers.
 *
 * Answers are keyed by question text, matching the `AskUserQuestion` input
 * contract. Multi-select answers are joined with `", "` exactly like the
 * terminal UI does.
 */
export type QuestionPanelProps = {
  questions: AgentQuestion[];
  /** called with answers keyed by question text: { [question]: optionLabel } */
  onSubmit: (answers: Record<string, string>) => void;
  /** labelled "Cancel" in the footer; when omitted the cancel button is hidden */
  onCancel?: (() => void) | undefined;
  /** labels for the footer buttons */
  labels?: {
    /** label for the cancel button */
    cancel?: string;
    /** label for the next button */
    next?: string;
    /** label for the submit button */
    submit?: string;
  };
  className?: string;
};

/**
 * Flattens the per-question selections into the `AskUserQuestion` answer
 * contract: keyed by question text, multi-select joined with `", "` (the same
 * separator the terminal UI uses). Unanswered questions are omitted.
 */
export function collectAnswers(
  questions: AgentQuestion[],
  selections: Record<string, string[]>,
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const question of questions) {
    const picked = selections[question.question] ?? [];
    if (picked.length > 0) collected[question.question] = picked.join(", ");
  }
  return collected;
}

export function QuestionPanel({
  questions,
  onSubmit,
  onCancel,
  labels,
  className,
}: QuestionPanelProps) {
  const [step, setStep] = useState(0);
  // Selected labels per question text. Multi-select questions keep an array.
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  const question = questions[step];
  const total = questions.length;
  const last = step === total - 1;
  const selected = question ? (selections[question.question] ?? []) : [];
  const hasAnswer = selected.length > 0;

  const toggle = (label: string) => {
    if (!question) return;
    const key = question.question;
    setSelections(prev => {
      const current = prev[key] ?? [];
      if (!question.multiSelect) return { ...prev, [key]: [label] };
      return {
        ...prev,
        [key]: current.includes(label)
          ? current.filter(entry => entry !== label)
          : [...current, label],
      };
    });
    // Single-select questions advance automatically; multi-select needs an
    // explicit "Next" because more options can still be added.
    if (!question.multiSelect && !last) setStep(next => next + 1);
  };

  const submit = () => {
    onSubmit(collectAnswers(questions, selections));
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${total}`}>
        {questions.map((q, index) => (
          <div
            key={q.question}
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
              index < step
                ? "border-accent bg-accent text-white"
                : index === step
                  ? "border-accent bg-accent-tint text-ink"
                  : "border-line text-ink-3",
            )}
          >
            {index < step ? "✓" : index + 1}
          </div>
        ))}
        <span className="ml-1 text-[11.5px] text-ink-3">
          Step {step + 1} of {total}
        </span>
      </div>

      {question ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink">{question.question}</p>
          {question.multiSelect ? (
            <p className="text-[11.5px] text-ink-3">Select all that apply.</p>
          ) : null}
          <ChoiceRow
            value={selected[0] ?? ""}
            options={question.options.map(option => ({
              value: option.label,
              label: option.label,
              ...(selected.includes(option.label) ? { hint: "Selected" } : {}),
            }))}
            onSelect={toggle}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex gap-2">
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(next => next - 1)}>
              Back
            </Button>
          ) : null}
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {labels?.cancel ?? "Cancel"}
            </Button>
          ) : null}
        </div>
        {question?.multiSelect || last ? (
          <Button variant="accent" size="sm" disabled={!hasAnswer} onClick={submit}>
            {labels?.submit ?? "Submit"}
          </Button>
        ) : (
          <Button
            variant="accent"
            size="sm"
            disabled={!hasAnswer}
            onClick={() => setStep(next => next + 1)}
          >
            {labels?.next ?? "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

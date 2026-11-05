import { useState } from "react";
import type { AgentQuestion } from "@openclaude-studio/acp";
import { Button } from "./Button.js";
import { ChoiceRow } from "./ChoiceRow.js";
import { cn } from "../lib/cn.js";

/** Synthetic option value meaning the user typed a free-text answer. */
const OTHER_OPTION = "__other__";

/**
 * Renders a set of interactive questions the agent asked the user (via the
 * `AskUserQuestion` tool) as a step-by-step approval flow. Each question is a
 * step in the stepper; the user picks options and the final step submits the
 * collected answers.
 *
 * Answers are keyed by question text, matching the `AskUserQuestion` input
 * contract. Multi-select answers are joined with `", "` exactly like the
 * terminal UI does. Each question may also carry a free-text "Other" answer
 * when the user types something that isn't one of the listed options.
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
    /** placeholder shown inside the free-text input */
    customPlaceholder?: string;
  };
  className?: string;
};

/**
 * Flattens the per-question selections into the `AskUserQuestion` answer
 * contract: keyed by question text, multi-select joined with `", "` (the same
 * separator the terminal UI uses). Unanswered questions are omitted. A typed
 * "Other" answer is appended when present.
 */
export function collectAnswers(
  questions: AgentQuestion[],
  selections: Record<string, string[]>,
  customValues: Record<string, string>,
): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const question of questions) {
    const picked = selections[question.question] ?? [];
    if (picked.length > 0) {
      const others = picked.filter(label => label === OTHER_OPTION);
      const real = picked.filter(label => label !== OTHER_OPTION);
      const parts = [...real];
      if (others.length > 0) {
        const custom = customValues[question.question]?.trim();
        if (custom) parts.push(custom);
      }
      collected[question.question] = parts.join(", ");
    }
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
  // Free-text "Other" value per question text.
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const question = questions[step];
  const total = questions.length;
  const last = step === total - 1;
  const selected = question ? (selections[question.question] ?? []) : [];
  const hasOther = selected.includes(OTHER_OPTION);
  const custom = question ? (customValues[question.question] ?? "") : "";
  const hasAnswer =
    selected.filter(label => label !== OTHER_OPTION).length > 0 ||
    (hasOther && custom.trim().length > 0);

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
    setCustomValues(prev => ({ ...prev, [question.question]: custom }));
    // Single-select questions advance automatically; multi-select needs an
    // explicit "Next" because more options can still be added. When "Other" is
    // chosen we wait for the user to type before advancing.
    if (!question.multiSelect && !last && label !== OTHER_OPTION)
      setStep(next => next + 1);
  };

  const setCustomValue = (value: string) => {
    if (!question) return;
    setCustomValues(prev => ({ ...prev, [question.question]: value }));
  };

  const submit = () => {
    onSubmit(collectAnswers(questions, selections, customValues));
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
            value={selected.filter(label => label !== OTHER_OPTION)}
            options={[
              ...question.options.map(option => ({
                value: option.label,
                label: option.label,
                ...(selected.includes(option.label) ? { hint: "Selected" } : {}),
              })),
              {
                value: OTHER_OPTION,
                label: labels?.customPlaceholder ?? "Other",
                ...(hasOther ? { hint: "Selected" } : {}),
              },
            ]}
            onSelect={toggle}
          />
          {hasOther ? (
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={custom}
                onChange={event => setCustomValue(event.target.value)}
                placeholder={labels?.customPlaceholder ?? "Type your answer…"}
                className="w-full rounded-[var(--radius-control)] border border-line bg-inset px-2 py-1 text-[11.5px] text-ink focus:border-accent focus:outline-none"
                autoFocus
              />
              <p className="text-[10.5px] text-ink-3">
                Or pick one of the options above instead.
              </p>
            </div>
          ) : null}
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

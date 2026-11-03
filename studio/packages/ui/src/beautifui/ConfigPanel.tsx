import { useEffect, useState } from "react";
import type { AgentConfigSnapshot } from "@openclaude-studio/acp";
import { Button } from "./Button.js";
import { ChoiceRow } from "./ChoiceRow.js";
import { cn } from "../lib/cn.js";

export type ConfigPanelProps = {
  snapshot: AgentConfigSnapshot;
  /** pending patch being applied; used to disable controls + show a spinner */
  saving?: boolean;
  labels?: Partial<ConfigPanelLabels>;
  onApply: (patch: { model?: string; theme?: string; provider?: string }) => void;
  className?: string;
};

export type ConfigPanelLabels = {
  title: string;
  subtitle: string;
  model: string;
  theme: string;
  provider: string;
  apply: string;
  saving: string;
};

const DEFAULT_LABELS: ConfigPanelLabels = {
  title: "Studio configuration",
  subtitle: "Pick the model, theme, and provider for this session.",
  model: "Model",
  theme: "Theme",
  provider: "Provider",
  apply: "Apply",
  saving: "Saving…",
};

/**
 * Studio's web-rendered panel for the terminal `/model`, `/theme`, `/provider`
 * and `/config` commands, which are no-ops over ACP. Renders the agent's
 * advertised options as stepper-style single-choice groups and applies the
 * whole selection in one `openclaude/config` set call.
 */
export function ConfigPanel({
  snapshot,
  saving = false,
  labels,
  onApply,
  className,
}: ConfigPanelProps) {
  const t = { ...DEFAULT_LABELS, ...labels };
  const [model, setModel] = useState(snapshot.model.active ?? "");
  const [theme, setTheme] = useState(snapshot.theme.active);
  const [provider, setProvider] = useState(snapshot.provider.activeId ?? "");

  // Re-sync the local selection whenever a fresh snapshot lands (e.g. after a
  // successful apply the agent echoes back the live state).
  useEffect(() => {
    setModel(snapshot.model.active ?? "");
    setTheme(snapshot.theme.active);
    setProvider(snapshot.provider.activeId ?? "");
  }, [snapshot]);

  const dirty =
    model !== (snapshot.model.active ?? "") ||
    theme !== snapshot.theme.active ||
    provider !== (snapshot.provider.activeId ?? "");

  return (
    <div
      className={cn(
        "flex w-full max-w-[560px] flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t.title}</h2>
        <p className="text-[12.5px] text-ink-3">{t.subtitle}</p>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={saving}>
        <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          {t.model}
        </legend>
        <ChoiceRow
          value={model}
          options={snapshot.model.options.map(option => ({
            value: option.value,
            label: option.label,
            ...(option.description !== undefined ? { hint: option.description } : {}),
          }))}
          onSelect={setModel}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={saving}>
        <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          {t.theme}
        </legend>
        <ChoiceRow
          value={theme}
          options={snapshot.theme.options.map(value => ({ value, label: prettyTheme(value) }))}
          onSelect={setTheme}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={saving}>
        <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
          {t.provider}
        </legend>
        <ChoiceRow
          value={provider}
          options={[
            { value: "", label: "Anthropic (default)" },
            ...snapshot.provider.profiles.map(profile => ({
              value: profile.id,
              label: profile.name,
              hint: [profile.provider, profile.model, profile.baseUrl]
                .filter(Boolean)
                .join(" · "),
            })),
          ]}
          onSelect={setProvider}
        />
      </fieldset>

      <div className="flex justify-end">
        <Button
          variant="accent"
          size="md"
          disabled={!dirty || saving}
          onClick={() => onApply({ model, theme, provider })}
        >
          {saving ? t.saving : t.apply}
        </Button>
      </div>
    </div>
  );
}

function prettyTheme(value: string): string {
  if (value === "auto") return "Auto (system)";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

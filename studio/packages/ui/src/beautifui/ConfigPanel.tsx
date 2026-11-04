import { useEffect, useMemo, useState } from "react";
import type { AgentConfigSnapshot, AgentSetting } from "@openclaude-studio/acp";
import { Button } from "./Button.js";
import { ChoiceRow } from "./ChoiceRow.js";
import { ToggleGroup, ToggleGroupItem } from "../shadcn/toggle-group.js";
import { Input } from "../shadcn/input.js";
import { ScrollArea } from "../shadcn/scroll-area.js";
import { cn } from "../lib/cn.js";

/** Which part of the config the panel should present. Driven by the slash
 *  command that opened it: `/model` → just model, `/config` → everything. */
export type ConfigSection = "model" | "theme" | "provider" | "settings" | "all";

export type ConfigPanelProps = {
  snapshot: AgentConfigSnapshot;
  /** pending patch being applied; used to disable controls + show a spinner */
  saving?: boolean;
  labels?: Partial<ConfigPanelLabels>;
  onApply: (patch: {
    model?: string;
    theme?: string;
    provider?: string;
    settings?: Record<string, unknown>;
  }) => void;
  className?: string;
  /** limit the visible/focused section; defaults to showing everything */
  section?: ConfigSection;
};

export type ConfigPanelLabels = {
  title: string;
  subtitle: string;
  model: string;
  theme: string;
  provider: string;
  settings: string;
  search: string;
  apply: string;
  saving: string;
};

const DEFAULT_LABELS: ConfigPanelLabels = {
  title: "Studio configuration",
  subtitle: "Pick the model, theme, provider, and settings for this session.",
  model: "Model",
  theme: "Theme",
  provider: "Provider",
  settings: "Settings",
  search: "Search models…",
  apply: "Apply",
  saving: "Saving…",
};

function titleFor(section: ConfigSection): Partial<ConfigPanelLabels> {
  switch (section) {
    case "model":
      return {
        title: "Choose a model",
        subtitle: "Select the model used for this session.",
      };
    case "theme":
      return {
        title: "Choose a theme",
        subtitle: "Select the appearance for Studio.",
      };
    case "provider":
      return {
        title: "Choose a provider",
        subtitle: "Select the provider profile for this session.",
      };
    case "settings":
      return {
        title: "Settings",
        subtitle: "Tune the agent's behavior and appearance.",
      };
    default:
      return {};
  }
}

/**
 * Studio's web-rendered panel for the terminal `/model`, `/theme`, `/provider`
 * and `/config` commands, which are no-ops over ACP. Renders the agent's
 * advertised options as single-choice groups and applies the whole selection
 * in one `openclaude/config` set call. The body scrolls so long model lists
 * stay reachable on small screens.
 */
export function ConfigPanel({
  snapshot,
  saving = false,
  labels,
  onApply,
  className,
  section = "all",
}: ConfigPanelProps) {
  const t = { ...DEFAULT_LABELS, ...labels, ...titleFor(section) };
  const [model, setModel] = useState(snapshot.model.active ?? "");
  const [theme, setTheme] = useState(snapshot.theme.active);
  const [provider, setProvider] = useState(snapshot.provider.activeId ?? "");
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(snapshot.settings.map(setting => [setting.id, setting.value])),
  );

  // Re-sync the local selection whenever a fresh snapshot lands (e.g. after a
  // successful apply the agent echoes back the live state).
  useEffect(() => {
    setModel(snapshot.model.active ?? "");
    setTheme(snapshot.theme.active);
    setProvider(snapshot.provider.activeId ?? "");
    setSettings(Object.fromEntries(snapshot.settings.map(setting => [setting.id, setting.value])));
  }, [snapshot]);

  const settingsDirty = snapshot.settings.some(
    setting => settings[setting.id] !== setting.value,
  );

  const dirty =
    model !== (snapshot.model.active ?? "") ||
    theme !== snapshot.theme.active ||
    provider !== (snapshot.provider.activeId ?? "") ||
    settingsDirty;

  const showModel = section === "all" || section === "model";
  const showTheme = section === "all" || section === "theme";
  const showProvider = section === "all" || section === "provider";
  const showSettings = section === "all" || section === "settings";

  const modelOptions = useMemo(
    () =>
      snapshot.model.options
        // The agent's advertised options can carry a null value/label for
        // partially-resolved profiles; skip those instead of crashing the
        // whole panel on `.toLowerCase`.
        .filter(option => typeof option.value === "string" && option.value.length > 0)
        .filter(option => {
          if (!query.trim()) return true;
          const q = query.trim().toLowerCase();
          const label = typeof option.label === "string" ? option.label.toLowerCase() : "";
          return label.includes(q) || option.value.toLowerCase().includes(q);
        })
        .map(option => ({
          value: option.value,
          label: typeof option.label === "string" ? option.label : option.value,
          ...(option.description !== undefined ? { hint: option.description } : {}),
        })),
    [snapshot.model.options, query],
  );

  return (
    <div
      className={cn(
        "flex h-full w-full max-w-[560px] flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t.title}</h2>
        <p className="text-[12.5px] text-ink-3">{t.subtitle}</p>
      </div>

      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div className="flex flex-col gap-5 pb-1">
          {showModel ? (
            <div>
              <fieldset className="flex flex-col gap-2" disabled={saving}>
                <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                  {t.model}
                </legend>
                {snapshot.model.options.length > 6 ? (
                  <Input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={t.search}
                    aria-label={t.search}
                    className="mb-2"
                  />
                ) : null}
                {modelOptions.length > 0 ? (
                  <ChoiceRow value={model} options={modelOptions} onSelect={setModel} />
                ) : (
                  <p className="text-[12.5px] text-ink-3">No models match “{query}”.</p>
                )}
              </fieldset>
            </div>
          ) : null}

          {showTheme ? (
            <fieldset className="flex flex-col gap-2" disabled={saving}>
              <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                {t.theme}
              </legend>
              <ChoiceRow
                value={theme}
                options={snapshot.theme.options.map(value => ({
                  value,
                  label: prettyTheme(value),
                }))}
                onSelect={setTheme}
              />
            </fieldset>
          ) : null}

          {showProvider ? (
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
          ) : null}

          {showSettings ? (
            <SettingsSection
              title={t.settings}
              description="Applied to the agent when you press Apply."
              settings={snapshot.settings}
              values={settings}
              onChange={(id, value) => setSettings(current => ({ ...current, [id]: value }))}
              disabled={saving}
            />
          ) : null}
        </div>
      </ScrollArea>

      <div className="flex justify-end border-t border-line pt-3">
        <Button
          variant="accent"
          size="md"
          disabled={!dirty || saving}
          onClick={() => {
            const patch: { model?: string; theme?: string; provider?: string; settings?: Record<string, unknown> } = {
              model,
              theme,
              provider,
            };
            if (settingsDirty) patch.settings = settings;
            onApply(patch);
          }}
        >
          {saving ? t.saving : t.apply}
        </Button>
      </div>
    </div>
  );
}

/** One collapsible group of settings. Toggles use the shared ToggleGroup
 *  primitive so the panel stays consistent with the rest of the UI. */
function SettingsSection({
  title,
  description,
  settings,
  values,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  settings: AgentSetting[];
  values: Record<string, unknown>;
  onChange: (id: string, value: unknown) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-ink-2">
          {title}
        </h3>
        <p className="text-[11.5px] text-ink-3">{description}</p>
      </div>
      <div className="flex flex-col gap-2">
        {settings.map(setting => (
          <SettingRow
            key={setting.id}
            setting={setting}
            value={values[setting.id]}
            onChange={onChange}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

function SettingRow({
  setting,
  value,
  onChange,
  disabled,
}: {
  setting: AgentSetting;
  value: unknown;
  onChange: (id: string, value: unknown) => void;
  disabled: boolean;
}) {
  if (setting.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium text-ink">{setting.label}</span>
          <span className="text-[11.5px] text-ink-3">{setting.description}</span>
        </div>
        <ToggleGroup
          type="single"
          value={value === true ? "on" : "off"}
          onValueChange={next => onChange(setting.id, next === "on")}
          disabled={disabled}
        >
          <ToggleGroupItem value="on" size="sm" aria-label="On">
            On
          </ToggleGroupItem>
          <ToggleGroupItem value="off" size="sm" aria-label="Off">
            Off
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-3">
      <div className="flex flex-col">
        <span className="text-[13px] font-medium text-ink">{setting.label}</span>
        <span className="text-[11.5px] text-ink-3">{setting.description}</span>
      </div>
      <ChoiceRow
        value={typeof value === "string" ? value : ""}
        options={(setting.options ?? []).map(option => ({ value: option, label: option }))}
        onSelect={next => onChange(setting.id, next)}
      />
    </div>
  );
}

function prettyTheme(value: string): string {
  if (value === "auto") return "Auto (system)";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

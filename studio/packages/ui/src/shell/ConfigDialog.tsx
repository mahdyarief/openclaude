import { useEffect, useState } from "react";
import type { AgentConfigPatch, AgentConfigSnapshot } from "@openclaude-studio/acp";
import { Dialog, DialogContent } from "../shadcn/dialog.js";
import { ConfigPanel, type ConfigSection } from "../beautifui/ConfigPanel.js";

export type ConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** which command opened the dialog; controls the panel's title + sections */
  section?: ConfigSection;
  /** Reads the live config snapshot from the agent. */
  fetchConfig: (() => Promise<AgentConfigSnapshot>) | null;
  /** Applies a patch and resolves with the post-write snapshot. */
  patchConfig: ((patch: AgentConfigPatch) => Promise<AgentConfigSnapshot>) | null;
  /** Called after a patch is applied so the host can surface a toast if wanted. */
  onApplied?: (snapshot: AgentConfigSnapshot) => void;
};

/**
 * Hosts the web-rendered config panel inside a Radix dialog. Loads the live
 * config snapshot from the agent's `openclaude/config` method on open and
 * re-loads it after every applied patch so the selections stay in sync.
 */
export function ConfigDialog({
  open,
  onOpenChange,
  section = "all",
  fetchConfig,
  patchConfig,
  onApplied,
}: ConfigDialogProps) {
  const [snapshot, setSnapshot] = useState<AgentConfigSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !fetchConfig) return;
    let cancelled = false;
    fetchConfig()
      .then(config => {
        if (!cancelled) setSnapshot(config);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchConfig]);

  const apply = async (patch: {
    model?: string;
    theme?: string;
    provider?: string;
    settings?: Record<string, unknown>;
  }) => {
    if (!patchConfig) return;
    setSaving(true);
    setError(null);
    try {
      const next = await patchConfig(patch);
      setSnapshot(next);
      onApplied?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose
        className="w-[min(92vw,560px)]"
        aria-label="Studio configuration"
      >
        {snapshot ? (
          <ConfigPanel
            snapshot={snapshot}
            saving={saving}
            section={section}
            onApply={apply}
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-[13px] text-ink-3">
            {error ?? "Loading configuration…"}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

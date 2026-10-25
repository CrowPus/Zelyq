import {
  AGENT_PERMISSIONS,
  type Agent,
  type AgentMedia,
  type AgentPermission,
  type AgentPermissionLevel,
  agentPermissionNames,
  defaultAgentPermissions,
  type Project,
} from "@zelyq/core";
import { type FormEvent, useId, useState } from "react";
import { Button, FieldLabel, Input, Textarea } from "../ui";

const LEVEL_LABEL: Record<AgentPermissionLevel, string> = {
  off: "Off",
  allow: "Allowed",
  approve: "Needs approval",
};

export interface AgentFormValue {
  name: string;
  job: string;
  projectIds: string[] | null;
  pipelineIds: string[] | null;
  environmentIds: string[] | null;
  media: AgentMedia;
  permissions: Record<AgentPermission, AgentPermissionLevel>;
}

/** "Every one" (null) or a chosen list. */
interface Scope {
  every: boolean;
  chosen: string[];
}

const scopeOf = (ids: string[] | null | undefined, isNew: boolean): Scope =>
  isNew ? { every: false, chosen: [] } : { every: ids === null, chosen: ids ?? [] };

/**
 * Creating or editing an agent: who it is, what it is for, which apps it may
 * touch and what it may do there. Every permission shows only the levels it
 * can have — push and pipelines never offer "Allowed".
 */
export function AgentForm({
  initial,
  apps,
  pipelines,
  environments,
  secrets,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Agent;
  apps: Project[];
  pipelines: { id: string; name: string }[];
  environments: { id: string; name: string }[];
  /** The team's Vault secret names, to pick the agent's media keys from. */
  secrets: string[];
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (value: AgentFormValue) => void;
  onCancel: () => void;
}) {
  const nameId = useId();
  const jobId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [job, setJob] = useState(initial?.job ?? "");
  const [appScope, setAppScope] = useState(scopeOf(initial?.projectIds, !initial));
  const [pipelineScope, setPipelineScope] = useState(scopeOf(initial?.pipelineIds, !initial));
  const [environmentScope, setEnvironmentScope] = useState(
    scopeOf(initial?.environmentIds, !initial),
  );
  const noApps = !appScope.every && appScope.chosen.length === 0;
  const [media, setMedia] = useState<AgentMedia>(initial?.media ?? { image: null, video: null });
  const [permissions, setPermissions] = useState<Record<AgentPermission, AgentPermissionLevel>>(
    (initial?.permissions as Record<AgentPermission, AgentPermissionLevel> | undefined) ??
      defaultAgentPermissions(),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || noApps) return;
    onSubmit({
      name: name.trim(),
      job: job.trim(),
      projectIds: appScope.every ? null : appScope.chosen,
      pipelineIds: pipelineScope.every ? null : pipelineScope.chosen,
      environmentIds: environmentScope.every ? null : environmentScope.chosen,
      media,
      permissions,
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mb-5 grid gap-4 rounded-lg border border-border-default bg-surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label htmlFor={nameId} className="grid gap-1">
          <FieldLabel>Name</FieldLabel>
          <Input
            id={nameId}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude Code — my laptop"
            autoFocus
          />
        </label>
        <label htmlFor={jobId} className="grid gap-1">
          <FieldLabel>Job</FieldLabel>
          <Textarea
            id={jobId}
            rows={2}
            value={job}
            maxLength={4000}
            onChange={(event) => setJob(event.target.value)}
            placeholder="What this agent is for. It reads this first, e.g. “Fix bugs in the shop app and keep its tests green.”"
          />
        </label>
      </div>

      <ScopePicker
        title="Apps it may work on"
        every="Every app in the team, including ones made later"
        empty="This team has no apps yet."
        options={apps.map((app) => ({ id: app.id, name: app.name }))}
        value={appScope}
        onChange={setAppScope}
      />
      <ScopePicker
        title="Pipelines it may see, change and ask to run"
        every="Every pipeline in the team, including ones made later"
        empty="This team has no pipelines yet. The agent can still create its own."
        note="Pipelines the agent creates are always its own."
        options={pipelines}
        value={pipelineScope}
        onChange={setPipelineScope}
      />
      <ScopePicker
        title="Environments it may see and deploy to"
        every="Every environment in the team, including ones made later"
        empty="This team has no environments yet."
        note="Its pipelines may deploy only to these."
        options={environments}
        value={environmentScope}
        onChange={setEnvironmentScope}
      />

      <fieldset className="grid gap-2">
        <legend className="mb-1">
          <FieldLabel>Who pays for its images and video</FieldLabel>
        </legend>
        <p className="text-2xs text-fg-muted">
          The agent generates on its own provider key, from this team's Vault — never this server's
          keys. It never sees the key. With none set, it cannot generate at all.
        </p>
        <MediaKey
          label="Images"
          providers={IMAGE_PROVIDERS}
          secrets={secrets}
          value={media.image}
          onChange={(image) => setMedia((current) => ({ ...current, image }))}
        />
        <MediaKey
          label="Video"
          providers={VIDEO_PROVIDERS}
          secrets={secrets}
          value={media.video}
          onChange={(video) => setMedia((current) => ({ ...current, video }))}
        />
      </fieldset>

      <fieldset>
        <legend className="mb-2">
          <FieldLabel>What it may do</FieldLabel>
        </legend>
        <ul className="divide-y divide-border-default rounded-md border border-border-default">
          {agentPermissionNames.map((permission) => {
            const group = AGENT_PERMISSIONS[permission];
            return (
              <li
                key={permission}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-fg">{group.label}</span>
                  <span className="block text-2xs text-fg-muted">{group.description}</span>
                </span>
                <span className="flex shrink-0 rounded-md border border-border-default p-0.5">
                  {group.levels.map((level) => {
                    const active = permissions[permission] === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={active}
                        aria-label={`${group.label}: ${LEVEL_LABEL[level]}`}
                        onClick={() =>
                          setPermissions((current) => ({ ...current, [permission]: level }))
                        }
                        className={`rounded px-2 py-0.5 text-2xs transition-colors ${
                          active
                            ? level === "off"
                              ? "bg-surface-active text-fg"
                              : level === "approve"
                                ? "bg-warning-subtle text-warning"
                                : "bg-success-subtle text-success"
                            : "text-fg-secondary hover:text-fg"
                        }`}
                      >
                        {LEVEL_LABEL[level]}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-2xs text-fg-muted">
          Secret values never reach an agent. Everything it changes is recorded under its name, with
          an undo point first.
        </p>
      </fieldset>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim() || noApps}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {noApps && <span className="text-2xs text-fg-muted">Choose at least one app.</span>}
      </div>
    </form>
  );
}

/** Every one, or only the ones ticked: the same choice for apps, pipelines and environments. */
function ScopePicker({
  title,
  every,
  empty,
  note,
  options,
  value,
  onChange,
}: {
  title: string;
  every: string;
  empty: string;
  note?: string;
  options: { id: string; name: string }[];
  value: Scope;
  onChange: (value: Scope) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1">
        <FieldLabel>{title}</FieldLabel>
      </legend>
      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="radio"
          checked={!value.every}
          onChange={() => onChange({ ...value, every: false })}
          className="accent-[var(--primary)]"
        />
        Only the ones I choose
      </label>
      {!value.every && (
        <div className="ml-5 grid max-h-44 gap-1 overflow-y-auto rounded-md border border-border-default p-2 sm:grid-cols-2">
          {options.length === 0 && <p className="text-2xs text-fg-muted">{empty}</p>}
          {options.map((option) => (
            <label key={option.id} className="flex min-w-0 items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={value.chosen.includes(option.id)}
                onChange={(event) =>
                  onChange({
                    every: false,
                    chosen: event.target.checked
                      ? [...value.chosen, option.id]
                      : value.chosen.filter((id) => id !== option.id),
                  })
                }
                className="accent-[var(--primary)]"
              />
              <span className="truncate">{option.name}</span>
            </label>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="radio"
          checked={value.every}
          onChange={() => onChange({ ...value, every: true })}
          className="accent-[var(--primary)]"
        />
        {every}
      </label>
      {note && <p className="ml-5 text-2xs text-fg-muted">{note}</p>}
    </fieldset>
  );
}

const IMAGE_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
  { id: "xai", label: "xAI" },
] as const;
const VIDEO_PROVIDERS = [
  { id: "google", label: "Google (Veo)" },
  { id: "xai", label: "xAI" },
] as const;

/** A provider and the Vault secret holding its key, or none. */
function MediaKey<P extends string>({
  label,
  providers,
  secrets,
  value,
  onChange,
}: {
  label: string;
  providers: readonly { id: P; label: string }[];
  secrets: string[];
  value: { provider: P; secret: string } | null;
  onChange: (value: { provider: P; secret: string } | null) => void;
}) {
  const select = "h-[30px] rounded-md border border-border-default bg-surface px-2 text-xs text-fg";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-14 text-fg-secondary">{label}</span>
      <select
        aria-label={`${label} provider`}
        className={select}
        value={value?.provider ?? ""}
        onChange={(event) =>
          onChange(
            event.target.value
              ? { provider: event.target.value as P, secret: value?.secret ?? secrets[0] ?? "" }
              : null,
          )
        }
      >
        <option value="">None</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.label}
          </option>
        ))}
      </select>
      {value && (
        <>
          <span className="text-fg-muted">key from Vault</span>
          <select
            aria-label={`${label} key`}
            className={select}
            value={value.secret}
            onChange={(event) => onChange({ ...value, secret: event.target.value })}
          >
            {secrets.length === 0 && <option value="">No secrets in Vault yet</option>}
            {secrets.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

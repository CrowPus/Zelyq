import { useMutation } from "@tanstack/react-query";
import type { AuditLogEntry, VaultEntry, VaultScope } from "@zelyq/core";
import {
  Copy,
  Eye,
  History,
  KeyRound,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { AUDIT_ACTION_LABELS, auditDetailSummary } from "../../lib/audit";
import { t } from "../../lib/i18n";
import { globalPaths, teamHref, useTeamPaths } from "../../lib/routes";
import { vaultErrorMessage } from "../../lib/vault";
import {
  FilterSelect,
  ListToolbar,
  matches,
  NothingMatches,
  Pager,
  pageOf,
  SearchBox,
  useListParams,
} from "../ListControls";
import {
  Badge,
  type Column,
  confirmAction,
  DataTable,
  Dialog,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  parseSort,
  RelativeTime,
  sortRows,
  toast,
} from "../ui";
import { RevealedValue, VersionHistory } from "./shared";

const SECRETS_PER_PAGE = 25;

function scopeKey(scope: VaultScope): string {
  return scope.kind === "instance" ? "instance" : scope.teamId;
}

/** "Stripe (STRIPE_KEY)" for an app's variable, the setting's own name otherwise. */
type Usage = VaultEntry["usedBy"][number];

function usageLabel(use: Usage): string {
  switch (use.kind) {
    case "project":
      return `${use.projectName} · ${use.variable}`;
    case "pipeline":
      return t("Pipeline {pipelineName}", { pipelineName: use.pipelineName });
    case "environment":
      return `${use.environmentName} · ${use.variable}`;
    default:
      return use.label;
  }
}

function usageKey(use: Usage): string {
  switch (use.kind) {
    case "project":
      return `project:${use.projectId}:${use.variable}`;
    case "pipeline":
      return `pipeline:${use.pipelineId}`;
    case "environment":
      return `environment:${use.environmentId}:${use.variable}`;
    default:
      return `setting:${use.key}`;
  }
}

/**
 * A Vault's secrets as a table: what each is, where it is used, when it last
 * changed and by whom. Everything that shows or changes a value is in the row
 * menu; showing or copying a value is confirmed first, because it is recorded
 * in Activity under the person's name.
 */
export function SecretsTable({
  scope,
  secrets,
  canWrite,
  canAdmin,
  onEdit,
  onChanged,
}: {
  scope: VaultScope;
  secrets: VaultEntry[];
  canWrite: boolean;
  canAdmin: boolean;
  onEdit(secret: VaultEntry): void;
  onChanged(): Promise<void>;
}) {
  const paths = useTeamPaths();
  const filters = useListParams(`vault.${scopeKey(scope)}`, ["q", "show", "sort"]);
  const query = filters.get("q");
  const show = filters.get("show");
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null);
  const [history, setHistory] = useState<VaultEntry | null>(null);

  const reveal = useMutation({
    mutationFn: (secret: VaultEntry) => api.vault.reveal(scope, secret.id),
    onError: (error) => toast.error(vaultErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (secret: VaultEntry) => api.vault.remove(scope, secret.id),
    onSuccess: onChanged,
    onError: (error) => toast.error(vaultErrorMessage(error)),
  });

  const mayUse = (secret: VaultEntry) => (secret.protected ? canAdmin : canWrite);

  async function askReveal(secret: VaultEntry, copy: boolean) {
    const ok = await confirmAction({
      title: copy
        ? t("Copy the value of {name}?", { name: secret.name })
        : t("Show the value of {name}?", { name: secret.name }),
      description: t(
        "This is recorded in the Vault’s Activity under your name. Check that nobody can see your screen.",
      ),
      confirmLabel: copy ? t("Copy value") : t("Show value"),
    });
    if (!ok) return;
    // A refusal is already a toast (onError); nothing to show.
    const result = await reveal.mutateAsync(secret).catch(() => null);
    if (!result) return;
    const { value } = result;
    if (!copy) {
      setRevealed({ name: secret.name, value });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("Copied {name}", { name: secret.name }));
    } catch {
      // The browser refused the clipboard: show it instead, with its own copy button.
      setRevealed({ name: secret.name, value });
    }
  }

  async function askDelete(secret: VaultEntry) {
    const ok = await confirmAction({
      title: t("Delete {name} and its history?", { name: secret.name }),
      description:
        secret.usedBy.length > 0 ? (
          <>
            {t("These will lose it:")}
            <ul className="mt-1 list-disc pl-5">
              {secret.usedBy.map((use) => (
                <li key={usageKey(use)}>{usageLabel(use)}</li>
              ))}
            </ul>
          </>
        ) : (
          t("Nothing uses it.")
        ),
      confirmLabel: t("Delete secret"),
      danger: true,
    });
    if (ok) remove.mutate(secret);
  }

  const settingsHref = scope.kind === "instance" ? globalPaths.admin() : teamHref("/settings");
  const usageHref = (use: Usage): string => {
    switch (use.kind) {
      case "project":
        return paths.appPanel(use.projectId, "variables");
      case "pipeline":
        return paths.pipeline(use.pipelineId);
      case "environment":
        return paths.deployments;
      default:
        return settingsHref;
    }
  };

  const columns: Column<VaultEntry>[] = [
    {
      id: "name",
      header: t("Name"),
      sortValue: (secret) => secret.name,
      cell: (secret) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm">{secret.name}</span>
            {secret.protected && (
              <Badge tone="warning">
                <LockKeyhole size={10} className="mr-1" /> {t("Protected")}
              </Badge>
            )}
          </p>
          {secret.description && (
            <p className="mt-0.5 max-w-md truncate text-xs text-fg-secondary">
              {secret.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "used",
      header: t("Used by"),
      hideBelow: "md",
      sortValue: (secret) => secret.usedBy.length,
      cell: (secret) =>
        secret.usedBy.length === 0 ? (
          <span className="text-xs text-fg-muted">{t("Not used yet")}</span>
        ) : (
          <span className="flex max-w-xs flex-wrap gap-1">
            {secret.usedBy.slice(0, 3).map((use) => (
              <Link
                key={usageKey(use)}
                to={usageHref(use)}
                className="inline-flex max-w-full items-center truncate rounded-sm border border-border-default bg-surface-subtle px-1.5 py-0.5 text-2xs text-fg-secondary hover:border-border-strong hover:text-fg"
              >
                {usageLabel(use)}
              </Link>
            ))}
            {secret.usedBy.length > 3 && (
              <span
                className="text-2xs text-fg-muted"
                title={secret.usedBy.slice(3).map(usageLabel).join(", ")}
              >
                {t("+{more} more", { more: secret.usedBy.length - 3 })}
              </span>
            )}
          </span>
        ),
    },
    {
      id: "changed",
      header: t("Last changed"),
      width: "w-36",
      hideBelow: "sm",
      sortValue: (secret) => secret.updatedAt,
      cell: (secret) => (
        <span className="text-xs whitespace-nowrap text-fg-secondary">
          <RelativeTime value={secret.updatedAt} />
          <span className="text-fg-muted"> · v{secret.version}</span>
        </span>
      ),
    },
    {
      id: "by",
      header: t("Changed by"),
      width: "w-36",
      hideBelow: "lg",
      sortValue: (secret) => secret.updatedBy?.name ?? secret.createdBy?.name ?? "",
      cell: (secret) => (
        <span className="truncate text-xs text-fg-secondary">
          {secret.updatedBy?.name ?? secret.createdBy?.name ?? "Zelyq"}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("Actions")}</span>,
      width: "w-12",
      align: "end",
      cell: (secret) => (
        <Menu
          width="w-52"
          trigger={
            <IconButton size="sm" label={t("Actions for {name}", { name: secret.name })}>
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          {mayUse(secret) && (
            <MenuItem icon={<Eye size={14} />} onSelect={() => askReveal(secret, false)}>
              {t("Show value")}
            </MenuItem>
          )}
          {mayUse(secret) && (
            <MenuItem icon={<Copy size={14} />} onSelect={() => askReveal(secret, true)}>
              {t("Copy value")}
            </MenuItem>
          )}
          {mayUse(secret) && (
            <MenuItem icon={<Pencil size={14} />} onSelect={() => onEdit(secret)}>
              {t("Change value")}
            </MenuItem>
          )}
          <MenuItem icon={<History size={14} />} onSelect={() => setHistory(secret)}>
            {t("History")}
          </MenuItem>
          {canAdmin && <MenuSeparator />}
          {canAdmin && (
            <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => askDelete(secret)}>
              {t("Delete")}
            </MenuItem>
          )}
        </Menu>
      ),
    },
  ];

  const shown = secrets.filter(
    (secret) =>
      (show !== "protected" || secret.protected) &&
      (show !== "unused" || secret.usedBy.length === 0) &&
      matches(query, secret.name, secret.description, ...secret.usedBy.map(usageLabel)),
  );
  const sort = parseSort(filters.get("sort"), { id: "name", dir: "asc" });
  const { rows, page } = pageOf(sortRows(shown, columns, sort), filters.page, SECRETS_PER_PAGE);
  const protectedCount = secrets.filter((secret) => secret.protected).length;
  const unusedCount = secrets.filter((secret) => secret.usedBy.length === 0).length;

  return (
    <>
      {secrets.length > 5 && (
        <ListToolbar>
          <SearchBox
            value={query}
            onChange={(value) => filters.set({ q: value })}
            placeholder={t("Search names, notes and where they are used")}
          />
          <FilterSelect
            label={t("Show")}
            value={show}
            onChange={(value) => filters.set({ show: value })}
            options={[
              { value: "", label: t("All secrets") },
              ...(protectedCount > 0
                ? [{ value: "protected", label: `${t("Protected")} (${protectedCount})` }]
                : []),
              ...(unusedCount > 0
                ? [{ value: "unused", label: `${t("Not used yet")} (${unusedCount})` }]
                : []),
            ]}
          />
        </ListToolbar>
      )}
      {shown.length === 0 ? (
        <NothingMatches onClear={filters.clear} />
      ) : (
        <DataTable
          caption={t("Secrets")}
          rows={rows}
          columns={columns}
          rowKey={(secret) => `${secret.id}:${secret.version}`}
          sort={sort}
          onSortChange={(next) =>
            filters.set({ sort: next ? `${next.id}:${next.dir}` : "", page: "" })
          }
        />
      )}
      <Pager
        page={page}
        total={shown.length}
        size={SECRETS_PER_PAGE}
        noun="secrets"
        all={secrets.length}
        onPage={(next) => filters.set({ page: String(next) })}
      />

      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => !open && setRevealed(null)}
        title={revealed?.name ?? ""}
        description={t("The value hides itself after half a minute.")}
      >
        {revealed && <RevealedValue value={revealed.value} onHide={() => setRevealed(null)} />}
      </Dialog>

      <Drawer
        open={history !== null}
        onOpenChange={(open) => !open && setHistory(null)}
        title={t("History of {name}", { name: history?.name ?? "" })}
        description={t("Every value it has had. Values themselves are never shown here.")}
      >
        {history && (
          <div className="px-5 py-4">
            <VersionHistory
              queryKey={["vault-versions", scopeKey(scope), history.id, history.version]}
              load={() => api.vault.versions(scope, history.id).then((r) => r.versions)}
              restore={(version) => api.vault.rollback(scope, history.id, version)}
              canRestore={mayUse(history)}
              onRestored={async () => {
                setHistory(null);
                await onChanged();
              }}
              note={t(
                "Restoring saves that value again as a new version, so nothing is lost. Everything using this secret gets it.",
              )}
            />
          </div>
        )}
      </Drawer>
    </>
  );
}

/** Who did what to the Vault, newest first. */
export function VaultActivityTable({ entries }: { entries: AuditLogEntry[] }) {
  const columns: Column<AuditLogEntry>[] = [
    {
      id: "who",
      header: t("Who"),
      width: "w-44",
      sortValue: (entry) => entry.actorName,
      cell: (entry) => (
        <span className="flex items-center gap-2 text-xs">
          {entry.action === "vault.secret.fetched" ? (
            <ShieldCheck size={13} className="shrink-0 text-fg-muted" />
          ) : (
            <KeyRound size={13} className="shrink-0 text-fg-muted" />
          )}
          <span className="truncate font-medium">{entry.actorName}</span>
        </span>
      ),
    },
    {
      id: "what",
      header: t("What"),
      cell: (entry) => {
        const summary = auditDetailSummary(entry.detail);
        return (
          <span className="text-xs">
            {AUDIT_ACTION_LABELS[entry.action]}
            {summary && <span className="font-mono text-fg-secondary"> · {summary}</span>}
          </span>
        );
      },
    },
    {
      id: "when",
      header: t("When"),
      width: "w-36",
      align: "end",
      sortValue: (entry) => entry.createdAt,
      cell: (entry) => (
        <span className="text-xs whitespace-nowrap text-fg-muted">
          <RelativeTime value={entry.createdAt} />
        </span>
      ),
    },
  ];
  return (
    <DataTable
      caption={t("Vault activity")}
      rows={entries}
      columns={columns}
      rowKey={(entry) => entry.id}
      density="compact"
      initialSort={{ id: "when", dir: "desc" }}
    />
  );
}

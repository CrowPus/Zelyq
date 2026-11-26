import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Project, roleAtLeast } from "@zelyq/core";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppCardThumb } from "../components/AppCardThumb";
import { AppShell } from "../components/AppShell";
import { TokenField } from "../components/GitPanel";
import {
  FilterSelect,
  ListToolbar,
  matches,
  NothingMatches,
  Pager,
  pageOf,
  SearchBox,
  useListParams,
} from "../components/ListControls";
import {
  Button,
  Card,
  type Column,
  confirmAction,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  PageBody,
  PageHeader,
  RelativeTime,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  statusOf,
  Textarea,
  toast,
} from "../components/ui";
import { useActiveTeam } from "../hooks/useActiveTeam";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useTeamPaths } from "../lib/routes";

/** Cards sit three to a row on a wide screen and two on a narrower one: 12
 *  fills whole rows in both. */
const APPS_PER_PAGE = 12;
const VIEW_KEY = "zelyq.apps.view";

type Template = Awaited<ReturnType<typeof api.listTemplates>>["templates"][number];

export function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const p = useTeamPaths();
  const [params, setParams] = useSearchParams();
  const creating = params.get("new") === "1";
  const setCreating = (open: boolean) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (open) copy.set("new", "1");
        else copy.delete("new");
        return copy;
      },
      { replace: true },
    );
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const setView = (next: "grid" | "list") => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A remembered view is a convenience.
    }
  };

  const projects = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
  const { team } = useActiveTeam();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.listTemplates });
  const teams = useQuery({ queryKey: ["teams"], queryFn: api.listTeams });

  const templateByName = new Map((templates.data?.templates ?? []).map((t) => [t.name, t]));

  const filters = useListParams(`apps.${team?.id ?? "all"}`, ["q", "status", "stack", "sort"]);
  const q = filters.get("q");
  const statusFilter = filters.get("status");
  const stack = filters.get("stack");
  const sort = filters.get("sort");
  const all = (projects.data?.projects ?? []).filter(
    (project) => !team || project.teamId === team.id,
  );
  const statuses = [...new Set(all.map((project) => project.status))].sort();
  const stacks = [...new Set(all.map((project) => project.template))].sort();
  const shown = all
    .filter(
      (project) =>
        matches(q, project.name, project.description, project.template) &&
        (!statusFilter || project.status === statusFilter) &&
        (!stack || project.template === stack),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldest"
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  const { rows: list, page } = pageOf(shown, filters.page, APPS_PER_PAGE);
  const roleByTeam = new Map((teams.data?.teams ?? []).map((t) => [t.id, t.role]));
  const canDelete = (teamId: string): boolean => {
    const role = roleByTeam.get(teamId);
    return role !== undefined && roleAtLeast(role, "admin");
  };

  async function remove(project: Project) {
    const ok = await confirmAction({
      title: t("Delete {name}?", { name: project.name }),
      description: t(
        "Its files, conversation, snapshots and preview are deleted for everyone in the team. This cannot be undone.",
      ),
      confirmLabel: t("Delete app"),
      danger: true,
      typeToConfirm: project.name,
    });
    if (!ok) return;
    try {
      await api.deleteProject(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(t("{name} was deleted", { name: project.name }));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  const appMenu = (project: Project) => (
    <Menu
      trigger={
        <IconButton size="sm" label={t("Actions for {name}", { name: project.name })}>
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      <MenuItem icon={<Sparkles size={14} />} onSelect={() => navigate(p.app(project.id))}>
        {t("Open builder")}
      </MenuItem>
      <MenuItem
        icon={<LayoutDashboard size={14} />}
        onSelect={() => navigate(p.app(project.id, "overview"))}
      >
        {t("Overview")}
      </MenuItem>
      <MenuItem
        icon={<Settings size={14} />}
        onSelect={() => navigate(p.app(project.id, "settings"))}
      >
        {t("Settings")}
      </MenuItem>
      {canDelete(project.teamId) && (
        <>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={14} />} danger onSelect={() => void remove(project)}>
            {t("Delete app")}
          </MenuItem>
        </>
      )}
    </Menu>
  );

  const columns: Column<Project>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (project) => project.name.toLowerCase(),
      cell: (project) => (
        <Link
          to={p.app(project.id)}
          className="flex items-center gap-2.5 font-medium text-fg hover:underline"
        >
          <span className="size-8 shrink-0 overflow-hidden rounded-md border border-border-default">
            <AppCardThumb project={project} height="size-8" />
          </span>
          {project.name}
        </Link>
      ),
    },
    {
      id: "stack",
      header: t("Stack"),
      hideBelow: "md",
      sortValue: (project) => templateByName.get(project.template)?.title ?? project.template,
      cell: (project) => (
        <span className="flex items-center gap-1.5 text-fg-secondary">
          {templateByName.get(project.template)?.icon && (
            <img src={`/${templateByName.get(project.template)!.icon}`} alt="" className="size-4" />
          )}
          {templateByName.get(project.template)?.title ?? project.template}
        </span>
      ),
    },
    {
      id: "status",
      header: t("Status"),
      hideBelow: "sm",
      sortValue: (project) => project.status,
      cell: (project) => (
        <StatusBadge
          status={statusOf(project.status)}
          label={project.status === "ready" ? t("Ready") : undefined}
          variant="inline"
        />
      ),
    },
    {
      id: "updated",
      header: "Updated",
      sortValue: (project) => project.updatedAt,
      cell: (project) => <RelativeTime value={project.updatedAt} className="text-fg-secondary" />,
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("Actions")}</span>,
      align: "end",
      width: "w-12",
      cell: appMenu,
    },
  ];

  return (
    <AppShell crumbs={[{ label: t("Apps") }]}>
      <PageBody>
        <PageHeader
          title={t("Apps")}
          description={t(
            "Describe an app and the agent builds it. Each one is a real folder of files you can open, edit, and take with you.",
          )}
          actions={
            <Button
              variant="primary"
              icon={<Plus size={15} strokeWidth={2} />}
              onClick={() => setCreating(true)}
            >
              {t("New app")}
            </Button>
          }
        />

        {all.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <ListToolbar>
                <SearchBox
                  value={q}
                  onChange={(value) => filters.set({ q: value })}
                  placeholder={t("Search apps")}
                />
                {statuses.length > 1 && (
                  <FilterSelect
                    label={t("Status")}
                    value={statusFilter}
                    onChange={(value) => filters.set({ status: value })}
                    options={[
                      { value: "", label: t("Any status") },
                      ...statuses.map((value) => ({
                        value,
                        label: `${value[0]?.toUpperCase()}${value.slice(1)} (${all.filter((project) => project.status === value).length})`,
                      })),
                    ]}
                  />
                )}
                {stacks.length > 1 && (
                  <FilterSelect
                    label={t("Stack")}
                    value={stack}
                    onChange={(value) => filters.set({ stack: value })}
                    options={[
                      { value: "", label: t("Any stack") },
                      ...stacks.map((value) => ({
                        value,
                        label: `${templateByName.get(value)?.title ?? value} (${all.filter((project) => project.template === value).length})`,
                      })),
                    ]}
                  />
                )}
                <FilterSelect
                  label={t("Order")}
                  value={sort}
                  onChange={(value) => filters.set({ sort: value })}
                  options={[
                    { value: "", label: t("Recently updated") },
                    { value: "name", label: t("Name A–Z") },
                    { value: "oldest", label: t("Least recently updated") },
                  ]}
                />
              </ListToolbar>
            </div>
            <SegmentedControl
              label={t("View")}
              value={view}
              onValueChange={setView}
              options={[
                {
                  value: "grid",
                  label: <span className="sr-only">{t("Grid")}</span>,
                  icon: <LayoutGrid size={14} />,
                },
                {
                  value: "list",
                  label: <span className="sr-only">{t("List")}</span>,
                  icon: <List size={14} />,
                },
              ]}
            />
          </div>
        )}

        {projects.isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[16/12]" />
            ))}
          </div>
        )}

        {!projects.isLoading && all.length === 0 && (
          <Card padded={false}>
            <EmptyState
              icon={<LayoutGrid size={20} />}
              title={team ? t("No apps in {name} yet", { name: team.name }) : t("No apps yet")}
              description={t(
                "Create one and describe what you want built. The agent works in a real workspace, so everything it writes is a file you can read.",
              )}
              action={
                <Button
                  variant="primary"
                  icon={<Plus size={15} strokeWidth={2} />}
                  onClick={() => setCreating(true)}
                >
                  {t("New app")}
                </Button>
              }
            />
          </Card>
        )}

        {all.length > 0 && shown.length === 0 && <NothingMatches onClear={filters.clear} />}

        {list.length > 0 && view === "list" && (
          <DataTable
            caption={t("Apps")}
            rows={list}
            columns={columns}
            rowKey={(project) => project.id}
          />
        )}

        {list.length > 0 && view === "grid" && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((project) => {
              const stackOf = templateByName.get(project.template);
              return (
                <li
                  key={project.id}
                  className="group relative overflow-hidden rounded-lg border border-border-default bg-surface transition-[border-color,box-shadow] focus-within:border-border-strong hover:border-border-strong hover:shadow-[0_4px_16px_-4px_rgb(0_0_0/0.1)]"
                >
                  <Link
                    to={p.app(project.id)}
                    className="block"
                    // The name below is the link people read and tab to; the
                    // picture is the same link for the mouse.
                    tabIndex={-1}
                    aria-hidden
                  >
                    <AppCardThumb project={project} stackIcon={stackOf?.icon} />
                  </Link>
                  <div className="flex items-center gap-2 border-t border-border-default px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={p.app(project.id)}
                        className="block truncate text-sm font-medium text-fg hover:underline"
                      >
                        {project.name}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
                        {project.status !== "ready" ? (
                          <StatusBadge status={statusOf(project.status)} variant="inline" />
                        ) : (
                          <span className="truncate">{stackOf?.title ?? project.template}</span>
                        )}
                        <span aria-hidden>·</span>
                        <RelativeTime value={project.updatedAt} className="shrink-0" />
                      </div>
                    </div>
                    {appMenu(project)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pager
          page={page}
          total={shown.length}
          size={APPS_PER_PAGE}
          noun="apps"
          all={all.length}
          onPage={(n) => filters.set({ page: String(n) })}
        />
      </PageBody>

      <NewAppDialog
        open={creating}
        onOpenChange={setCreating}
        templates={templates.data?.templates ?? []}
        teamId={team?.id}
        onCreated={async (project) => {
          await queryClient.invalidateQueries({ queryKey: ["projects"] });
          navigate(p.app(project.id));
        }}
      />
    </AppShell>
  );
}

/**
 * Two steps, the way people actually decide: first how to start (a stack, or
 * an existing repository), then what to call it. Create comes last.
 */
function NewAppDialog({
  open,
  onOpenChange,
  templates,
  teamId,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  templates: Template[];
  teamId?: string;
  onCreated(project: Project): void | Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [source, setSource] = useState<"stack" | "git">("stack");
  const [template, setTemplate] = useState("vite-react");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitToken, setGitToken] = useState("");
  const [tokenSource, setTokenSource] = useState<"paste" | "vault">("paste");
  const [tokenVault, setTokenVault] = useState("");

  useEffect(() => {
    if (!open) {
      setStep(1);
      setName("");
      setDescription("");
      setGitUrl("");
      setGitToken("");
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        template: source === "stack" ? template : "vite-react",
        ...(teamId ? { teamId } : {}),
        ...(source === "git"
          ? {
              gitUrl: gitUrl.trim(),
              ...(tokenSource === "vault"
                ? tokenVault
                  ? { gitTokenVault: tokenVault }
                  : {}
                : gitToken.trim()
                  ? { gitToken: gitToken.trim() }
                  : {}),
            }
          : {}),
      }),
    // Whatever happens, the token does not linger in the page.
    onSettled: () => setGitToken(""),
    onSuccess: async ({ project }) => {
      onOpenChange(false);
      toast.success(t("{name} is ready", { name: project.name }));
      await onCreated(project);
    },
  });

  const canContinue = source === "stack" ? Boolean(template) : /^https?:\/\//.test(gitUrl.trim());
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step === 1) {
      if (canContinue) setStep(2);
      return;
    }
    if (name.trim()) create.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t("{step, plural, one {New app} other {Name your app}}", { step })}
      description={
        step === 1
          ? t("Step 1 of 2 · Choose how to start.")
          : t("Step 2 of 2 · {value}", {
              value:
                source === "stack"
                  ? (templates.find((t) => t.name === template)?.title ?? template)
                  : t("From a Git repository"),
            })
      }
      footer={
        <>
          {step === 2 && (
            <Button
              variant="ghost"
              icon={<ArrowLeft size={14} />}
              onClick={() => setStep(1)}
              className="mr-auto"
            >
              {t("Back")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          {step === 1 ? (
            <Button variant="primary" disabled={!canContinue} onClick={() => setStep(2)}>
              {t("Continue")}
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
              onClick={() => create.mutate()}
            >
              {source === "git" ? t("Import app") : t("Create app")}
            </Button>
          )}
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {step === 1 ? (
          <>
            <SegmentedControl
              label={t("Start from")}
              value={source}
              onValueChange={(v) => setSource(v as "stack" | "git")}
              options={[
                { value: "stack", label: t("Start from a stack"), icon: <Sparkles size={14} /> },
                { value: "git", label: t("Import from Git"), icon: <GitBranch size={14} /> },
              ]}
              className="w-full"
            />
            {source === "stack" ? (
              <div role="radiogroup" aria-label={t("Stack")} className="grid gap-2 sm:grid-cols-2">
                {/* The default stack first: it is the one already chosen. */}
                {[...templates]
                  .sort((a, b) => Number(b.name === "vite-react") - Number(a.name === "vite-react"))
                  .map((option) => {
                    const active = option.name === template;
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: a card radio, roles set explicitly.
                      <button
                        key={option.name}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setTemplate(option.name)}
                        onDoubleClick={() => {
                          setTemplate(option.name);
                          setStep(2);
                        }}
                        className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,box-shadow,background-color] ${
                          active
                            ? "border-accent bg-accent-subtle shadow-[0_0_0_1px_var(--accent)]"
                            : "border-border-default bg-surface hover:border-border-strong hover:bg-surface-hover"
                        }`}
                      >
                        {option.icon ? (
                          <img
                            src={`/${option.icon}`}
                            alt=""
                            width={36}
                            height={36}
                            className="size-9 shrink-0 object-contain"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-active text-sm font-semibold text-fg-secondary"
                          >
                            {option.title.slice(0, 1)}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-fg">{option.title}</span>
                          <span className="mt-0.5 block text-xs leading-4 text-fg-secondary">
                            {option.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Field
                  label={t("Repository address")}
                  help={t(
                    "Zelyq clones it and works on a copy. It never pushes, so a read-only token is enough.",
                  )}
                >
                  <Input
                    autoFocus
                    value={gitUrl}
                    onChange={(event) => setGitUrl(event.target.value)}
                    placeholder="https://github.com/you/your-repo.git"
                    inputMode="url"
                  />
                </Field>
                {teamId && (
                  <TokenField
                    value={gitToken}
                    onChange={setGitToken}
                    teamId={teamId}
                    source={tokenSource}
                    onSource={setTokenSource}
                    vaultName={tokenVault}
                    onVaultName={setTokenVault}
                  />
                )}
                <p className="text-xs text-fg-muted">
                  {t("The token is used once and never stored. Cloning can take a minute.")}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <Field
              label={t("App name")}
              required
              help={
                slug
                  ? t("Its folder will be called {slug}.", { slug })
                  : t("You can rename it later.")
              }
            >
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Customer portal")}
                maxLength={120}
              />
            </Field>
            <Field
              label={t("Description")}
              help={t(
                "What the app is for, who uses it, and anything the agent should always keep in mind. The agent reads it with every message.",
              )}
            >
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
              />
            </Field>
            {source === "git" && (
              <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
                <ExternalLink size={12} /> {gitUrl.trim()}
              </p>
            )}
            {create.isError && (
              <InlineAlert tone="danger" title={t("The app could not be created")}>
                {(create.error as Error).message}
              </InlineAlert>
            )}
          </>
        )}
        {/* Enter submits the step. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

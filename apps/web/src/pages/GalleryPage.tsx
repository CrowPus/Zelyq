import { Bell, Inbox, MoreHorizontal, Pencil, Plus, Rocket, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppShell } from "../components/AppShell";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  type Column,
  CopyButton,
  confirmAction,
  DataTable,
  DescriptionList,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  PageBody,
  PageHeader,
  PasswordInput,
  RelativeTime,
  SearchField,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonRows,
  Spinner,
  StatTile,
  type Status,
  StatusBadge,
  Switch,
  Tabs,
  Textarea,
  Tooltip,
  toast,
} from "../components/ui";
import { useSession } from "../hooks/useSession";

const STATUSES: Status[] = [
  "running",
  "succeeded",
  "failed",
  "warning",
  "queued",
  "stopped",
  "skipped",
  "unknown",
];

interface Row {
  id: string;
  name: string;
  status: Status;
  owner: string;
  updated: string;
}

const ROWS: Row[] = [
  {
    id: "1",
    name: "Customer Portal",
    status: "succeeded",
    owner: "Ada Lovelace",
    updated: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: "2",
    name: "Inventory Tracker",
    status: "running",
    owner: "Grace Hopper",
    updated: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "3",
    name: "Marketing Site",
    status: "failed",
    owner: "Alan Turing",
    updated: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  },
];

/**
 * Every shared component, in every state, in one place: the reference for
 * anyone building a page, and the screen visual checks are taken from.
 */
export function GalleryPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"a" | "b" | "c">("a");
  const [seg, setSeg] = useState<"preview" | "code" | "plan">("preview");
  const [select, setSelect] = useState("editor");
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(true);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);

  if (user?.instanceRole !== "admin") {
    return (
      <AppShell crumbs={[{ label: "Components" }]}>
        <EmptyState
          title="For server admins"
          description="The component gallery is a tool for the people building Zelyq."
        />
      </AppShell>
    );
  }

  const columns: Column<Row>[] = [
    {
      id: "name",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.name}</span>,
      sortValue: (r) => r.name,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} variant="inline" />,
      sortValue: (r) => r.status,
    },
    {
      id: "owner",
      header: "Owner",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.owner} size={20} /> {r.owner}
        </span>
      ),
      hideBelow: "md",
    },
    {
      id: "updated",
      header: "Updated",
      cell: (r) => <RelativeTime value={r.updated} className="text-fg-secondary" />,
      sortValue: (r) => r.updated,
      hideBelow: "sm",
    },
    {
      id: "menu",
      header: <span className="sr-only">Actions</span>,
      align: "end",
      width: "w-12",
      cell: () => (
        <Menu
          trigger={
            <IconButton size="sm" label="Row actions">
              <MoreHorizontal size={14} />
            </IconButton>
          }
        >
          <MenuItem icon={<Pencil size={14} />}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 size={14} />} danger>
            Delete
          </MenuItem>
        </Menu>
      ),
    },
  ];

  return (
    <AppShell crumbs={[{ label: "Components" }]}>
      <PageBody>
        <PageHeader
          title="Components"
          description="Every shared component in its states. Build pages from these; if something is missing, add it here first."
          actions={
            <Button variant="primary" icon={<Plus size={14} />}>
              Primary action
            </Button>
          }
        />

        <Demo title="Buttons">
          <Row>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="strong">Strong</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="danger-solid">Delete app</Button>
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button disabled>Disabled</Button>
          </Row>
          <Row>
            <Button size="sm" variant="primary">
              Small
            </Button>
            <Button size="md" variant="primary">
              Default
            </Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <IconButton label="Notifications">
              <Bell size={16} />
            </IconButton>
            <IconButton label="Inbox" variant="secondary">
              <Inbox size={16} />
            </IconButton>
            <CopyButton value="prj_example" />
          </Row>
        </Demo>

        <Demo title="Status">
          <Row>
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </Row>
          <Row>
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} variant="inline" />
            ))}
          </Row>
          <Row>
            <Badge>Neutral</Badge>
            <Badge tone="accent">Accent</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="danger">Danger</Badge>
            <Badge tone="info">Info</Badge>
            <Kbd>⌘K</Kbd>
          </Row>
        </Demo>

        <Demo title="Form controls">
          <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="App name" help="Shown in the app list." required>
              <Input placeholder="Customer Portal" />
            </Field>
            <Field label="Email" error="Enter a full email address, like ada@example.com.">
              <Input defaultValue="ada@" />
            </Field>
            <Field label="Password">
              <PasswordInput placeholder="At least 10 characters" />
            </Field>
            <Field label="Role">
              <Select
                value={select}
                onValueChange={setSelect}
                options={[
                  {
                    value: "viewer",
                    label: "Viewer",
                    description: "Reads apps, files and conversations",
                  },
                  {
                    value: "editor",
                    label: "Editor",
                    description: "Builds, edits and runs previews",
                  },
                  {
                    value: "admin",
                    label: "Admin",
                    description: "Manages members and deletes apps",
                  },
                ]}
              />
            </Field>
            <Field label="Description" optional className="sm:col-span-2">
              <Textarea rows={3} placeholder="What the app is for" />
            </Field>
            <SearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search apps"
              shortcut="/"
              aria-label="Search apps"
            />
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-2 text-sm">
                <Switch id="g-switch" checked={on} onCheckedChange={setOn} />
                <label htmlFor="g-switch">Switch</label>
              </span>
              <span className="flex items-center gap-2 text-sm">
                <Checkbox id="g-check" checked={check} onCheckedChange={setCheck} />
                <label htmlFor="g-check">Checkbox</label>
              </span>
            </div>
            <SegmentedControl
              label="Pane"
              value={seg}
              onValueChange={(v) => setSeg(v as typeof seg)}
              options={[
                { value: "preview", label: "Preview" },
                { value: "code", label: "Code" },
                { value: "plan", label: "Plan" },
              ]}
            />
          </div>
        </Demo>

        <Demo title="Tabs">
          <Tabs
            label="Example"
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            items={[
              { id: "a", label: "Pipelines", count: 12 },
              { id: "b", label: "Overview" },
              { id: "c", label: "Runners", count: 2 },
            ]}
          />
        </Demo>

        <Demo title="Overlays and feedback">
          <Row>
            <Button onClick={() => setDialog(true)}>Dialog</Button>
            <Button onClick={() => setDrawer(true)}>Drawer</Button>
            <Button
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Delete Marketing Site?",
                  description:
                    "Its files and history are deleted for everyone. This cannot be undone.",
                  confirmLabel: "Delete app",
                  danger: true,
                  typeToConfirm: "Marketing Site",
                });
                toast(ok ? "Confirmed" : "Cancelled");
              }}
            >
              Typed confirmation
            </Button>
            <Button
              onClick={() => toast.success("Saved", { description: "Your changes are live." })}
            >
              Success toast
            </Button>
            <Button
              onClick={() =>
                toast.error("Could not save", { description: "The server did not answer." })
              }
            >
              Error toast
            </Button>
            <Menu trigger={<Button>Menu</Button>}>
              <MenuLabel>App</MenuLabel>
              <MenuItem icon={<Pencil size={14} />} shortcut="R">
                Rename
              </MenuItem>
              <MenuItem icon={<Rocket size={14} />}>Deploy</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 size={14} />} danger>
                Delete
              </MenuItem>
            </Menu>
            <Tooltip content="A real tooltip" shortcut="?">
              <Button variant="ghost">Hover me</Button>
            </Tooltip>
          </Row>
          <div className="mt-4 grid gap-3">
            <InlineAlert tone="info" title="Invitations are off">
              Ask a server admin to set up email.
            </InlineAlert>
            <InlineAlert tone="success">The pipeline passed.</InlineAlert>
            <InlineAlert tone="warning" title="Close to the limit">
              9 of 10 apps used.
            </InlineAlert>
            <InlineAlert
              tone="danger"
              title="Deploy failed"
              action={<Button size="sm">View logs</Button>}
            >
              Health check did not pass.
            </InlineAlert>
          </div>
        </Demo>

        <Demo title="Data">
          <DataTable
            caption="Example apps"
            rows={ROWS}
            columns={columns}
            rowKey={(r) => r.id}
            selectable
            bulkActions={(selected, clear) => (
              <Button size="sm" variant="danger" onClick={clear}>
                Delete {selected.length}
              </Button>
            )}
            initialSort={{ id: "updated", dir: "desc" }}
          />
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card title="Usage">
              <StatTile label="Runner minutes" value="412 / 500 min" meter={0.82} />
            </Card>
            <Card title="Details">
              <DescriptionList
                items={[
                  { label: "Stack", value: "React + Vite" },
                  { label: "Created", value: <RelativeTime value={ROWS[2]!.updated} /> },
                ]}
              />
            </Card>
            <Card title="Loading" padded={false}>
              <SkeletonRows rows={2} />
            </Card>
          </div>
        </Demo>

        <Demo title="Empty, loading and error">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card padded={false}>
              <EmptyState
                compact
                icon={<Rocket size={20} />}
                title="No environments yet"
                description="An environment is where your apps run, like staging or production."
                action={<Button variant="primary">New environment</Button>}
              />
            </Card>
            <Card padded={false}>
              <ErrorState error="The server did not answer." onRetry={() => toast("Retrying")} />
            </Card>
            <Card>
              <div className="flex flex-col gap-3">
                <Spinner label="Loading apps" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </Card>
          </div>
        </Demo>

        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="New environment"
          description="A place your apps run, like staging or production."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Cancel
              </Button>
              <Button variant="primary">Create environment</Button>
            </>
          }
        >
          <Field label="Name">
            <Input autoFocus placeholder="production" />
          </Field>
        </Dialog>
        <Drawer
          open={drawer}
          onOpenChange={setDrawer}
          title="Git"
          description="Push, pull and branches for this app."
        >
          <div className="p-5 text-sm text-fg-secondary">Drawer content.</div>
        </Drawer>
      </PageBody>
    </AppShell>
  );
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface p-5">
        {children}
      </div>
    </Section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

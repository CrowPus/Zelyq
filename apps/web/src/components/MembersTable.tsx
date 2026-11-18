import { ROLE_DESCRIPTIONS, ROLES, type Role, type TeamMember } from "@zelyq/core";
import { Copy, LogOut, MoreHorizontal, UserMinus, Users } from "lucide-react";
import { t, translateServerMessage } from "../lib/i18n";
import { roleName } from "../lib/roles";
import {
  FilterSelect,
  ListToolbar,
  matches,
  NothingMatches,
  Pager,
  pageOf,
  SearchBox,
  useListParams,
} from "./ListControls";
import {
  Avatar,
  type Column,
  DataTable,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  NativeSelect,
  parseSort,
  RelativeTime,
  sortRows,
  toast,
} from "./ui";

const MEMBERS_PER_PAGE = 25;

/**
 * The team's people: searchable, filterable by role, sortable by any column.
 * Admins change a role in place; anything that removes someone goes through
 * the row menu and is confirmed by the page.
 */
export function MembersTable({
  members,
  loading,
  teamKey,
  meId,
  canManage,
  onRole,
  onRemove,
}: {
  members: TeamMember[];
  loading: boolean;
  /** Keeps this team's search and page apart from another team's. */
  teamKey: string;
  meId: string | undefined;
  canManage: boolean;
  onRole(userId: string, next: Role): void;
  onRemove(member: TeamMember): void;
}) {
  const filters = useListParams(`members.${teamKey}`, ["q", "role", "sort"]);
  const query = filters.get("q");
  const roleFilter = filters.get("role");
  const shown = members.filter(
    (member) =>
      (!roleFilter || member.role === roleFilter) && matches(query, member.name, member.email),
  );
  const sort = parseSort(filters.get("sort"), { id: "role", dir: "desc" });
  const present = ROLES.filter((role) => members.some((member) => member.role === role));

  const columns: Column<TeamMember>[] = [
    {
      id: "name",
      header: t("Member"),
      sortValue: (member) => member.name.toLowerCase(),
      cell: (member) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={member.name} size={28} />
          <div className="min-w-0">
            <p className="truncate text-sm text-fg">
              {member.name}
              {member.userId === meId && (
                <span className="ml-1.5 text-xs text-fg-muted">{t("(you)")}</span>
              )}
            </p>
            <p className="truncate text-xs text-fg-muted">{member.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: t("Role"),
      width: "w-40",
      sortValue: (member) => ROLES.length - ROLES.indexOf(member.role),
      cell: (member) =>
        canManage ? (
          <NativeSelect
            value={member.role}
            onChange={(event) => onRole(member.userId, event.target.value as Role)}
            aria-label={t("Role for {name}", { name: member.name })}
            className="w-auto min-w-32"
            title={translateServerMessage(ROLE_DESCRIPTIONS[member.role])}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {roleName(option)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span
            className="text-xs text-fg-secondary"
            title={translateServerMessage(ROLE_DESCRIPTIONS[member.role])}
          >
            {roleName(member.role)}
          </span>
        ),
    },
    {
      id: "joined",
      header: t("Joined"),
      width: "w-32",
      hideBelow: "md",
      sortValue: (member) => member.joinedAt,
      cell: (member) => (
        <span className="text-xs text-fg-secondary">
          <RelativeTime value={member.joinedAt} />
        </span>
      ),
    },
    {
      id: "seen",
      header: t("Last active"),
      width: "w-32",
      hideBelow: "sm",
      sortValue: (member) => member.lastSeenAt ?? null,
      cell: (member) => (
        <span className="text-xs text-fg-secondary">
          {member.lastSeenAt ? <RelativeTime value={member.lastSeenAt} /> : t("Not yet")}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("Actions")}</span>,
      width: "w-12",
      align: "end",
      cell: (member) => {
        const me = member.userId === meId;
        return (
          <Menu
            width="w-52"
            trigger={
              <IconButton size="sm" label={t("Actions for {name}", { name: member.name })}>
                <MoreHorizontal size={14} />
              </IconButton>
            }
          >
            <MenuItem
              icon={<Copy size={14} />}
              onSelect={() => {
                navigator.clipboard
                  ?.writeText(member.email)
                  .then(() => toast.success(t("Email copied")))
                  .catch(() => toast.error(t("Could not copy")));
              }}
            >
              {t("Copy email")}
            </MenuItem>
            {(canManage || me) && <MenuSeparator />}
            {(canManage || me) && (
              <MenuItem
                danger
                icon={me ? <LogOut size={14} /> : <UserMinus size={14} />}
                onSelect={() => onRemove(member)}
              >
                {me ? t("Leave team") : t("Remove from team")}
              </MenuItem>
            )}
          </Menu>
        );
      },
    },
  ];

  const { rows, page } = pageOf(sortRows(shown, columns, sort), filters.page, MEMBERS_PER_PAGE);

  return (
    <section aria-label={t("Members")}>
      {members.length > 5 && (
        <ListToolbar>
          <SearchBox
            value={query}
            onChange={(value) => filters.set({ q: value })}
            placeholder={t("Search by name or email")}
          />
          {present.length > 1 && (
            <FilterSelect
              label={t("Role")}
              value={roleFilter}
              onChange={(value) => filters.set({ role: value })}
              options={[
                { value: "", label: t("Any role") },
                ...present.map((role) => ({
                  value: role,
                  label: `${roleName(role)} (${members.filter((member) => member.role === role).length})`,
                })),
              ]}
            />
          )}
        </ListToolbar>
      )}
      {members.length > 0 && shown.length === 0 ? (
        <NothingMatches onClear={filters.clear} />
      ) : (
        <DataTable
          caption={t("Members")}
          rows={rows}
          columns={columns}
          rowKey={(member) => member.userId}
          loading={loading}
          sort={sort}
          onSortChange={(next) =>
            filters.set({ sort: next ? `${next.id}:${next.dir}` : "", page: "" })
          }
          empty={
            <EmptyState
              icon={<Users size={20} />}
              title={t("No members")}
              description={t("Add someone above to work on this team’s apps together.")}
            />
          }
        />
      )}
      <Pager
        page={page}
        total={shown.length}
        size={MEMBERS_PER_PAGE}
        noun="members"
        all={members.length}
        onPage={(next) => filters.set({ page: String(next) })}
      />
    </section>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { teamKey, teamPaths } from "../lib/routes";
import { Button, Dialog, Field, Input, toast } from "./ui";

/** Create a team, then go straight to it. */
export function NewTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { team } = await api.createTeam(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      onOpenChange(false);
      setName("");
      toast.success(t("Created {name}", { name: team.name }));
      navigate(teamPaths(teamKey(team)).home);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("New team")}
      description={t(
        "A team has its own apps, Vault, pipelines and settings. You can invite people once it exists.",
      )}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>
            {t("Create team")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label={t("Team name")} error={error}>
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("Design team")}
            maxLength={80}
          />
        </Field>
      </form>
    </Dialog>
  );
}

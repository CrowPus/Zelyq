import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { NativeSelect, PasswordInput, Spinner } from "./ui";

export type SecretFrom = "type" | "vault";

/**
 * Where a secret comes from: typed in here, or a secret already in the team's
 * Vault (only its name is kept; the value is read each time it is used). The
 * same choice everywhere a password or token is asked for.
 */
export function SecretSource({
  teamId,
  label,
  placeholder,
  from,
  onFrom,
  value,
  onValue,
  vaultName,
  onVaultName,
  id,
}: {
  teamId: string;
  label: string;
  placeholder?: string;
  from: SecretFrom;
  onFrom: (from: SecretFrom) => void;
  value: string;
  onValue: (value: string) => void;
  vaultName: string;
  onVaultName: (name: string) => void;
  id?: string;
}) {
  const choices = useQuery({
    queryKey: ["vault-choices", teamId],
    queryFn: () => api.vault.choices({ kind: "team", teamId }).then((r) => r.choices),
    enabled: from === "vault",
  });
  const usable = choices.data?.filter((choice) => choice.selectable) ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex w-full gap-1 rounded-md bg-canvas p-0.5 text-2xs">
        {(
          [
            ["type", "Type it"],
            ["vault", "From Vault"],
          ] as const
        ).map(([choice, words]) => (
          <button
            key={choice}
            type="button"
            aria-pressed={from === choice}
            onClick={() => onFrom(choice)}
            className={`flex-1 rounded px-2 py-1 font-medium ${
              from === choice ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"
            }`}
          >
            {words}
          </button>
        ))}
      </div>
      {from === "vault" ? (
        choices.isPending ? (
          <span className="flex items-center gap-1.5 text-2xs text-fg-secondary">
            <Spinner /> Reading the team's Vault…
          </span>
        ) : usable.length === 0 ? (
          <span className="text-2xs text-fg-secondary">
            The team's Vault has no secret to choose yet.{" "}
            <Link to={`/vault?scope=${teamId}`} className="underline underline-offset-2">
              Add it to the Vault
            </Link>
            , then choose it here.
          </span>
        ) : (
          <NativeSelect
            id={id}
            aria-label={`${label} from Vault`}
            value={vaultName}
            onChange={(event) => onVaultName(event.target.value)}
          >
            <option value="">Choose the secret…</option>
            {usable.map((choice) => (
              <option key={choice.name} value={choice.name}>
                {choice.name}
                {choice.protected ? " · Protected" : ""}
              </option>
            ))}
          </NativeSelect>
        )
      ) : (
        <PasswordInput
          id={id}
          aria-label={label}
          value={value}
          autoComplete="new-password"
          placeholder={placeholder}
          onChange={(event) => onValue(event.target.value)}
        />
      )}
    </div>
  );
}

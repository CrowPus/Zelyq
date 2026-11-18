import type { Role } from "@zelyq/core";
import { t } from "./i18n";

/** A role's name, in the interface language ("admin", "Administrator", …). */
export function roleName(role: Role | string): string {
  switch (role) {
    case "owner":
      return t("owner");
    case "admin":
      return t("admin");
    case "editor":
      return t("editor");
    case "viewer":
      return t("viewer");
    default:
      return role;
  }
}

import { ZelyqError } from "@zelyq/core";
import nodemailer from "nodemailer";
import { type GuardLevel, refusedHost } from "./net-guard.js";
import type { SettingsService } from "./settings.js";

/**
 * Email, through the SMTP server an admin sets in Settings → Email. Nothing
 * else: no outside mail service. Without a mail server Zelyq simply sends no
 * email, and says so where it matters.
 */

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
}

export interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export type TransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}) => MailTransport;

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "Name <a@b.c>" or "a@b.c": the address inside. */
export function addressOf(from: string): string | null {
  const inside = /<([^>]+)>\s*$/.exec(from.trim());
  const address = (inside?.[1] ?? from).trim();
  return ADDRESS.test(address) ? address : null;
}

export class MailService {
  /**
   * How far a team's own mail server is trusted (net-guard): "strict" on a server
   * shared by many teams (no private networks, this server or metadata addresses),
   * "normal" when self-hosted.
   */
  teamGuard: GuardLevel = "normal";

  constructor(
    private readonly settings: SettingsService,
    private readonly createTransport: TransportFactory = (options) =>
      nodemailer.createTransport(options) as unknown as MailTransport,
  ) {}

  /**
   * The mail server to use: a team's own when it has one (Team settings → Email,
   * all of it, never mixed with the server's), otherwise the server's.
   */
  private async config(teamId?: string | null): Promise<{
    host: string;
    port: number;
    security: string;
    user: string;
    pass: string;
    from: string;
    where: string;
  }> {
    const own = teamId ? await this.settings.teamMail(teamId) : null;
    if (own) {
      const refused = await this.refusedTeamHost(own.host);
      if (refused) throw ZelyqError.badRequest(`That mail server can't be used: ${refused}.`);
      return {
        host: own.host,
        port: own.port,
        security: own.security,
        user: own.username,
        pass: own.password,
        from: own.from,
        where: "Team settings → Email",
      };
    }
    return {
      host: (await this.settings.value("mailHost")).trim(),
      port: Number(await this.settings.value("mailPort")) || 587,
      security: await this.settings.value("mailSecurity"),
      user: (await this.settings.value("mailUsername")).trim(),
      pass: await this.settings.value("mailPassword"),
      from: (await this.settings.value("mailFrom")).trim(),
      where: "Settings → Email",
    };
  }

  /** Why a team may not use this mail server address, or null. */
  async refusedTeamHost(host: string): Promise<string | null> {
    return await refusedHost(host, this.teamGuard);
  }

  /** Whether mail can go out (for this team: its own server, or the server's). */
  async configured(teamId?: string | null): Promise<boolean> {
    try {
      const config = await this.config(teamId);
      return Boolean(config.host && addressOf(config.from));
    } catch {
      return false;
    }
  }

  private async transport(
    teamId?: string | null,
  ): Promise<{ transport: MailTransport; from: string; user: string }> {
    const config = await this.config(teamId);
    if (!config.host) throw ZelyqError.badRequest(`No mail server is set (${config.where}).`);
    if (!addressOf(config.from)) {
      throw ZelyqError.badRequest(
        `Set who email is sent as (${config.where}), such as Zelyq <ops@example.com>.`,
      );
    }
    const transport = this.createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === "tls",
      requireTLS: config.security === "starttls",
      ignoreTLS: config.security === "none",
      ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return { transport, from: config.from, user: config.user };
  }

  /**
   * Sends one message to each address, for a team when given (its own mail server
   * first). A failure is reported, never thrown at the caller's work.
   */
  async send(
    message: MailMessage,
    teamId?: string | null,
  ): Promise<{ sent: number; failed: string[] }> {
    const to = [...new Set(message.to.filter((address) => ADDRESS.test(address)))];
    if (to.length === 0 || !(await this.configured(teamId))) return { sent: 0, failed: [] };
    const { transport, from } = await this.transport(teamId);
    let sent = 0;
    const failed: string[] = [];
    for (const address of to) {
      try {
        await transport.sendMail({
          from,
          to: address,
          subject: message.subject,
          text: message.text,
        });
        sent += 1;
      } catch (error) {
        failed.push(`${address}: ${(error as Error).message}`);
      }
    }
    return { sent, failed };
  }

  /** Signs in to the mail server and sends a short message: the settings work, or it says why not. */
  async test(to: string, teamId?: string | null): Promise<void> {
    const { transport, from, user } = await this.transport(teamId);
    try {
      await transport.verify();
    } catch (error) {
      const message = (error as Error).message;
      // A refused login is nearly always the username: most mail servers want the whole address.
      const hint =
        /\b535\b|invalid login|authentication/i.test(message) && !user.includes("@")
          ? ` Most mail servers want the whole email address as the username (such as ${addressOf(from) ?? "ops@example.com"}), not a name.`
          : "";
      throw ZelyqError.badRequest(
        `The mail server did not accept Zelyq: ${message.replace(/\.$/, "")}.${hint}`,
      );
    }
    try {
      await transport.sendMail({
        from,
        to,
        subject: "Zelyq can send email",
        text: teamId
          ? "This is a test from Zelyq. Your team's email works: invitations and Ops's messages now go out through it."
          : "This is a test from Zelyq. Email works: Ops can now tell you when it needs you, even when the page is closed.",
      });
    } catch (error) {
      throw ZelyqError.badRequest(`The test message was not sent: ${(error as Error).message}`);
    }
  }
}

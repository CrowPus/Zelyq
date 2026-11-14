import { ZelyqError } from "@zelyq/core";
import nodemailer from "nodemailer";
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
  constructor(
    private readonly settings: SettingsService,
    private readonly createTransport: TransportFactory = (options) =>
      nodemailer.createTransport(options) as unknown as MailTransport,
  ) {}

  /** Whether an admin has set a mail server and a sender. */
  async configured(): Promise<boolean> {
    return Boolean(
      (await this.settings.value("mailHost")).trim() &&
        addressOf(await this.settings.value("mailFrom")),
    );
  }

  private async transport(): Promise<{ transport: MailTransport; from: string }> {
    const host = (await this.settings.value("mailHost")).trim();
    const from = (await this.settings.value("mailFrom")).trim();
    if (!host) throw ZelyqError.badRequest("No mail server is set (Settings → Email).");
    if (!addressOf(from)) {
      throw ZelyqError.badRequest(
        "Set who email is sent as (Settings → Email), such as Zelyq <ops@example.com>.",
      );
    }
    const port = Number(await this.settings.value("mailPort")) || 587;
    const security = await this.settings.value("mailSecurity");
    const user = (await this.settings.value("mailUsername")).trim();
    const pass = await this.settings.value("mailPassword");
    const transport = this.createTransport({
      host,
      port,
      secure: security === "tls",
      requireTLS: security === "starttls",
      ignoreTLS: security === "none",
      ...(user ? { auth: { user, pass } } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return { transport, from };
  }

  /** Sends one message to each address; a failure is reported, never thrown at the caller's work. */
  async send(message: MailMessage): Promise<{ sent: number; failed: string[] }> {
    const to = [...new Set(message.to.filter((address) => ADDRESS.test(address)))];
    if (to.length === 0 || !(await this.configured())) return { sent: 0, failed: [] };
    const { transport, from } = await this.transport();
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
  async test(to: string): Promise<void> {
    const { transport, from } = await this.transport();
    try {
      await transport.verify();
    } catch (error) {
      throw ZelyqError.badRequest(
        `The mail server did not accept Zelyq: ${(error as Error).message}`,
      );
    }
    try {
      await transport.sendMail({
        from,
        to,
        subject: "Zelyq can send email",
        text: "This is a test from Zelyq. Email works: Ops can now tell you when it needs you, even when the page is closed.",
      });
    } catch (error) {
      throw ZelyqError.badRequest(`The test message was not sent: ${(error as Error).message}`);
    }
  }
}

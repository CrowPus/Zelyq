import { createServer, type Server } from "node:net";

/** A tiny SMTP server for tests: takes every message in and keeps it. */

export interface Received {
  from: string;
  to: string[];
  data: string;
}

/** Just enough SMTP to take messages in: no TLS, no sign-in, everything kept. */
export function smtpSink(): Promise<{ server: Server; port: number; inbox: Received[] }> {
  const inbox: Received[] = [];
  const server = createServer((socket) => {
    let mail: Received = { from: "", to: [], data: "" };
    let inData = false;
    let buffer = "";
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          mail.data += buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          // Quoted-printable, as nodemailer sends long lines: read it as a person would.
          mail.data = mail.data
            .replace(/=\r\n/g, "")
            .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            );
          inbox.push(mail);
          mail = { from: "", to: [], data: "" };
          socket.write("250 queued\r\n");
          continue;
        }
        const line = buffer.indexOf("\r\n");
        if (line < 0) return;
        const command = buffer.slice(0, line);
        buffer = buffer.slice(line + 2);
        const verb = command.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250-sink\r\n250 OK\r\n");
        else if (verb === "MAIL") {
          mail.from = /<([^>]*)>/.exec(command)?.[1] ?? "";
          socket.write("250 OK\r\n");
        } else if (verb === "RCPT") {
          mail.to.push(/<([^>]*)>/.exec(command)?.[1] ?? "");
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go on\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
          return;
        } else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0, inbox });
    });
  });
}

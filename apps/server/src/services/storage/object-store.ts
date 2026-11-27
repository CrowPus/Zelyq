import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

/**
 * Where Zelyq keeps files it does not need on its own disk: apps nobody has opened for a while
 * (app-sleep.ts). One small interface, two kinds of place:
 *
 * - `s3`: any storage that speaks the S3 protocol — Amazon S3, Google Cloud Storage (with HMAC
 *   keys), Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, Hetzner, MinIO, and others.
 * - `folder`: a folder on this machine, such as a mounted network drive or a second disk.
 *
 * Off by default: a server keeps everything on its own disk until its admin sets this up.
 */
export interface ObjectStore {
  /** What it is, for people: "Amazon S3 bucket my-bucket", "folder /mnt/archive". */
  readonly label: string;
  /** Copies a local file up. Large files go in parts. */
  putFile(key: string, file: string): Promise<{ bytes: number }>;
  /** Copies an object down to a local file. */
  getFile(key: string, file: string): Promise<void>;
  /** Its size, or null when there is no such object. */
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  /** Writes, reads and deletes a small test object: says plainly what is wrong. */
  check(): Promise<void>;
}

export interface S3Settings {
  /** Empty for Amazon S3; else the provider's address, e.g. https://storage.googleapis.com. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Put in front of every key, so one bucket can serve several things. */
  prefix: string;
  /** bucket in the path (MinIO and most self-hosted stores) instead of in the host name. */
  pathStyle: boolean;
}

const PART_BYTES = 16 * 1024 * 1024;

/** A key Zelyq makes is plain: letters, digits, dot, dash, underscore and slashes between them. */
function safeKey(key: string): string {
  if (
    !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(key) ||
    key.split("/").some((p) => p === "." || p === "..")
  ) {
    throw new Error(`Not a storage key: ${key}`);
  }
  return key;
}

function cleanPrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${safeKey(trimmed)}/` : "";
}

export class S3ObjectStore implements ObjectStore {
  readonly label: string;
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly settings: S3Settings) {
    this.prefix = cleanPrefix(settings.prefix);
    const where = settings.endpoint ? new URL(settings.endpoint).host : "Amazon S3";
    this.label = `bucket ${settings.bucket} (${where})`;
    this.client = new S3Client({
      region: settings.region || "auto",
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      forcePathStyle: settings.pathStyle,
      credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
      maxAttempts: 4,
    });
  }

  private key(key: string): string {
    return `${this.prefix}${safeKey(key)}`;
  }

  async putFile(key: string, file: string): Promise<{ bytes: number }> {
    const { size } = await fs.stat(file);
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.settings.bucket,
        Key: this.key(key),
        Body: createReadStream(file),
        ContentLength: size,
      },
      partSize: PART_BYTES,
      queueSize: 4,
      leavePartsOnError: false,
    });
    await upload.done();
    return { bytes: size };
  }

  async getFile(key: string, file: string): Promise<void> {
    const answer = await this.client.send(
      new GetObjectCommand({ Bucket: this.settings.bucket, Key: this.key(key) }),
    );
    if (!answer.Body) throw new Error(`Nothing came back for ${key}.`);
    await pipeline(answer.Body as NodeJS.ReadableStream, createWriteStream(file));
  }

  async size(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.settings.bucket, Key: this.key(key) }),
      );
      return head.ContentLength ?? 0;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: this.key(key) }),
    );
  }

  async check(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
    } catch (error) {
      throw new Error(explain(error, this.settings.bucket));
    }
    const dir = await fs.mkdtemp(
      path.join((await import("node:os")).tmpdir(), "zelyq-store-check-"),
    );
    try {
      const file = path.join(dir, "check");
      await fs.writeFile(file, `Zelyq storage check ${new Date().toISOString()}\n`);
      const key = `zelyq-check/${Date.now()}`;
      try {
        await this.putFile(key, file);
        await this.getFile(key, path.join(dir, "back"));
        await this.delete(key);
      } catch (error) {
        throw new Error(explain(error, this.settings.bucket));
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

/** The provider's answer, as a sentence an admin can act on. */
function explain(error: unknown, bucket: string): string {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode;
  if (status === 404 || e.name === "NoSuchBucket")
    return `There is no bucket called "${bucket}" there. Check its name and the address.`;
  if (
    status === 403 ||
    e.name === "AccessDenied" ||
    e.name === "InvalidAccessKeyId" ||
    e.name === "SignatureDoesNotMatch"
  ) {
    return "The bucket refused these keys. Check the access key and secret, and that they may read, write and delete in this bucket.";
  }
  if (status === 301 || e.name === "PermanentRedirect")
    return "The bucket is in another region. Set the region it was made in.";
  return `The storage could not be reached: ${e.message ?? String(error)}`;
}

export class FolderObjectStore implements ObjectStore {
  readonly label: string;
  private readonly prefix: string;
  constructor(
    private readonly root: string,
    prefix = "",
  ) {
    this.label = `folder ${root}`;
    this.prefix = cleanPrefix(prefix);
  }

  private path(key: string): string {
    return path.join(this.root, ...`${this.prefix}${safeKey(key)}`.split("/"));
  }

  async putFile(key: string, file: string): Promise<{ bytes: number }> {
    const target = this.path(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    await fs.copyFile(file, part);
    // On the drive for real before the app's own copy is removed (a network drive may cache it).
    const handle = await fs.open(part, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(part, target);
    return { bytes: (await fs.stat(target)).size };
  }

  async getFile(key: string, file: string): Promise<void> {
    await fs.copyFile(this.path(key), file);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await fs.stat(this.path(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.path(key), { force: true });
  }

  async check(): Promise<void> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, `.zelyq-check-${Date.now()}`);
      await fs.writeFile(probe, "ok");
      await fs.rm(probe);
    } catch (error) {
      throw new Error(`Zelyq cannot write to ${this.root}: ${(error as Error).message}`);
    }
  }
}

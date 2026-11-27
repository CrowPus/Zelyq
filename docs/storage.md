# Storage: idle apps sleep in a bucket

A server's disk has to hold every app, including the ones nobody has opened for weeks. With
storage set up, those apps **sleep** somewhere cheaper, a bucket or another folder, and the disk
holds only the apps in use. A sleeping app wakes by itself the moment anyone reaches it, so
nobody has to know it slept. The first open takes a few seconds longer.

It is **off by default**: until an admin sets it up, everything stays on the server's disk,
exactly as before.

## Setting it up

**Server settings → Storage**:

1. **Keep sleeping apps in**: *An S3-compatible bucket* or *A folder*.
2. For a bucket, fill in the bucket address, region, bucket name, access key ID and secret access
   key. The secret is stored encrypted, or picked from a Vault.
3. **Put idle apps to sleep after (days)**: 7 by default. 0 turns sleeping off.
4. Save, then press **Test storage**. Zelyq writes, reads and deletes a small file, and says
   plainly what is wrong if that fails.

Make the bucket first, in your provider's console, and keep it **private**. Give Zelyq a key that
may read, write and delete in that bucket only.

| Provider | Bucket address | Region | Bucket name in the path |
| --- | --- | --- | --- |
| Amazon S3 | *(empty)* | the bucket's, e.g. `eu-central-1` | off |
| Google Cloud Storage | `https://storage.googleapis.com` (an HMAC key of a service account) | the bucket's, e.g. `europe-west3` | off |
| Cloudflare R2 | `https://<account id>.r2.cloudflarestorage.com` | `auto` | off |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | e.g. `eu-central-003` | off |
| Wasabi | `https://s3.<region>.wasabisys.com` | e.g. `eu-central-1` | off |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` | e.g. `fra1` | off |
| Hetzner Object Storage | `https://<location>.your-objectstorage.com` | e.g. `fsn1` | off |
| MinIO, SeaweedFS, Garage … | your server's S3 address | what it was set up with | **on** |

A **folder** can be a second disk or a mounted network drive (NFS, SMB): set its path, e.g.
`/mnt/zelyq-archive`. Zelyq must be able to write there.

Every setting can also come from the environment, which shows it read-only in Settings:
`ZELYQ_STORAGE` (`off`, `s3` or `folder`), `ZELYQ_STORAGE_ENDPOINT`, `ZELYQ_STORAGE_REGION`,
`ZELYQ_STORAGE_BUCKET`, `ZELYQ_STORAGE_ACCESS_KEY_ID`, `ZELYQ_STORAGE_PREFIX` (default `zelyq`),
`ZELYQ_STORAGE_PATH_STYLE`, `ZELYQ_STORAGE_FOLDER` and `ZELYQ_SLEEP_IDLE_APPS_AFTER_DAYS`.
`ZELYQ_STORAGE_SECRET_ACCESS_KEY` is copied into Settings, encrypted, the first time the server
starts with it, like every other credential.

## What sleeps, and when

Every few hours Zelyq looks for apps nobody has opened, talked to or previewed for the set number
of days. An app whose preview is running or whose agent is working is left alone. For each idle app:

1. Its installed packages and build caches (`node_modules`, Python environments and the like) are
   removed. They are not worth storing: they come back by themselves with the next preview.
2. Its own files, its undo points and its chat attachments are packed (`tar.gz`), uploaded under
   `<folder in the bucket>/apps/<app id>/`, and **checked where they landed**.
3. Only then is a record written saying where it sleeps, and the files leave the disk.

If someone opens the app while it is being packed, the sleep stops and nothing is left behind.

## Waking

Everything that reaches an app's files wakes it first: opening it, its files, the agent, its
preview, undo, downloads, pipelines and deploys that take
its files. The packed files are fetched, unpacked into place, and the stored copy is deleted,
because a bucket is paid by what it holds. Waking counts as a use, so the app is not put straight
back to sleep.

A sleeping app still counts towards its team's storage, by the size it had when it went.
Deleting a sleeping app deletes its stored copy without waking it.

## Switching it off

Set **Keep sleeping apps in** to *Off*, or the days to 0, and no more apps go to sleep. Apps
already asleep stay where they are until someone opens them, and **storage must stay set up for
that**: an app asleep in a bucket that is no longer set up cannot be woken. Opening it says so, and
nothing is lost. Set the storage up again and it opens.

## Backups

Sleeping apps are not on the server's disk, so a backup of the disk does not hold them. Back up the
bucket too, or turn on its provider's versioning or retention, which keeps deleted and
replaced objects for a while.

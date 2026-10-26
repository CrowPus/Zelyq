# Upload to S3

Uploads a file or folder to an S3 bucket — Amazon S3, or an S3-compatible store such as
Cloudflare R2, MinIO or DigitalOcean Spaces. A folder is synced; a file is copied.

```yaml
- plugin: zelyq/s3-upload@1.0.0
  with:
    source: dist
    bucket: shop-assets
    prefix: releases/${ZELYQ_RUN_NUMBER}
    access_key_id: vault://S3_KEY_ID
    secret_access_key: vault://S3_SECRET
```

| Input | |
| --- | --- |
| `source` | Default `dist`. |
| `bucket` | **Required.** |
| `prefix` | The folder inside the bucket. `${ZELYQ_RUN_NUMBER}`, `${ZELYQ_RUN_ID}` and `${ZELYQ_PIPELINE}` are filled in. |
| `region` | Default `us-east-1`. |
| `access_key_id`, `secret_access_key` | **Required**, from Vault. |
| `endpoint` | Only for an S3-compatible store. |
| `delete` | `true` to remove what is no longer in the source (folders only). |

Runs on runners with the AWS CLI (`aws`).

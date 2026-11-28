<div align="center">

<img src="assets/brand/zelyq-banner.png" alt="Zelyq: build, automate and ship software with AI" width="100%" />

[English](./README.md) · [Français](./README.fr.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Português](./README.pt-BR.md) · [简体中文](./README.zh-CN.md) · [हिन्दी](./README.hi.md) · [Italiano](./README.it.md) · **日本語**

### ソフトウェアの構築、保護、配信、運用を 1 か所で行うオープンソースの開発者プラットフォーム。

エンジニアのように働く AI エージェントでアプリを構築。すべての認証情報を暗号化された Vault に 1 つずつ保管。
自分のマシンでテストとデプロイを行い、動いているものは AI の DevOps エンジニアが見守ります。
**セルフホストでも、ホスト版でも。モデルは自由に選択。テレメトリーなし。**

[![CI](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/CrowPus/Zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.12-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](./tsconfig.base.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](./CONTRIBUTING.md)

**[Web サイト](https://zelyq.dev)** · **[オンラインで試す](https://app.zelyq.dev)** · [クイックスタート](#クイックスタート) ·
[チュートリアル](./docs/tutorial.md) · [ドキュメント](./docs/README.md) · [セルフホスト](./docs/self-hosting.md) ·
[アーキテクチャ](./docs/architecture.md) · [ロードマップ](./docs/roadmap.md) · [コントリビュート](./CONTRIBUTING.md)

</div>

---

## 目次

- [Zelyq を選ぶ理由](#zelyq-を選ぶ理由)
- [プラットフォーム](#プラットフォーム)：[アプリ](#アプリ)、[Studio](#studio)、[エージェント](#エージェント)、[Vault](#vault)、
  [パイプライン](#パイプライン)、[デプロイ](#デプロイ)、[Ops](#ops)
- [チーム、プラン、言語](#チームプラン言語)
- [クイックスタート](#クイックスタート)と[アップデート](#アップデート)
- [好きなモデルを使う](#好きなモデルを使う)
- [仕組み](#仕組み)
- [セキュリティ](#セキュリティ) · [開発状況](#開発状況) · [コントリビュート](#コントリビュート) · [ライセンス](#ライセンス)

---

## Zelyq を選ぶ理由

ソフトウェアを届けるには、ふつういくつもの製品が必要です。AI アプリビルダー、シークレット管理、CI サービス、
デプロイツール、そして当番の誰か。ログインも請求書も、キーが漏れる可能性のある場所も、その数だけ増えます。
Zelyq は、作業の流れに沿って整理された 1 つのプラットフォームに、その道のりをすべてまとめます。

| | モジュール | できること |
| --- | --- | --- |
| **構築** | **[アプリ](#アプリ)** | アプリを説明するだけ。エージェントが計画し、あなたのものになる実際のファイルで構築し、完了と言う前に確認します |
| | **[Studio](#studio)** | アプリ用にも単独でも、画像と動画を生成 |
| | **[エージェント](#エージェント)** | Claude Code、Cursor、VS Code、Gemini CLI など MCP 対応のクライアントが、自身のモデルで Zelyq の中で作業 |
| **保護** | **[Vault](#vault)** | 認証情報は一度だけ保存。暗号化、バージョン管理、監査付きで、アプリ、パイプライン、自分のサーバーから使えます |
| **配信** | **[パイプライン](#パイプライン)** | Zelyq サーバーや自分の Linux、macOS、Windows マシンで、毎回同じ方法でテストとビルド |
| | **[デプロイ](#デプロイ)** | 環境ごとにアプリを自分のマシンへ。承認、凍結、自動ロールバック付き |
| | **[Ops](#ops)** | 話しかけられる AI の DevOps エンジニア。計画を立て、承認を待ち、すべての変更を検証し、動いているものを見守ります |

すべては**チーム**に属します。メンバーを招待してロールを与えれば、すべてのモジュールがそれに従います。

---

## プラットフォーム

### アプリ

作りたいものを説明してください。エージェントが読み、計画し、ファイルを書き、コマンドを実行し、ライブプレビューを
起動します。作業中のツール呼び出しや、変更したファイルはすべて見えます。

- **生成するだけでなく、確認する。** エージェントが終わると、Zelyq はプロジェクトの型チェックやビルドを実行し、
  プレビューがクラッシュしていないか確認します。何かを壊したターンは、完了と報告されるのではなく、修正のために
  エージェントへ戻されます。
- **何を知っているかを明確に。** *エンジニアモード* は検証済みのことと推測を分け、選ばなかった案を示し、
  元に戻せない操作の前には必ず確認します。
- **作る前に計画する。** *アーキテクトモード* は依頼を、レビューできる設計（要件、決定事項、データモデル、API、
  構築計画）に変え、あなたの承認を待ちます。その後 *自動モード* が、決めた上限まで自分で計画を進めます。
- **専門家が待機。** デザイナー（`DESIGN.md`）、DevOps エンジニア（CI、Dockerfile、デプロイ設定）、
  セキュリティ/QA エンジニア（テストとセキュリティスキャン）、シネマティックエンジニア（スクロールで動くページ）。
- **フルスタック。** React + Vite、Python（FastAPI）バックエンド付きの React、Expo React Native。どれも
  デザインシステムから始まります。操作ごとに行レベルセキュリティを設定した Supabase Postgres。
- **既存のものから始める。** GitHub リポジトリをインポートしたり、`/clone <url>` で公開中のサイトを
  作り直したり、`/figma <リンク>` で Figma のフレームとデザイントークンから構築したりできます。
- **どのターンも元に戻せる。** 各ターンの前にスナップショット、変更内容の正確な差分、ワンクリックでの復元。
  プロジェクトはディスク上の普通のファイルなので、そのまま持ち出せます。

[モード](./docs/modes.md)と[エージェントの振る舞い](./docs/agent-behaviour.md)をご覧ください。

### Studio

- **画像**：OpenAI、Google、xAI。参照画像と非公開のライブラリ付き。
- **動画**：Google Veo、xAI。テキストまたは静止画から。

Studio は、ご自身のプロバイダーのキーを使い、料金はご自身のアカウントに請求されます。プロジェクトで有効にすると、
エージェントは設定した上限の範囲で、構築中のアプリ用のアートワークや映像を作れます。クリップはスクロールで動く
ページ用に画像の連番に分割できます。[Studio：画像](./docs/Image-gen/implementation.md)と
[Studio：動画](./docs/Video-gen/README.md)をご覧ください。

### エージェント

いつも使っている AI ツールをそのまま持ち込めます。**エージェント**を使うと、Claude Code、Cursor、VS Code、
Gemini CLI、ChatGPT など MCP に対応したクライアントが、自身のモデルとサブスクリプションで Zelyq の中で作業
できます。アクセスできるのは、あなたが選んだアプリ、パイプライン、環境だけです。

- **権限は 1 つずつ設定**：オフ、許可、承認が必要。コードの読み書き、コマンド実行、プッシュ、パイプライン、
  デプロイ、Studio などそれぞれに設定できます。
- **大事なことは人が承認。** プッシュ、パイプラインの実行、デプロイの変更は、受信トレイで待つリクエストです。
- **安心して元に戻せる。** エージェントがアプリを変更する前に、元に戻すポイントが作られます。
- **シークレットの値は決して表示されない。** エージェントに見えるのは、アプリが受け取るシークレットの名前だけです。

[エージェント](./docs/agents.md)をご覧ください。

### Vault

認証情報は**一度だけ**保存して、どこでも使えます。ファイルに貼り付ける必要はありません。

- **保存時に暗号化**（AES-256-GCM）。**バージョン履歴**、本番用キーのための**保護**フラグ、表示と変更の
  記録付き。
- **参照で使う。** アプリの変数、モデルのキー、パイプライン、環境は `vault://名前` を指します。値は、必要な
  場所で必要なときだけ入ります。
- **ログでは伏せ字に。** パイプラインのログに出たシークレットは `***` と表示されます。
- **自分のサーバーでも。** 範囲を絞ったサービスキーでシークレットを取得するか、`zelyq vault run -- <コマンド>`
  でシークレット付きのプロセスを起動できます。ディスクには何も書き込みません。
- **`.env` をインポートして移行。**

[Vault](./docs/vault.md)をご覧ください。

### パイプライン

パイプラインは短い YAML ファイルか、クリックで編集できる図です。ステージは順番に、ステップも順番に実行され、
各ステップはコマンドか既製のブロックです。

```yaml
name: Shop
runs-on: local                      # the Zelyq server, or one of your machines
source: { app: Shop }
stages:
  - name: Test
    matrix: { node: [20, 22] }      # one copy per version, at the same time
    steps:
      - checkout: true
      - setup: node@${{ matrix.node }}
      - run: npm ci && npm test
        tests: reports/*.xml        # JUnit: passed / failed on the step
  - name: Deploy
    steps:
      - deploy: { to: production, port: 3000 }
```

- **好きな場所で実行。** Zelyq サーバー上の使い捨てコンテナ、または自分の **Linux、macOS、Windows** マシン。
  マシンは 1 つのインストールコマンドで参加し、HTTPS で Zelyq へ外向きに接続するため、ポートを開ける必要は
  ありません。SSH で接続するマシンにも対応しています。
- **速くて柔軟。** 同時に動くステージ、ステージごとに別のマシン、マトリクスビルド、パイプライン間で共有する
  テンプレート。
- **プラグイン。** 入力、Vault のシークレット、出力を含めてステップを一度パッケージにすれば、どのパイプラインでも
  使えます。[パイプラインのプラグイン](./docs/pipeline-plugins.md)をご覧ください。
- **何でもきっかけに。** 手動、git push（パスでの絞り込み付き）、プルリクエスト、スケジュール、別の
  パイプラインの終了、エージェントによるアプリの変更、サービスキーを持つ任意の CI。
- **本格的なパイプラインに必要なものはすべて。** ツールのセットアップとキャッシュ、サービスコンテナ
  （Postgres、Redis）、ステップの出力、JUnit レポート、成果物、承認、再試行、タイムアウト、同時実行の制御。
- **結果を報告。** GitHub や GitLab のコミットとプルリクエストに ✓ / ✗ を表示。

[パイプライン](./docs/pipelines.md)をご覧ください。

### デプロイ

- **環境**：`staging` や `production` など。それぞれが自分のマシン上にあり、それぞれに変数があります。
  staging にはテスト用キー、production には本番用キーを、どちらも Vault から。
- **パイプラインからデプロイ**して、公開前に必ずテスト。Zelyq はアプリの `Dockerfile`、または Node、Python、
  Go、静的サイト向けに自動で書く Dockerfile から、自分のマシン上でイメージをビルドします。レジストリは不要です。
- **自動ロールバック。** 新しいバージョンがヘルスチェックに失敗すると、前のバージョンが自動で戻ります。
- **独自ドメインと HTTPS**、バージョンの切り替えでもダウンタイムなし。
- **ライブログ、CPU、メモリ**、再起動と停止、ワンクリックで以前のバージョンへロールバック。
- **昇格**：staging でテストしたイメージを、ビルドし直さずにそのまま production へ。
- **保護された環境**は管理者の承認を待ちます。**凍結**するとリリース中のデプロイがすべて止まります。

[デプロイ](./docs/deploy.md)をご覧ください。

### Ops

**Ops** はチームの DevOps エンジニアです。入力でも音声でも、アプリの公開、新しいバージョンのリリース、
ドメインの設定、何かが遅い理由の説明などを頼めます。

- **まず確認し、計画を示す。** Ops は自由に状況を確認しますが、変更はすべて、あなたの承認を待つ正確な手順の
  リストになります。元に戻せないステップは個別に確認します。
- **すべての変更を検証。** Zelyq 自身が結果を確認します。ステップはチェックに合格して初めて完了とみなされます。
- **見守りを止めない。** Web サイトとアプリは毎分、マシンは 5 分ごと、証明書とドメインは毎日確認します。
  モデルは使いません。アラートはメール、Telegram、Slack、Discord で届きます。
- **割り当てたものだけに触れる。** 管理者が環境、マシン、パイプライン、コードを 1 つずつ、信頼レベルを付けて
  割り当てます。シークレットの名前は見えても、値は決して見えません。
- **覚えている。** あなたが与えたルールと、問題から得た教訓が保存され、作業のたびに読み込まれます。
- **主導権はあなたに。** 月ごとの支出上限があり、**Ops を一時停止**すればすべてがすぐに止まります。

---

## チーム、プラン、言語

| ロール | できること |
| --- | --- |
| `viewer` | アプリ、ファイル、実行、環境、デプロイ履歴の閲覧 |
| `editor` | 上記に加えて、エージェントへの依頼、パイプラインの実行、デプロイ |
| `admin` | 上記に加えて、メンバー、エージェント、環境、承認、保護されたシークレットの管理 |
| `owner` | チーム自体を含むすべての管理 |

- **アクティビティ。** すべての変更がチームのアクティビティに記録されます。シークレットの表示、パイプラインの
  編集、デプロイのロールバックなど。
- **プランと使用量。** 各チームには、アプリ、ストレージ、パイプラインの実行、メンバー、プレビューの上限が
  あり、サーバーの管理者が設定します。
- **他の人のために Zelyq を運用。** [マネージドモード](./docs/managed-mode.md)ではログインを独自のアカウント
  サービスの背後に置き、[管理 API](./docs/admin-api.md) で自社のシステムからユーザー、チーム、プラン、
  稼働状況を管理できます。
- **9 つの言語。** 画面と組み込みのヘルプは、英語、フランス語、ドイツ語、スペイン語、ポルトガル語、中国語、
  ヒンディー語、イタリア語、日本語に対応し、各自が選べます。
- **使われていないアプリは休止。** しばらく開かれていないアプリは S3 互換のバケットやフォルダーに移り、
  開くと自動で復帰します。[ストレージ](./docs/storage.md)をご覧ください。

---

## クイックスタート

**いちばん早い方法：** **[app.zelyq.dev](https://app.zelyq.dev)** でアカウントを作成してください。無料プランが
あり、インストールは不要です。

**自分で動かす場合：**

```bash
# Requires Node >= 20.12 and pnpm >= 9
git clone https://github.com/CrowPus/Zelyq.git
cd Zelyq
cp .env.example .env    # your configuration: check it before the first start (below)
pnpm install
pnpm dev                # web :5173 · server :8787 · agent :8788
```

<http://localhost:5173> を開き、最初のアカウントを作成します。このアカウントがインスタンスを管理します。
**設定 → モデル**でモデルのキーを追加し（入力または Vault から）、**アプリ**を開いてアプリを作成し、
作りたいものを説明してください。

**VM やリモートサーバーの場合**は、初回起動の前に `.env` の次の項目を変更してください。`203.0.113.10` は
マシンのアドレスかドメインに置き換えます。

| 設定 | 値 | 理由 |
| --- | --- | --- |
| `ZELYQ_WEB_HOST` | `0.0.0.0` | そうしないと、画面がそのマシン上でしか応答しません |
| `ZELYQ_PREVIEW_HOST` | `203.0.113.10` | そうしないと、アプリのプレビューがブラウザーを拒否します |
| `ZELYQ_CORS_ORIGIN` | `http://203.0.113.10:5173` | Zelyq を開くアドレス |
| `ZELYQ_PUBLIC_URL` | `http://203.0.113.10:5173` | Webhook とログインのリンクに使われます |
| `ZELYQ_ALLOW_REGISTRATION` | アカウント作成後に `false` | そうしないと、アドレスを見つけた誰でも登録できます |

ファイアウォールでポート 5173 とプレビュー用ポート（`ZELYQ_PREVIEW_PORT_MIN`–`MAX`、既定は 4300–4399）を
開けてください。インターネットからアクセスできるマシンでは、Zelyq を HTTPS の背後に置いてください。
[セルフホスト](./docs/self-hosting.md)をご覧ください。その他の設定はすべて `.env.example` と
[設定](./docs/configuration.md)で説明しています。

**Docker の場合：** `docker compose -f docker/docker-compose.yml up`。[セルフホスト](./docs/self-hosting.md)を
ご覧ください。

**次に：** [チュートリアル](./docs/tutorial.md)では、Vault、パイプライン、自分のマシン、ロールバック付きの
デプロイ、GitHub のプッシュとプルリクエストまで、アプリを Zelyq から本番まで一歩ずつ進めます。

### アップデート

データはそのまま残ります。データベース、生成したメディア、暗号化キーは `data/` に、アプリは `workspace/` に、
設定は `.env` にあります。Git はこの 3 つを無視し、データベースの変更はサーバーが起動時に自動で適用します。

```bash
cd ~/Zelyq                                    # wherever you cloned it
# 1. Stop Zelyq (Ctrl+C if it runs as `pnpm dev`)

# 2. Back up first
cp -a data ~/zelyq-data-backup-$(date +%F)
cp -a workspace ~/zelyq-workspace-backup-$(date +%F) 2>/dev/null
cp .env ~/zelyq-env-backup-$(date +%F) 2>/dev/null

# 3. Get the new version and rebuild
git pull
pnpm install
pnpm build

# 4. Start Zelyq again the same way as before
```

これらのコマンドは、Zelyq をクローンしたユーザーで実行してください。Git が `detected dubious ownership` で
止まった場合は、`safe.directory` の例外を追加するのではなく、`su - <ユーザー>` でそのユーザーに切り替えて
ください。

Docker の場合：`git pull` のあと `docker compose -f docker/docker-compose.yml up -d --build`。データは
`zelyq-data` ボリュームにあるため、`docker compose down -v` は**決して**実行しないでください。ボリュームが
削除されます。

PostgreSQL を含む詳細は[セルフホスト → アップグレード](./docs/self-hosting.md#upgrading)をご覧ください。

---

## 好きなモデルを使う

| プロバイダー | `ZELYQ_PROVIDER` | 既定のモデル |
| --- | --- | --- |
| Claude | `anthropic` | `claude-opus-5-5` |
| Gemini | `google` | `gemini-pro-latest` |
| OpenAI | `openai` | `gpt-6.1-terra` |
| Grok (xAI) | `xai` | `grok-4.6` |
| DeepSeek | `deepseek` | `deepseek-v4-flash` |
| Mistral | `mistral` | `mistral-large-latest` |
| Groq | `groq` | `llama-3.3-70b-versatile` |
| OpenRouter | `openrouter` | `anthropic/claude-sonnet-4.6` |
| **独自のもの**：Ollama、vLLM、LM Studio など OpenAI 互換のもの | `custom` | `ZELYQ_MODEL` を設定 |

キーは**設定 → モデル**で入力するか Vault から選ぶか、各チームが**チームの設定 → AI キー**で自分のキーを
用意できます。Claude Code や Codex のログインを API キーの代わりに使うこともできます。`custom` を使えば、
プロジェクトの情報がネットワークの外に出ることはありません。[設定](./docs/configuration.md)をご覧ください。

---

## 仕組み

3 つのプロセスとコマンドラインツールが、4 つの共有ライブラリの上で動きます。アプリのファイルとコマンドに
到達できる経路は `RuntimeDriver` の 1 つだけで、そのおかげでローカル、コンテナ、リモートホストが同じように
動きます。

```
   Browser                                 zelyq CLI  (zelyq vault run …)
      │                                        │
      │  REST + WebSocket                      │  HTTPS, service key
      ▼                                        ▼
 ┌──────────────────────────────────────────────────────────┐
 │ apps/server   Fastify · owns the database                │
 │ teams · apps · Vault · pipelines · deploys · Ops         │
 └────┬───────────────────────┬─────────────────────┬───────┘
      │ HTTP + SSE            │                     │ outgoing HTTPS or SSH
      ▼                       │                     ▼
 ┌──────────────┐             │             ┌────────────────────────────┐
 │ apps/agent   │             │             │ Runners and environments   │
 │ model loop,  │             │             │ your Linux, macOS, Windows │
 │ tools        │             │             │ machines: pipelines,deploys│
 └──────┬───────┘             │             └────────────────────────────┘
        │                     │  files, previews, snapshots
        ▼                     ▼
 ┌──────────────────────────────────────────────────────────┐
 │ RuntimeDriver   the only path to disk and shell          │
 │ local · container (one per project) · remote host        │
 └──────────────────────────────────────────────────────────┘
```

| 部分 | 役割 |
| --- | --- |
| [`apps/web`](./apps/web) | 画面：チャット、エディターとプレビュー、Studio、Vault、パイプライン、デプロイ、Ops |
| [`apps/server`](./apps/server) | チーム、アプリ、Vault、パイプラインエンジン、デプロイ、Ops。データベースとやり取りする唯一のプロセス |
| [`apps/agent`](./apps/agent) | モデルのループ。自分でファイルには触れず、すべてのツールが `RuntimeDriver` を通ります |
| [`apps/runner`](./apps/runner) | 自分のマシンにインストールするランナー。Zelyq に接続し、パイプラインとデプロイを実行します |
| [`apps/cli`](./apps/cli) | `zelyq` コマンドライン（例：`zelyq vault run`） |
| [`apps/registry`](./apps/registry) | 署名付きプラグインのレジストリ |
| [`@zelyq/core`](./packages/core) | ドメインの型、パイプラインファイルの形式、通信プロトコル |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` とその実装。プロセスを起動する唯一のコード |
| [`@zelyq/db`](./packages/db) | Drizzle のスキーマとマイグレーション。既定は SQLite、規模に応じて PostgreSQL |
| [`@zelyq/tools`](./packages/tools) | エージェントのツール。`RuntimeDriver` に対して一度だけ書かれています |

詳細は[アーキテクチャ](./docs/architecture.md)をご覧ください。

---

## セキュリティ

Zelyq は確認しやすく作られています。シンプルな保存方式、普通のファイル、テレメトリーなし。シークレットは
保存時に暗号化され、コマンドラインやログに出ることはありません。デプロイの前に、次の制限を知っておいてください。

- **実行モード `local` はサンドボックスではありません。** エージェントのコマンドはサーバーのユーザーとして
  実行されます。1 台のマシンで信頼できる開発者 1 人が使う用途に限ってください。共有やインターネットに公開する
  場合は `ZELYQ_RUNTIME=container` を設定してください。
- **コンテナモードの外向きネットワークは既定で開いています。** クラウドのメタデータエンドポイントと
  プロジェクト間の通信は常に遮断されます。残りを制限するには `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` を設定するか、
  信頼できないコードには[厳格なサンドボックス](./docs/strict-sandbox.md)を使ってください。

デプロイの前に[脅威モデル](./SECURITY.md#threat-model--read-this-before-deploying)を読み、脆弱性は
[SECURITY.md](./SECURITY.md) の手順に従って非公開で報告してください。

## 開発状況

Zelyq は**初期段階で、急速に進化しています**。アプリ、Studio、エージェント、Vault、パイプライン、デプロイ、
Ops はすべて最初から最後まで動作し、毎日使われています。`1.0` までは互換性のない変更があり得ます。
[ロードマップ](./docs/roadmap.md)をご覧ください。

## コントリビュート

Issue、ディスカッション、プルリクエストを歓迎します。[CONTRIBUTING.md](./CONTRIBUTING.md) では、開発の流れ、
リポジトリの構成、変更をどこに入れるのがよいかを説明しています。プルリクエストを出す前に `pnpm lint`、
`pnpm typecheck`、`pnpm test` を実行してください。参加するすべての人は[行動規範](./CODE_OF_CONDUCT.md)に
従います。

## ライセンス

Zelyq は [GNU AGPL-3.0](./LICENSE) の**オープンソース**です。実行、変更、セルフホスト、フォークが自由に
できます。*変更した* Zelyq をネットワーク経由で他者向けのサービスとして運用する場合、AGPL によりその利用者に
ソースコードを提供する必要があります。

クローズドソースの製品や、AGPL のソフトウェアを使えない方針の組織向けに、**商用ライセンス**（同じコードで、
AGPL のネットワーク経由でのソース提供義務がないもの）を用意しています：**support@dee-empire.com**。
「Zelyq Enterprise」と表示された機能（`ee/` のパス）は、[Zelyq Enterprise License](./LICENSE_EE.md) に基づく
別のサブスクリプションです。[LICENSING.md](./LICENSING.md) でわかりやすく説明しています。`v0.1.0` までの
リリースは引き続き Apache-2.0 で利用できます。

<div align="center">
<br />

© 2026 [Dee Empire](https://dee-empire.com) · 「Zelyq」および Zelyq のロゴは Dee Empire の商標です。

</div>

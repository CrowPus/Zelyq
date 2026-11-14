/**
 * Playbooks: the fixed procedure for each kind of job (072 §5.2). The model
 * brings judgment inside a step (which machine, why a log says what it
 * says); it does not invent the procedure. Same words for Zelyq's own
 * engineer and, through devops_guide, for an outside one.
 */
export const PLAYBOOKS = `## Survey (before any plan)
1. survey_app for the app: kind, start command, port, variables it reads, database, migrations, workers, scripts.
2. list_machines; machine_status (disk, size) and machine_ports (ports in use) for the machine you would use.
3. list_environments; app_status and deployment_history for anything already live.
4. read_sheet for the app and the environments; recall the app's name and anything that looks familiar; journal.
5. Say in two or three sentences what you found, before proposing anything.

## Launch (an app goes online for the first time)
1. Survey.
2. needed_secrets for each environment. For every missing secret: request_secret, then wait (secret_present) — never continue without it.
3. Plan, in this order, exact inputs:
   a. create_environment staging (not protected) and production (protected: true) on the chosen machine, if they do not exist. Only with a domain the person owns, give production and staging that domain (apps then get <app>.<domain>). Without one, leave domain out: never put an IP address there.
   b. set_environment_variables on each: the app's secrets as vault://NAME; plain settings as values.
   c. create_pipeline from blocks (pipeline_blocks): test → deploy to staging → deploy to production. Use database: postgres when the app uses Postgres; migrate: npm run <the migrate script survey_app found> (never a script file that does not exist); volumes: for uploads; processes: for workers. Without a domain, give each environment its own host-port, chosen from machine_ports' free ones (never guess a port: two things cannot listen on one).
   d. run_pipeline once the person approved (with run_step, like every planned step).
   e. set_app_address for the person's domain, after it is live.
   f. write_sheet for the app.
4. After the run: check_deployment on staging and production. With a domain: check_dns (environment: production) and check_certificate.
5. If DNS is not in place: tell the person exactly the record to add (type A, name, value = the machine's address) and check_dns again later; do not call it live at the domain until it leads there.
6. Finish with what is live where, what was proven, and anything the person still has to do.

## Ship (a change goes out)
1. read_sheet for the app; get_pipeline; deployment_history on staging and production; app_status.
2. Look at what is new: if the app has a migrate step, this version may change the database. Say so before planning. Zelyq does not take automatic backups yet: when production has real data and the change touches the database, tell the person before they approve.
3. Plan: run_pipeline, one step. It deploys to staging, and to production only after staging is healthy; a protected production waits for the approval of this plan (it is not asked twice).
4. After: check_deployment on staging, then on production. If production failed its health check, Zelyq already put the previous version back: say so, read why (the run's last lines, app_status), and plan the fix. Never run the same thing again unchanged.
5. write_sheet if anything about how the app runs changed. Finish with the version now live in each place.

## Database and storage
1. survey_app says whether the app uses a database (Postgres) and has uploads.
2. list_databases and the environment's variables. If the person has their own database (Supabase, a managed Postgres): request_secret DATABASE_URL, then set_environment_variables DATABASE_URL=vault://DATABASE_URL on that environment; Zelyq then starts none.
3. Otherwise give the deploy step database: postgres. Each environment gets its own database beside the app, kept across new versions in a named volume; staging never shares production's.
4. Uploaded files: volumes: [{name: <name>, path: <the folder the app writes to>}], one per folder; they survive new versions. Never a folder the image itself ships.
5. Database updates: migrate: npm run <the script survey_app found>. It runs in the new version before it takes traffic; if it fails, nothing is swapped.
6. Prove it: check_deployment after the deploy; after a second version, the data is still there (the app's own health answer or a page that reads it).

## Domain and HTTPS
1. check_dns for the domain (environment: the one it should lead to).
2. If it does not lead there: tell the person the exact record. Never change their DNS yourself.
3. If the environment has no domain yet, update_environment with the domain (apps then answer at <app>.<domain>), or set_app_address for one exact name (shop.com), once the app is live.
4. check_ports (80 and 443 must answer from outside; a closed port is usually the cloud's firewall: tell the person exactly which to open).
5. check_certificate. A certificate can take a minute after DNS is right; check again before calling it done.

## Secrets
1. needed_secrets. 2. request_secret for each missing one, with why. 3. secret_present until it is there. 4. set_environment_variables with vault://NAME. Never put a value in a plan, a message or a variable.

## Explain (questions)
Answer from the real state: list_environments, app_status, deployment_history, list_pipelines, read_sheet, journal. Say what runs where and how a change gets there. No plan is needed to answer a question; finish the job with the answer.

## When something fails
1. Read the real output (the run's last lines, app_status, the step's result). 2. Say what it means in plain words. 3. Change something real before trying again — the same attempt is refused. 4. After two failed attempts at the same goal, stop: finish the job as failed with what you found and what the person can do. 5. If it was your mistake, learn_lesson with the failed step as evidence; switch on a check if one fits.`;

# Production gate finalization — 2026-10-06

## Decision

**NOT READY.** Production was NOT modified. No DNS, owner password, Google OAuth,
production deployment or live genealogy relationships were changed in this task.

The owner deferred real SMS and external email tests. They remain explicit open
gates, not assumed passes. Independent code and verification work continued.

## Release

- Branch: `codex/integration-regression-2026-10-02`.
- Verified UI application commit: `adfe2b58b0f0f9e0c208c9c5342cd01a63bf5cc1`.
- Frontend staging version: `40b06124-cbc5-42fc-a802-354e84bbf62d`, 100% traffic.
- Backend staging version: `7c4e5563-bd95-491d-8c4d-cd8de95ad98e`, 100% traffic.
- Both Cloudflare builds succeeded for this exact application commit.
- GitHub Actions [verify run](https://github.com/AriukagiinTuvshoo/guulingiinhan/actions/runs/37395750440)
  and [second run](https://github.com/AriukagiinTuvshoo/guulingiinhan/actions/runs/37395754561)
  completed successfully. The first run's jobs/steps confirmed all required checks,
  including npm ci, locked backend install and the PostgreSQL migration cycle.

## 1. Production Gates

| Gate | Status | Evidence |
| --- | --- | --- |
| SMS/OTP | NOT TESTED | Owner deferred provider configuration/live delivery. Staging phone config remains `enabled:false`; validator is preserved. |
| DB Backup | PASS | All 44 application tables encrypted inside PostgreSQL; private R2 backup downloaded and matched; naming, custody, retention and native-provider procedure documented. No schedule or lifecycle deletion was activated. |
| DB Restore | PASS | Isolated SCRAM PostgreSQL restore; exact comparison of every row; foreign keys; schema consistency; 8 authorized application reads and 8 anonymous denials; populated-target restore rejected. |
| Media Backup | BLOCKED | Encrypted backup/restore tooling and binary/tamper/path/auth tests pass. Actual R2 media export did not complete: Cloudflare 1010 and approval review blocked a browser User-Agent retry. No completed media manifest or actual media restore is claimed. |
| Email Register | NOT TESTED | SMTP config is enabled; owner deferred the approved mailbox and real register → email → verify → login delivery flow. |
| Password Reset | NOT TESTED | Real reset email/link/new-password flow deferred. Automated invalid/expired/reused token tests pass; owner's password untouched. |
| Accessibility | PASS | Focused local Chromium audit: 14 routes with zero axe violations; 16 practical keyboard/accessibility-tree checks; dialog focus/Tab/Escape/return and mobile drawer fixed. This is scoped verification, not WCAG certification or a speech-reader certification. |
| Domain Readiness | PASS | Exact frontend/API/Worker/zone/TLS/CORS/cookie/email/private-media cutover and rollback steps documented. Domain not supplied; `site.app` still initializing. No DNS changed. Google remains disabled. |
| Tree Regression | PASS | 800 synthetic people/799 parent-child/90 marriage layout regression; root-path checks; backend genealogy/security coverage; local 390×844 and 768×1024 2D/3D canvas/navigation checks; authenticated staging tree/toggles loaded. Renderer and genealogy logic unchanged. Only proven dialog keyboard accessibility was corrected. |
| Security Regression | PASS | Full backend suite includes foreign Family/Person denial, public/private content, global/family roles, minors and private media. Deployed anonymous Admin/shared ancestry/community/People requests return 401; R2 public access disabled and no custom bucket domains. |
| Automated Tests | PASS | 207 pytest tests, Ruff including operator tooling, typecheck, Next build, 25 route checks, Vinext build, root/memory/tree tests, 3 native encrypted-media tests; clean isolated upgrade → downgrade one → upgrade → consistency and CI all pass. No tests skipped. |
| Staging | BLOCKED | Deployment, health/readiness, public auth pages and authenticated desktop routes pass. Full gate remains open for authenticated runtime console/network and mobile keyboard verification; real registration/reset/OTP delivery is deferred. These missing observations are not reported as PASS. |

## Verification details

### Focused accessibility corrections

Actual keyboard failures were reproduced before editing: opening a Tree relation
dialog left focus outside it, Shift+Tab escaped it, and Tab escaped the mobile
drawer. A reusable focus hook now enters/traps/restores focus and handles Escape
for the drawer, Tree dialogs and Admin confirmation. Cancel and Escape were tested
without saving. Auth error text is associated with its form/fields. Small paper
surface labels were darkened; a dashboard heading on a dark panel was corrected.

Axe's image/background contrast and some ARIA findings remained **incomplete**,
not automatically passed. Practical accessibility-tree names, visible field focus
and keyboard checks supplemented the automated audit. Image-dependent contrast
and speech output are not comprehensively certified by this run.

### Actual staged browser observations

Authenticated TinyFish run
[57fd79fd-cec5-439a-b0ec-1f8d50ec2478](https://agent.tinyfish.ai/runs/57fd79fd-cec5-439a-b0ec-1f8d50ec2478)
confirmed `/admin/ancestry`, `/admin`, Dashboard, common ancestry, Community, News,
Tree, People, Stories, Memories, Archives, own Profile/photo and Settings loaded
without the previous full-page error boundary. It did not save or delete content.

That desktop run did not emulate 390px or open the intended relation-edit dialog;
clicking a profile/detail view was not accepted as a modal-focus test. The local
keyboard test correctly used the relation action and passed. Mobile staging and
authenticated runtime console/network inspection remain separate open checks.

The focused follow-up
[c3974351-2e0c-413e-aea6-9b6d7c273d56](https://agent.tinyfish.ai/runs/c3974351-2e0c-413e-aea6-9b6d7c273d56)
timed out with no result. It is not a dialog PASS and does not establish an
application defect. The deployed authenticated dialog/console/mobile gate remains
BLOCKED; the successful local test is not substituted for it.

Documentation commit `0460a88af28a6d10bc8ff3380e9b5652c2cba8a0` passed CI runs
`37398061486` and `37398064891`; both staging builds succeeded and reached 100%.
Its frontend/backend versions are `f26f2e7d-b143-4d60-958e-02bf659b7cb9` and
`b5f291cd-e34e-4ecd-b652-fe4036fd82e3`. Application source is unchanged from `adfe2b5`.

The documentation-only rollout was checked again in native Chromium: health and
readiness 200, four anonymous protected requests 401, zero guest page exceptions
or HTTP 5xx. Generic `fetch` inside the Cloudflare MCP runtime was denied by that
tool's host allowlist; its 403 was not an application response.

Final operator hardening rejects all restore-URL query overrides (including
`host`/`hostaddr`); these could otherwise override a loopback URL. The focused
recovery suite now has 14 passing cases. This operator-only change does not
modify application routes, the Tree or staging family data.

An independent deployed Chromium guest smoke pass confirmed login, register,
password-reset and ancestry route HTML; health/readiness 200; four protected API
requests 401; zero uncaught page errors and zero HTTP 5xx in that guest pass. It
does not prove the authenticated browser has no console/network errors.

### Recovery boundaries

The database backup covers all application tables, not Supabase-managed schemas
or PostgreSQL roles. [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) documents the additional
native/provider backup and custody needed before production. Actual data was
restored only into a disposable loopback instance. That instance, decrypted JSON
and raw temporary GPG keyring were stopped/removed. Encrypted R2 backup and
owner-only DPAPI sealed local keys/aggregate evidence remain. No decrypted data,
backup or private key is committed to Git.

The unsuccessful maintenance Worker was deleted. It added no application auth
endpoint. An every-minute schedule and a 30-day deletion rule were separately
rejected by automatic approval review; neither was installed. Retention is a
documented proposal requiring owner approval, not a running automated service.

## 2. Exact Owner Actions

### Deferred SMS — when the owner resumes it

Provide an approved test number and Twilio account/sender availability. In
**Cloudflare → Workers & Pages → guulingiinhan-backend-staging → Settings →
Variables and Secrets**, configure `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and strong `OTP_HASH_SECRET`; credentials
belong in secrets, never chat. Verify actual receipt, correct/wrong/expired code,
rate/attempt/resend limits, authenticated session and logout. Production settings
are a separate later approval; do not weaken the production validator.

### Deferred email — when the owner resumes it

Provide a disposable approved mailbox. Check the same staging backend's
`EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
`EMAIL_SMTP_STARTTLS`, `EMAIL_PUBLIC_BASE_URL`, and secret
`EMAIL_SMTP_USERNAME`/`EMAIL_SMTP_PASSWORD`. Existing SMTP availability is not
delivery evidence. Verify register/confirmation/login and reset/new password;
reject invalid/expired/reused tokens. Use only a disposable test account, then
clean it up. Do not alter the owner's password. No production change is implied.

### Private media recovery approval

Approve a one-off standard-browser request to a newly recreated, expiring,
secret-triggered **owned staging recovery Worker**. Automatic review rejected the
retry after Cloudflare 1010 as a possible protection bypass. The HTTP result would
contain counts only; encrypted objects would remain in private R2. Complete native
binary export, manifest/integrity validation, isolated profile/Memory/Story media
restore and access denial, then delete the helper. No Archive binary restore is
claimed because that feature is not implemented at this revision.

### Recovery operations

Approve the operating frequency/retention/deletion policy before installing it.
Move recovery private-key custody into the owner's passphrase-protected vault and
second recovery location: Windows DPAPI/Temp alone is not portable disaster
recovery. Configure native/provider PostgreSQL backup and production private R2
backup only for the expressly confirmed production resources. Rehearse a restore
and missed-backup alert before introducing production data.

### Final staged browser checks and domain

On the authenticated staged app, verify the 390px mobile drawer with Tab,
Shift+Tab and Escape; check the Tree relation-edit and Admin confirmation dialogs;
inspect console/network for uncaught/hydration errors and broken assets. Record
the observed result rather than extrapolating from the guest/local pass.

Once purchased, provide the exact domain and active Cloudflare zone. Follow
[CLOUDFLARE_CUSTOM_DOMAIN.md](CLOUDFLARE_CUSTOM_DOMAIN.md) on staging first. No domain
purchase, DNS change, Google enablement or production cutover is authorized here.

## 3. Final Scores

These are coarse acceptance-group scores; hundreds of unit tests do not outweigh
a missing provider or recovery gate. They are not directly comparable with the
previous audit's different denominator.

- **Implementation/work-package completion: 6 / 8 × 100 = 75%.** Of the ten
  requested packages, SMS and real email were explicitly deferred. Six remaining
  packages are complete (database, focused accessibility, domain plan, tree,
  security, automated checks); actual media recovery and full staging verification
  remain open. Tooling implementation does not make an unexecuted drill complete.
- **QA verification: 7 / 12 × 100 = 58.33%.** Seven gate groups are fully PASS;
  partial observations, three deferred provider gates and two BLOCKED groups are
  not counted as verified.
- **Production: 7 / 12 × 100 = 58.33%.** Same mandatory production gate inventory;
  no readiness claim based on local tests or deployment success alone.

**Final decision: NOT READY.** The updated application is deployed to staging,
while the external delivery/recovery and final browser gates remain explicit.

# Өгөгдлийн сан

> **Төлөв:** Энэ баримтын P4.11 хүртэлх хэсэг `c441b2f3a805` дээрх байдлыг тайлбарлана. Түүнээс хойш нэмэгдсэн хүснэгт, баганыг доорх «P4.11-ээс хойших өөрчлөлт» хэсэгт `backend/app/models.py` (commit `89fb107`)-аас нэгтгэв. Одоогийн head-ийг `cd backend && uv run alembic heads`-ээр шалгана.

Migration дараалал нэг шугамтай байхаа больсон. `d8150b6a9e3c` нь `f0b3c8d1e2a4` (step parent relationship) ба `f71a2c5d90e1` (private person profile photos) гэсэн хоёр head-ийг нэгтгэсэн merge migration; олон head үлдвэл `alembic upgrade head` алдаа өгнө. P4.11 хүртэлх шугам: `4532a98a2fe5` → `f10695a88229` → `74a31c87f462` → `b762e4a19d30` → `cc924bf31a12` → `2e9d7f4c1a63` → `9b36d2c718fa` → `a71d3f0c92b4` → `b51c9e7a60f4` → `e8b0a6c14d29` → `d4a9f73b8210` → `c441b2f3a805` (P4.11 head). `c441b2f3a805` нь `audit_logs.request_id` correlation талбар, `photos.cleanup_attempts` bounded retry тоолуур нэмнэ.

| Хүснэгт | Хэрэглээ |
|---|---|
| users | Нэвтрэх account-ийн identity |
| families, family_members | Гэр бүл ба account-ын гишүүнчлэл |
| persons, family_persons | Удамд буй хүн ба гэр бүлийн context |
| parent_child_relationships | Биологийн, үрчилсэн, хойд эцэг эхийн холбоо (`relationship_type`: `biological` / `adoptive` / `step`) |
| marriages | Хань, салалт, бэлэвсэн холбоо |
| biographies, life_events | Намтар, он цагийн үйл явдал |
| memories, photos, photo_person_tags | Дурсамж, object storage reference, tag |
| user_sessions | Хугацаатай session cookie-ийн зөвхөн hash |
| login_throttles | Hash key-ээр хадгалсан нэвтрэлтийн оролдлогын богино хугацааны тоолуур |
| invitations | Нэг удаагийн, хугацаатай гэр бүлийн урилга |
| email_verification_tokens, password_reset_tokens | Нэг удаагийн email token-ийн hash, expiry, consume төлөв |
| audit_logs | Хэн ямар entity үйлдсэнийг PII агуулахгүй бүртгэл; `request_id` нь API request log-той correlation хийх nullable UUID string |
| person_guardianships | Нэг Family/Person/guardian User-д олгосон нэг scope-ийн хугацаатай, цуцалж болох эрх |
| login_identities | Email, phone, Google identity-г User account-д холбох registry |
| identity_link_requests | Ирээдүйн verification-д зориулсан хугацаатай, эрх олгодоггүй хүсэлтийн бүртгэл |
| phone_otp_challenges | HMAC OTP digest, зориулалт, төлөв, оролдлого ба хугацаа; raw OTP агуулахгүй |
| photos | Family/memory, хувийн object key, MIME/size/dimensions, thumbnail key, uploader metadata |
| photo_person_tags | Зураг ба Person-ийн tag холбоос; хүнээр хайх индекс |

`person_guardianships` нь composite foreign key ашиглан Person family context болон guardian-ийн family membership-ийг батална. Scope нь `view_profile`, `edit_profile`, `manage_biography`, `manage_events`, `manage_memories`, `manage_media`; төлөв нь `active` эсвэл `revoked`. Active scope давхардахгүй partial unique index-тэй. Expiry-г authorization шалгалт бүрд мөрдөнө.

`login_identities` нь email/phone-д `(provider, normalized_identifier)`, Google-д `(provider, issuer, subject)` partial unique index хэрэглэнэ. Имэйл normalization нь whitespace trim + Unicode `casefold`; Gmail alias хувиргалт хийхгүй. Migration ганцхан User-д харгалзах normalized email identity-г backfill хийнэ; case-insensitive collision-той хуучин User-үүдийг автоматаар нэгтгэхгүй, identity үүсгэхгүй. `users.email`, `password_hash`, `email_verified_at` хэвээр бөгөөд verified огноог identity-д хуулна.

`identity_link_requests` нь 24 цагийн pending хүсэлтийг account эзэмшигчид scoped хадгална. OTP/OIDC баталгаажуулалт байхгүй тул энэ хүсэлтийг identity болгон consume хийх боломжгүй; энд нууц code/token хадгалахгүй.

`phone_otp_challenges` нь E.164 дугаар + purpose + challenge ID-д холбосон 6 оронтой кодын HMAC digest хадгална. Challenge 5 минут хүчинтэй, 5 удаагийн буруу оролдлогын дараа түгжигдэнэ; 60 секунд resend cooldown-той. Pending challenge-д зориулсан partial unique index давхардлыг хаана. Хуучирсан challenge 90 хоногоос хойш шинэ OTP хүсэлтийн үеэр цэвэрлэгдэнэ. HMAC pepper нь production environment-ийн `OTP_HASH_SECRET`; development-д restart бүрт солигдох process-local key.

P4.9-ийн `photos.object_key`, `thumbnail_object_key` нь private bucket/filesystem доторх opaque key. `file_size`, `mime_type`, dimensions, original filename нь metadata; binary-г DB-д хийхгүй. `d4a9f73b8210` хуучин мөрүүдэд metadata default backfill хийнэ. Downgrade нь шинэ metadata ашиглаж байгаа зураг байвал мэдээллийг чимээгүй алдахгүйн тулд цуцлагдана.

P4.10-ийн `photos.storage_status` нь `uploading`, `ready`, `deletion_pending` төлөвтэй бөгөөд migration хуучин мөрүүдийг `ready` болгоно. Зөвхөн `ready` зураг уншигдана. Storage upload/delete нь DB transaction-тэй атом биш тул бүтэлгүй upload ба устгал `deletion_pending` tombstone болж үлдэж болно; дараагийн эрхтэй photo/memory жагсаалт эсвэл upload хүсэлт хязгаартай retry хийнэ. 15 минутаас хуучин `uploading` мөр мөн retry-д орно. P4.11-ийн `cleanup_attempts` нь нэг зурагт хадгалагдах нийт retry-г хамгийн ихдээ 20-оор хязгаарлана. `ix_photo_family_storage_status` нь family-ийн retry/list төлөв шалгалтад зориулагдсан.

P4.11-ийн `audit_logs.request_id` nullable тул өмнөх мөрүүд өөрчлөгдөхгүй; шинэ үйлдэл бүрийн request ID-г API логтой тулгаж болно. Энэ нь secret/PII хадгалахгүй.

P4.2–P4.4 migration нь өмнөх хүснэгт/мөрүүдийг устгахгүй. `downgrade -1` нь зөвхөн туршилтын DB дээр зөвшөөрөгдөнө; P4.4-ийн дараа үүссэн OTP challenge мөрүүд буцаахад арилна. Production rollback-д forward-fix хэрэглэнэ.

Огноо тодорхойгүй хүнийг `birth_date = NULL`, нэмэлт тайлбарыг `birth_date_note`-д хадгална. Нас барсан эсэх нь `is_alive`-аар ялгагдана. Гэрлэлт хүний хоёр ID-г тогтмол дараалалд хадгалдаг.

Family устгал нь archive, Person устгал нь family-ээс салгах үйлдэл. Marriage устгал нь record-ийг soft-delete хийж түүхийг хадгална. Schema өөрчлөхдөө model-ийг шинэчилж `alembic revision --autogenerate -m "..."` үүсгээд migration-ийг шалгасны дараа `alembic upgrade head` ажиллуулна.

`alembic downgrade -1` нь зөвхөн түр/туршилтын өгөгдлийн санд migration-ийн буцаалтыг шалгахад хэрэглэгдэнэ. Одоогийн `74a31c87f462` downgrade нь session, invitation, throttle, audit хүснэгтүүдийг буулгах тул тэдгээрт үүссэн өгөгдөл алдагдана. Production rollback-ийг шууд downgrade-аар хийхгүй; forward-fix migration ашиглаж, буцаалт шаардлагатай бол нөлөөлөх өгөгдлийг эхлээд нөөцөлж сэргээх төлөвлөгөө батална.

## P4.11-ээс хойших өөрчлөлт

Эх сурвалж: `backend/app/models.py` (commit `89fb107`, branch `codex/root-link-picker-2026-10-09`). Migration файлуудын бүрэн жагсаалт: `backend/migrations/versions/`. Migration бүрийг гараар тулгаагүй; нийтлэхээс өмнө `alembic heads` ба `alembic check`-ээр баталгаажуулна.

### Шинэ хүснэгтүүд

| Хүснэгт | Хэрэглээ |
|---|---|
| admin_grants | Family-ээс хамаарахгүй глобал эрх: `SUPER_ADMIN`, `ADMIN`, `MODERATOR` (`user_id` нь PK) |
| admin_bootstrap | Нэг удаагийн marker: устгагдсан super admin restart-аар дахин эрх авахаас сэргийлнэ |
| shared_ancestry | Singleton (`CHECK id = 1`): бүх account-д нийтлэг удмын үндэс (`root_person_id`) |
| shared_ancestry_persons | Холбогдсон account өөрөө нийтлэг модонд оруулахыг зөвшөөрсөн Person (`person_id` PK, `family_id`, `added_by`, `shared_at`) |
| shared_ancestry_relationships | Хуучин projection: нийтлэг модны эцэг эх-хүүхдийн ирмэг. Canonical эх үүсвэр нь `parent_child_relationships` |
| root_connections | Гэр бүлийг нийтлэг үндэстэй холбох хүсэлт ба шийдвэр. PK = `family_id` тул гэр бүл тус бүр дээд тал нь нэг холболттой; `person_id` → `target_person_id`; `status`: `pending` / `approved` / `rejected` / `disconnected`; `relationship_type`; `consented_at`; батлагдсан үед `canonical_edge_id` |
| shared_donation_info | Singleton (`CHECK id = 1`): нийтийн банкны шилжүүлгийн мэдээлэл, QR, `is_published` |
| family_funds, donations | Гэр бүлийн сан (`visibility`: `family` / `public`) ба хандив (`amount_minor` BIGINT, `status`: `pledged` / `reported` / `confirmed` / `cancelled`) |
| family_events, event_registrations | Цуглаан, хураамж, бүртгэл. Бүртгэл `(event_id, user_id)`-ээр давхардахгүй; төлбөрийн төлөв `unpaid` / `reported` / `confirmed` |
| user_person_links | Account ↔ Person холбоос; `user_id`, `person_id` тус бүр unique |
| person_link_requests | Account-аас оршин буй Person-ийг өөрийнх гэж холбох хүсэлт; family + user бүрт нэг `pending` (partial unique) |
| announcements | Нэвтэрсэн хэрэглэгчдэд харуулах нийтлэг мэдэгдэл |
| lineages, branches, person_lineage_assignments | Нэг Family доторх удмын шугам ба салаа; Person бүрт нэг одоогийн оноолт |
| stories, story_persons, archives, archive_persons | Family-scoped түүх ба архивын бүртгэл; composite FK-ээр Family context-ыг батална |
| memory_likes, memory_comments, memory_person_tags | Дурсамжийн like, comment (≤ 2000 тэмдэгт; `(memory_id, user_id, request_key)` давтан илгээлтээс сэргийлнэ), Person tag |

### Өөрчлөгдсөн багана, constraint

- `users.profile_photo_key`, `users.profile_photo_cleanup` нэмэгдсэн.
- `persons.profile_photo_key`, `persons.profile_photo_url`; `persons.search_first_name`, `search_last_name`, `search_middle_name` нь хайлтын түлхүүр (`b51c9e7a60f4`).
- `families.root_person_id`, `families.featured_person_id` (`ON DELETE SET NULL`), `families.description`, `families.profile_photo_key`.
- `parent_child_relationships.relationship_type` нь `biological`, `adoptive`, `step` утгатай (`f0b3c8d1e2a4`).
- `email_verification_tokens.target_email` нэмэгдсэн.
- `phone_otp_challenges.user_id` nullable (бүртгэлийн урсгалд account хараахан байхгүй); `purpose` нь `phone_link`, `phone_login`, `phone_registration`, `password_recovery`; `provider_session_id` (unique, nullable) ба `provider_checked_at` нь гадны provider-ийн session ID болон шалгасан цагийг хадгална.
- `invitations`-д идэвхтэй (accepted/revoked биш) урилга `(family_id, invited_email)`-ээр давхардахгүй partial unique index `uq_invitation_active_family_email` нэмэгдсэн.

### `ON DELETE` анхаарах дүрэм

- `shared_ancestry.root_person_id`, `root_connections.person_id`, `root_connections.target_person_id` нь `RESTRICT`. Эдгээрт ашиглагдаж буй Person-ийг устгахаас өмнө холболтыг салгах эсвэл root-ийг солих шаардлагатай.
- `shared_ancestry_persons.person_id`, `root_connections.family_id` нь `CASCADE`.
- `families.root_person_id`, `families.featured_person_id` нь `SET NULL`.

### Нийтлэг мод ба холболтын тэмдэглэл

- `parent_child_relationships` нь canonical эх-хүүхдийн холбоо. `shared_ancestry_relationships` нь хуучин projection тул шинэ холбоог canonical хүснэгтэд хадгална.
- Эцэг эх-хүүхдийн цикл шалгалт нь PostgreSQL дээр `pg_advisory_xact_lock`-оор ancestry бичилтүүдийг цуваа болгодог (`backend/app/relationships.py`).
- Singleton хүснэгтүүд (`shared_ancestry`, `shared_donation_info`) `CHECK (id = 1)`-тэй.

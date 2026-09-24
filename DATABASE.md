# Өгөгдлийн сан

Migration дараалал нэг шугамтай: `4532a98a2fe5` → `f10695a88229` → `74a31c87f462` → `b762e4a19d30` → `cc924bf31a12` → `2e9d7f4c1a63` → `9b36d2c718fa` (P4.6 head). `9b36d2c718fa` нь email verification/password reset token хүснэгт болон invitation revocation талбар нэмдэг.

| Хүснэгт | Хэрэглээ |
|---|---|
| users | Нэвтрэх account-ийн identity |
| families, family_members | Гэр бүл ба account-ын гишүүнчлэл |
| persons, family_persons | Удамд буй хүн ба гэр бүлийн context |
| parent_child_relationships | Биологийн/үрчилсэн эцэг эхийн холбоо |
| marriages | Хань, салалт, бэлэвсэн холбоо |
| biographies, life_events | Намтар, он цагийн үйл явдал |
| memories, photos, photo_person_tags | Дурсамж, object storage reference, tag |
| user_sessions | Хугацаатай session cookie-ийн зөвхөн hash |
| login_throttles | Hash key-ээр хадгалсан нэвтрэлтийн оролдлогын богино хугацааны тоолуур |
| invitations | Нэг удаагийн, хугацаатай гэр бүлийн урилга |
| email_verification_tokens, password_reset_tokens | Нэг удаагийн email token-ийн hash, expiry, consume төлөв |
| audit_logs | Хэн ямар entity үйлдсэнийг PII агуулахгүй бүртгэл |
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

P4.2–P4.4 migration нь өмнөх хүснэгт/мөрүүдийг устгахгүй. `downgrade -1` нь зөвхөн туршилтын DB дээр зөвшөөрөгдөнө; P4.4-ийн дараа үүссэн OTP challenge мөрүүд буцаахад арилна. Production rollback-д forward-fix хэрэглэнэ.

Огноо тодорхойгүй хүнийг `birth_date = NULL`, нэмэлт тайлбарыг `birth_date_note`-д хадгална. Нас барсан эсэх нь `is_alive`-аар ялгагдана. Гэрлэлт хүний хоёр ID-г тогтмол дараалалд хадгалдаг.

Family устгал нь archive, Person устгал нь family-ээс салгах үйлдэл. Marriage устгал нь record-ийг soft-delete хийж түүхийг хадгална. Schema өөрчлөхдөө model-ийг шинэчилж `alembic revision --autogenerate -m "..."` үүсгээд migration-ийг шалгасны дараа `alembic upgrade head` ажиллуулна.

`alembic downgrade -1` нь зөвхөн түр/туршилтын өгөгдлийн санд migration-ийн буцаалтыг шалгахад хэрэглэгдэнэ. Одоогийн `74a31c87f462` downgrade нь session, invitation, throttle, audit хүснэгтүүдийг буулгах тул тэдгээрт үүссэн өгөгдөл алдагдана. Production rollback-ийг шууд downgrade-аар хийхгүй; forward-fix migration ашиглаж, буцаалт шаардлагатай бол нөлөөлөх өгөгдлийг эхлээд нөөцөлж сэргээх төлөвлөгөө батална.

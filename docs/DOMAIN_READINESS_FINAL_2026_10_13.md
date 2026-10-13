# Домэйнд холбох бэлтгэлийн эцсийн тайлан — 2026-10-13

Шалгасан эх код: `ffe741e5c15e024a1ce5d36b75b212bd248ac619`. Домэйн худалдан авч, DNS/TLS болон үйлдвэрлэлийн орчны холболт хийгдээгүй. Доорх нотолгоо нь шалгасан staging болон тусгаарласан туршилтын хүрээнд хамаарна.

| Шалгалт | Баталгаажсан үр дүн |
| --- | --- |
| Яг энэ commit-ийн CI | GitHub Actions `38354534074`: 338 тест PASS |
| Бодит browser → API | 47/47 PASS: нэгдсэн урсгал 20, mobile/admin 19, onboarding 8 |
| Байршуулалтын дараах staging | 19/19 PASS: public API, CORS, anonymous эрх, frontend header |
| PostgreSQL | Бодит concurrency 3 кейс PASS; холбогдох модуль нийт 8 тест PASS |
| Live email/SMTP | Нэг удаагийн staging бүртгэлээр verification/password reset болон SMTP invitation хүргэлт баталгаажсан; хүлээн авагчийн invitation acceptance нь local browser тестээр шалгагдсан |
| Hosted өгөгдлийн хамгаалалт | Application 47 хүснэгтийн RLS шалгалт PASS |
| Бодит сэргээх туршилт | DB: 47 хүснэгт/729 мөр, FK болон fixture-ийн өмнө/дараах бүх мөрийн яг харьцуулалт PASS; media 6 объект/1,001,783 byte AES-GCM/SHA-256 PASS; original/thumbnail local authorized API 200/401/403 PASS |
| Хамаарлын аудит | npm production: 0 vulnerability; build/dev: 7 high эрсдэлтэй `braces` дам хамаарлын баримтжуулсан exception |

Бодит iOS/Android төхөөрөмж дээр суулгах, Safari/OS install үйлдлийг шалгаагүй; Chromium responsive хэмжээ болон installability шалгасан. Бодит утас/SMS provider энэ ажлын хүрээнээс хасагдсан.

Recovery хувийн түлхүүрүүд шифрлэгдсэн; нээх passphrase нь эзэмшигчийн Windows DPAPI-д хамаарна. Түлхүүрийн custody нь owner-only ACL-тай, Git-д үл орох `.integrated-qa/recovery-key-custody/20261013-060009` хавтаст хадгалагдсан. Үйлдвэрлэлд ашиглахын өмнө эзэмшигчийн зөөврийн хамгаалалттай vault болон хоёр дахь сэргээх хуулбарт хадгалж, хоёр дахь оператороор сэргээх боломжийг шалгах шаардлагатай. Автомат backup хуваарь энэ ажилд үүсгээгүй. Application snapshot нь provider role болон бусад PostgreSQL schema-ийн native recovery нотолгоо биш.

Dev/build exception нь vinext/Vite-ийн дам хамаарал бөгөөд итгэмжлэгдсэн build pattern ашиглалтын хүрээнд баримтжуулсан. Одоогийн хамгийн сүүлийн `braces` мөн нөлөөлсөн тул баталгаагүй downgrade хийгдээгүй. Үлдсэн 7 асуудлыг арилсан гэж тайлагнаагүй.

Staging [frontend](https://guulingiinhan-staging.tuvshoo0331.workers.dev), [backend](https://guulingiinhan-backend-staging.tuvshoo0331.workers.dev). Идэвхтэй frontend version `b0e50ad9-5dca-462e-9dc4-09b3f10e7079`, backend version `f2b30b86-e976-4687-a6d2-c9ed71e8196e`: тус бүр staging traffic-ийн 100%-ийг хүлээн авч байна. Энэ нь staging release-ийн нотолгоо.

Recovery-ийн үед нэг detached photo tag-ийн 404 хамгаалалт ажиглагдсан; зөвхөн local түр association-оор binary API шалгаад арилгасан. Архивлагдсан гэр бүлийн portrait-ийн 404 хамгаалалт хэвийн. Person/account portrait-ийн бүх API inventory-г бүрэн шалгасан гэж дүгнээгүй. DB/media backup provider хооронд atomic биш (DB 06:13 UTC, media 13:03 UTC); snapshot-ийн зургаан media reference бүгд сэргэсэн. Түр Cloudflare Worker/Workflow болон өөрийн local cluster/plaintext цэвэрлэгдсэн, шифрлэгдсэн R2 backup хадгалагдсан.

Нотолгоо: [browser аудит](DOMAIN_BROWSER_AUDIT_2026_10_13.md), [backend аудит](DOMAIN_BACKEND_AUDIT_2026_10_13.md), [frontend аудит](DOMAIN_FRONTEND_AUDIT_2026_10_13.md), [staging gate](STAGING_GATE.json), [live email](DOMAIN_LIVE_EMAIL_QA_2026_10_13.json), [invitation](DOMAIN_LIVE_INVITATION_QA_2026_10_13.json), [хамаарлын аудит](DOMAIN_NODE_DEPENDENCY_AUDIT_2026_10_13.json), [бодит сэргээх туршилт](DOMAIN_ACTUAL_RESTORE_2026_10_13.md).

Домэйн сонгож авсны дараа DNS/TLS, redirect, production CORS/cookie/email URL тохиргоог тухайн домэйнээр баталгаажуулж, smoke test хийх шаардлагатай. Одоогийн шалгалтаар бодит production/domain cutover бүрэн дууссан гэж дүгнээгүй.


# Нэгдсэн QA — 2026-10-10

Integration branch: `codex/integration-regression-2026-10-02`.
Baseline: `58b365f1f3df25af25d64a8a3e7e0f7c8b32dc96`.

Өмнөх 80% / 65% тоонууд нь хэмжсэн acceptance score байгаагүй. Энэ тайлан шалгасан хүрээ, бодит үр дүнгээр тэдгээрийг орлоно. Бүх төсөл, бүх төхөөрөмж, бүх гаднын үйлчилгээ 100% баталгаажсан гэсэн дүгнэлт биш.

## Зассан алдаанууд

- Хүний мэдээлэл хувийн эсвэл насанд хүрээгүй төлөвт шилжихэд хүсэлтийн жагсаалт нэрийг дахин нууцална.
- Нэг хүний хүсэлт батлах нь бусад шалгагдаагүй хүмүүсийг үндсэн модонд давхар оруулахгүй. Шинэ болон өмнөх хүсэлтийн API ижил хамгаалалттай.
- Өмнөх гэр бүлийн холболтыг салгасны дараа шинэ хүний хүсэлтээр дахин холбох боломжтой; зөвхөн тэр хүний өмнөх холболтыг шинэчилнэ. Бодит Person, эцэг/эх, гэрлэлтийн холбоо болон гэр бүлийн эх өөрчлөгдөхгүй.
- Идэвхгүй аккаунтын өмнөх хүсэлтийг батлахгүй. Батлах мөчид аккаунт, эрх, зөвшөөрлийг дахин шалгана.
- Өөрийн нийтлэг модонд харагдах зөвшөөрлөө цуцалбал шинэ болон өмнөх API дахь хүлээгдэж буй зөвшөөрлүүд мөн цуцлагдана. Хуучин хүсэлт дараа нь автоматаар дахин нийтлэхгүй.
- Админы нэг гэр бүлтэй орчинд хэрэггүй гэр бүлийн dropdown гаргахгүй. Өөрийн профайл модонд аль хэдийн холбогдсон бол хүсэлтийн цонхонд шалтгааныг тайлбарлана.

Шинэ migration байхгүй. Production, бодит canonical гэр бүлийн өгөгдөлд өөрчлөлт хийгээгүй.

## Бодит API-тай бүтэн browser шалгалт

`docs/INTEGRATED_BROWSER_QA.json`: **20/20 PASS**. API mock ашиглаагүй. Next production build → жинхэнэ FastAPI HTTP → тусгаарласан SQLite болон хувийн local storage ашигласан. Түр өгөгдөл нь зөвхөн localhost дээр, жинхэнэ staging/production-оос тусдаа үүссэн.

| Шалгасан урсгал | Үр дүн |
| --- | --- |
| Owner болон SUPER_ADMIN нэвтрэлт | PASS |
| Эх хос, дөрвөн салаа, хувийн гэр бүлийн тусгаарласан харагдац | PASS |
| Хүүхдийн хүсэлт pending байх, давхардал хориглох | PASS |
| Админ батлах → үндсэн мод шинэчлэгдэх → canonical холбоо давхардахгүй | PASS |
| Ханийн хүсэлтэд татгалзах, дахин илгээж батлах, хань хажууд харагдах | PASS |
| Нас барсан хүн аккаунтгүй бүртгэх, хүсэлт цуцлах | PASS |
| Reviewed detach → canonical хүн, эцэг/эхийн холбоо хадгалагдах | PASS |
| Админ хүний мэдээлэл хадгалах, дахин ачаалах, хөрөг upload/read/delete | PASS |
| Аккаунтын зураг upload/reload/delete, anonymous хамгаалалт | PASS |
| Дурсамжийн зураг upload болон protected preview | PASS |
| Түүхийн зураг сонгох, форматтай бичвэр хадгалах | PASS |
| Архивын форм хадгалах | PASS |
| Нийтийн контент хуваалцах, private Person/media хамгаалалт | PASS |
| Гэр бүлийн/нийтийн сангийн харагдах хүрээ | PASS |
| Уулзалт үүсгэх, бүртгүүлэх, цуцлах | PASS |
| Мэдэгдэл нийтлэх, ноорог нууц байх, хонх харагдах | PASS |
| SUPER_ADMIN / ADMIN / MODERATOR / owner / editor / member эрхийн ялгаа | PASS |
| Өөрийн амьд профайлыг зөвшөөрөлтэй холбох; давхар сонголт болохгүй тайлбар | PASS |
| 320/390/768/1440px, 28 route/viewport тохиолдол; crash/overflow/application alert байхгүй | PASS |
| Гарах → session хүчингүй болох | PASS |

Шалгалт үүсгэж байхад locator ambiguity, navigation response cache, Next route-announcer зэрэг test harness-ийн асуудлуудыг source/DOM-оор ялгаж зассан. Эцсийн PASS нь шинэ тусгаарласан өгөгдлийн сангаар дээрх бүх урсгалыг нэг ажиллуулалтад давсан үр дүн.

### Дахин ажиллуулах

Frontend build: `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8840/api/v1 npm run build`.

Дараа нь `npm run test:integrated-browser`.

- `QA_PYTHON`: backend dev dependency-тэй Python executable.
- `PLAYWRIGHT_PACKAGE`: байгаа Playwright package-ийн байршил.
- `BROWSER_EXECUTABLE`: Edge/Chromium executable.
- Runner зөвхөн `APP_ENV=test`, loopback 8840/8841, шинэ local SQLite, fake email/SMS, local private storage ашиглана.
- Нэвтрэх түр мэдээлэл `.integrated-qa/fixture.json`-д бичигдэнэ; Git-д орохгүй, терминал/тайланд хэвлэгдэхгүй.
- Run-specific nonce нь өмнөх эсвэл өөр серверийн fixture ашиглахаас хамгаална.

## Бусад gate

- Backend: **304 pytest PASS**, Ruff PASS, configured mypy **34 source modules PASS**.
- Typecheck, Next production build, Cloudflare/Vinext build PASS.
- 27-route regression, root-linking, heritage, 20–5000-person family-map layout, 800-person 3D regression PASS.
- Синтетик local family/shared map browser suite PASS; өмнөх амжилттай behavior-тэй нийцсэн.

## Нэвтэрсэн staging дээр шалгасан хүрээ

Эдгээр нь бодит owner session-оор, өгөгдөл өөрчлөхгүйгээр шалгасан:

- Үндсэн модны Ядамсүрэн + Гүнд, дөрвөн хүүхэд; нийт 6 холбоотой хүн.
- Хувийн family харагдац; холбоогүй бусад үндсэн салаа нэмэгдээгүй.
- Админ overview, ancestry, хүсэлтийн хяналт, хүний мэдээлэл/portrait форм.
- Түүх, дурсамж, архив, activities, хамаарал, тохиргоо, community, news, Dashboard: 9/9 бүрэн ачаалсан; crash, overflow, application alert байхгүй.
- Ядамсүрэн–Гүндийн ханийн хамаарлыг бодит хайлт, сонголт, тооцооллоор олсон.
- Дансны banner, профайлын хажуугийн мэдэгдлийн хонх.
- Нээлттэй HTTP/CORS/anonymous хандалтын **18/18 PASS**.
- Staging Supabase: revision `a72d9e410c8b`, application tables **47/47 RLS enabled**, anon/authenticated direct table privilege **0**.

Dashboard featured-person нэг удаа түр алдаад дахин оролдоход ачаалсан; бусад route болон давтан шалгалтад давтагдаагүй. Дэлгэрэнгүй Cloudflare event log унших оролдлогыг automatic review татгалзсан; хувийн логийн payload аваагүй.

## Баталгаажуулалтын хязгаар

- Staging-ийн canonical хүмүүс, тэдний бодит холбоос, нийтлэлүүдийг QA хийхийн тулд өөрчлөөгүй. Батлах/салгах болон upload mutation-ийн бүтэн browser E2E нь дээрх жинхэнэ API-тай **local** орчинд гүйцэтгэсэн.
- Бодит staging хоёр дахь аккаунт болон тусдаа live ADMIN/MODERATOR session ашиглаагүй; эрхийн matrix болон cross-family mutation/read кейсүүдийг тусгаарласан API/browser орчинд шалгасан.
- SQLite suite нь PostgreSQL-ийн зэрэгцээ transaction/RLS execution тест биш. Staging RLS/privilege metadata шалгасан; PostgreSQL migration/consistency gate-ийг CI тусад нь шалгана.
- In-app browser-ийн viewport override DOM хэмжээг өөрчлөөгүй (699px). 320–1440px mobile QA нь headless Edge-ийн бодит viewport дээр гүйцэтгэсэн.
- Бодит SMS/email хүргэлт нь хэрэглэгчийн өмнөх хүсэлтээр хойшлуулсан хүрээ. Домэйн, production байршуулалт энэ ажилд ороогүй.

Staging deploy дараах build/deployment ID болон шинэ кодын live smoke үр дүнг эцсийн release evidence-д тусад нь хадгална.

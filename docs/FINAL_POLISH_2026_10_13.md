# Эцсийн сайжруулалт — 2026-10-13

## Хэрэгжүүлсэн өөрчлөлт

- Аккаунтын зураг upload/delete амжилттай болсны дараа `/auth/me` refresh тасарсан ч серверийн баталсан шинэ төлөвийг preview болон хасах товчид шууд харуулна. Зураг response-ийн MIME шалгана; decode алдаа гарвал fallback харагдана.
- `APP_ENV` буруу бичсэн үед hosted хамгаалалт алгасахаас сэргийлж startup зогсоно. CORS exact HTTPS origin, SMTP base origin, R2/OIDC URL-ийн бүтэц, credentials/query/fragment-ийг шалгана.
- Media backup зөвшөөрлийн хугацаа, run ID, дууссан run давхар ашиглахыг шалгана. Шифрлэх явцад объект нэмэгдсэн, устсан, солигдсон эсэхийг inventory/ETag-аар дахин нягталж, зөрчилтэй үед completion manifest үүсгэхгүй. Энэ нь DB/R2 atomic snapshot биш.
- `lucide-react`-ийг lockfile-д байсан `1.47.0` хувилбарт тогтоосон; шинэ dependency нэмээгүй.
- Өмнөх бодит backup/restore нотолгоо болон домэйн бэлтгэлийн тайланг deployment зааварт холбоосоор шинэчилсэн.

## Баталгаажуулалт

- Backend тохиргооны 30 тест, Ruff, mypy: PASS.
- Media recovery regression: 6/6 PASS, үүнд encryption integrity, source mutation, expiry/replay, буруу pagination.
- Next.js webpack production build болон TypeScript: PASS.
- Бодит локал API-тай browser regression: 5/5 PASS — upload/delete дараах identity refresh тасралт, эвдэрсэн зураг fallback, 320px/390px controls болон overflow. [Aggregate evidence](FINAL_MEDIA_BROWSER_QA_2026_10_13.json).
- Cloudflare vinext Worker build: PASS.
- Cloudflare байршуулалтын дараах нотолгоог `FINAL_POLISH_RELEASE_2026_10_13.json`-д бүртгэнэ; өмнөх release-ийн PASS-ийг шинэ эх кодын шалгалт гэж тооцохгүй.

## Үлдсэн гадаад нөхцөл

Домэйн худалдан авч DNS/TLS, production API/CORS/email URL-ийг тухайн hostname-аар баталгаажуулна. Бодит iOS/Android install болон SMS шалгалтыг эзэмшигч гүйцэтгэнэ. Recovery key нь одоогийн Windows owner/host-ийн DPAPI-д хамаарах тул тусдаа portable vault, хоёр дахь хуулбар шаардлагатай. Backup schedule/автомат устгал идэвхжүүлээгүй.

`braces`-ийн upstream patched release гараагүй тул production npm audit 0, build/dev 7 high exception хэвээр. [Upstream advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Бусдын итгэмжлэгдээгүй код/glob-ийг review-гүй build-д оруулахгүй. Энэ хязгаарлалтыг арилсан гэж тайлагнахгүй.

Өмнөх өргөн аудит: [domain readiness](DOMAIN_READINESS_FINAL_2026_10_13.md), [бодит restore](DOMAIN_ACTUAL_RESTORE_2026_10_13.md).

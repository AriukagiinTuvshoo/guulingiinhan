# Аюулгүй байдлын төлөв

## Хэрэгжсэн суурь хамгаалалт

- DB талд foreign key, unique, check constraint тавьсан.
- Амьд хүний visibility анх `family`; нууц холбоо барих талбарууд person schema-д байхгүй.
- Зураг зөвхөн object key хадгална; файл DB-д оруулахгүй.
- CORS origin environment-оос уншигдана.
- Production тохиргоо PostgreSQL URL болон ил тод HTTPS CORS origin-уудыг шаардана.
- Liveness ба database readiness endpoint тусдаа; хүсэлт бүр серверийн үүсгэсэн request ID авна.
- Backend контейнер root бус хэрэглэгчээр ажиллана.
- Одоогоор health endpoint л байна; гэр бүлийн мэдээлэл унших/бичих endpoint нээгдээгүй.
- Git-д `.env` хадгалахгүй.

## Нэвтрэх ба зөвшөөрлийн ажлууд

Auth endpoint үүсгэхдээ нууц үгийг зөвхөн Argon2id/bcrypt-аар hash хийнэ; email verification/reset token-ийг хугацаатай, нэг удаагийн байдлаар хадгална. Family-ийн хүсэлт бүр authenticated user-ийн membership болон role-ийг шалгана. ID тааруулж шууд өгөгдөл буцаах нь хангалтгүй.

PostgreSQL production руу орохын өмнө DB-г public network/API-д ил гаргахгүй, managed backup болон restore шалгалт, TLS, secret rotation, audit logging тохируулна. CI migrations-ийг PostgreSQL дээр ажиллуулдаг ч managed орчны restore болон нэвтрэлтийн шалгалт хараахан хийгдээгүй. Одоогийн API-г бодит хэрэглэгчийн өгөгдөлд нээхэд бэлэн гэж үзэж болохгүй.

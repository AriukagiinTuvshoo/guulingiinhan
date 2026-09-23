# Аюулгүй байдлын төлөв

## Хэрэгжсэн суурь хамгаалалт

- DB талд foreign key, unique, check constraint тавьсан.
- Амьд хүний visibility анх `family`; нууц холбоо барих талбарууд person schema-д байхгүй.
- Зураг зөвхөн object key хадгална; файл DB-д оруулахгүй.
- CORS origin environment-оос уншигдана.
- Одоогоор health endpoint л байна; гэр бүлийн мэдээлэл унших/бичих endpoint нээгдээгүй.
- Git-д `.env` хадгалахгүй.

## Нэвтрэх ба зөвшөөрлийн ажлууд

Auth endpoint үүсгэхдээ нууц үгийг зөвхөн Argon2id/bcrypt-аар hash хийнэ; email verification/reset token-ийг хугацаатай, нэг удаагийн байдлаар хадгална. Family-ийн хүсэлт бүр authenticated user-ийн membership болон role-ийг шалгана. ID тааруулж шууд өгөгдөл буцаах нь хангалтгүй.

PostgreSQL production руу орохоос өмнө migrations-ийг бодит Postgres дээр шалгаж, DB-г public network/API-д ил гаргахгүй, managed backup, TLS, secret rotation, audit logging тохируулна. Одоогийн API-г бодит хэрэглэгчийн өгөгдөлд нээхэд бэлэн гэж үзэж болохгүй.

# Аюулгүй байдлын төлөв

## Хэрэгжсэн суурь хамгаалалт

- DB талд foreign key, unique, check constraint тавьсан.
- Амьд хүний visibility анх `family`; нууц холбоо барих талбарууд person schema-д байхгүй.
- Зураг зөвхөн object key хадгална; файл DB-д оруулахгүй.
- CORS origin environment-оос уншигдана.
- Production тохиргоо PostgreSQL URL болон ил тод HTTPS CORS origin-уудыг шаардана.
- Liveness ба database readiness endpoint тусдаа; хүсэлт бүр серверийн үүсгэсэн request ID авна.
- Backend контейнер root бус хэрэглэгчээр ажиллана.
- Бодит endpoint бүр session болон family membership шалгана; Role-г write дээр хэрэглэнэ.
- Нууц үг scrypt-ээр hash-лагдана. Session cookie-ийн raw token DB-д хадгалагдахгүй; 7 хоногийн хугацаатай session logout үед хүчингүй болно.
- Login error ерөнхий; account/IP хосоор DB-д суурилсан нэг минутын rate limit ажиллана.
- Private person жагсаалт, профайл, tree болон relationship output-оос эрхгүй хэрэглэгчид хасагдана.
- Origin шалгалт browser-ийн POST/PUT/PATCH/DELETE хүсэлтэд CSRF эрсдэлийг бууруулна.
- Audit log нь account, family, person, relationship, marriage, biography, life event, memory үйлдлийн actor болон ID-г хадгална; password/content-ийг логлохгүй.
- Parent-child өөрчлөлтийг PostgreSQL дээр family мөрөөр түгжиж, зэрэгцээ inverse edge-ээс хамгаална.
- Урилгын token database-д hash-лагдаж, 7 хоногийн дараа дуусна; зөвхөн урьсан имэйлээр нэвтэрсэн user нэг удаа ашиглана.
- Git-д `.env` хадгалахгүй.

## Нэвтрэх ба зөвшөөрлийн ажлууд

Email verification ба password reset хэрэгжээгүй. Одоогоор бүртгэл нэвтрэлтийг автоматаар зөвшөөрдөг тул `email_verified_at` утгагүй байна; хэрэглэгчид нээлттэй production-д гаргахын өмнө email token/provider-оор баталгаажуулах шаардлагатай. Нууц үг сэргээх endpoint, автоматаар хүргэх урилгын email, storage signed URL хараахан байхгүй.

PostgreSQL production руу орохын өмнө DB-г public network/API-д ил гаргахгүй, managed backup ба restore шалгалт, TLS, production домэйн cookie/CORS тохиргоо, email verification/reset, нэвтрэлтийн шалгалт хийнэ. CI migrations-ийг PostgreSQL дээр шалгана; managed орчны restore болон нэвтрэлтийн шалгалт хараахан хийгдээгүй. Одоогийн API-г нээлттэй production хэрэглээнд бэлэн гэж үзэж болохгүй.

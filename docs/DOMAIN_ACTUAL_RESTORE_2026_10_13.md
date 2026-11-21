# Бодит тусгаарласан staging сэргээх туршилт — 2026-10-13

Staging application backup-ийг шифрлэгдсэн хэлбэрээр эзэмшигчийн хувийн R2 backup bucket-д хадгалж, өөрийн тусгаарласан PostgreSQL болон local storage-д сэргээсэн. Production/source өгөгдөл өөрчлөөгүй.

| Шалгалт | Бодит үр дүн |
| --- | --- |
| Database snapshot | 47 хүснэгт, 729 мөр, schema `a72d9e410c8b` |
| Foreign key болон бүх мөрийн харьцуулалт | Сэргээсний дараа PASS; API fixture-ийг арилгасны дараа дахин бүх мөр яг тохирсон |
| R2 media | 6 объект, 1,001,783 byte; RSA unwrap, AES-GCM authentication, binary SHA-256 бүгд PASS |
| DB-ийн одоогийн media reference | Original, thumbnail, person/account portrait-ийн 6 reference бүгд archive болон local restore-д байсан |
| Бодит protected API | Original болон thumbnail: зөвшөөрөгдсөн 200, anonymous 401, өөр гэр бүлийн 403; хариуны byte SHA-256 болон `private, no-store` PASS |
| Database ciphertext хадгалалт | R2 ба local SHA-256 яг тохирсон; 64,393 byte |
| Цэвэрлэгээ | Өөрийн loopback cluster зогссон; plaintext DB, media, snapshot/index болон түр database password арилсан |

Snapshot-д нэг photo tag нь тухайн гэр бүлийн `FamilyPerson` холбоогүй байсан. Анхны өгөгдөлтэй нь API 404 өгсөн нь хамгаалалтын хүлээгдсэн үйлдэл. Original/thumbnail-ийн authorized binary read-ийг зөвхөн local түр холбоогоор шалгаж, дараа нь холбоог арилган бүх 729 мөрийг анхны snapshot-тай яг харьцуулсан. Эх өгөгдлийн холбоог зассан гэж тайлагнаагүй.

Нэг person portrait архивлагдсан гэр бүлийн хүрээнд 404 өгсөн; архивын хамгаалалт суларсангүй. Person/account portrait-ийн бүх API inventory-г бүрэн шалгасан гэж дүгнээгүй; зургаан объектын шифр тайлалт, binary integrity болон database reference бүрэн шалгагдсан.

Database export ойролцоогоор 06:13 UTC, media export 13:03 UTC-д хийгдсэн. Хоорондын завсар нь ажлын interruption-оос үүссэн. Одоогийн snapshot-ийн media reference бүрэн таарсан ч хоёр provider-ийн atomic point-in-time backup гэж дүгнээгүй. Энэ application snapshot нь provider role болон бусад PostgreSQL schema-ийн native recovery нотолгоо биш.

Database ciphertext SHA-256: `862731e83a4b02dfb241c9b95204821dc4a91b8eaaf0f1553c961abbcba69750`.

Шифрлэгдсэн хувийн түлхүүр, DPAPI passphrase, шинэчилсэн descriptor-ийг Git-д үл орох `.integrated-qa/recovery-key-custody/20261013-060009` дотор зөвхөн эзэмшигчийн ACL-тай хадгалсан. DPAPI нь одоогийн Windows эзэмшигч/host-д хамаарна. Production recovery-ийн өмнө зөөврийн хамгаалалттай vault, хоёр дахь хуулбар болон хоёр дахь операторын сэргээх шалгалт шаардлагатай.

Түр Cloudflare Worker болон Workflow устгагдсан нь coordinator-аар баталгаажсан. Шифрлэгдсэн хувийн R2 backup хадгалагдсан. Backup устгаагүй, автомат хуваарь үүсгээгүй.

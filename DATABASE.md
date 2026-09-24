# Өгөгдлийн сан

Migration дараалал нэг шугамтай: `4532a98a2fe5` → `f10695a88229` → `74a31c87f462` (одоогийн head). `f10695a88229` нь account-person link ба memory tag, `74a31c87f462` нь auth/session, family archive болон audit schema нэмдэг.

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
| audit_logs | Хэн ямар entity үйлдсэнийг PII агуулахгүй бүртгэл |

Огноо тодорхойгүй хүнийг `birth_date = NULL`, нэмэлт тайлбарыг `birth_date_note`-д хадгална. Нас барсан эсэх нь `is_alive`-аар ялгагдана. Гэрлэлт хүний хоёр ID-г тогтмол дараалалд хадгалдаг.

Family устгал нь archive, Person устгал нь family-ээс салгах үйлдэл. Marriage устгал нь record-ийг soft-delete хийж түүхийг хадгална. Schema өөрчлөхдөө model-ийг шинэчилж `alembic revision --autogenerate -m "..."` үүсгээд migration-ийг шалгасны дараа `alembic upgrade head` ажиллуулна.

`alembic downgrade -1` нь зөвхөн түр/туршилтын өгөгдлийн санд migration-ийн буцаалтыг шалгахад хэрэглэгдэнэ. Одоогийн `74a31c87f462` downgrade нь session, invitation, throttle, audit хүснэгтүүдийг буулгах тул тэдгээрт үүссэн өгөгдөл алдагдана. Production rollback-ийг шууд downgrade-аар хийхгүй; forward-fix migration ашиглаж, буцаалт шаардлагатай бол нөлөөлөх өгөгдлийг эхлээд нөөцөлж сэргээх төлөвлөгөө батална.

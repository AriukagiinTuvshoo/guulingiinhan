# Байршуулалтын суурь

## Орон нутаг

Root `.env` дахь `POSTGRES_PASSWORD`-ийг өөрчилсний дараа `docker compose up --build` ажиллуулна. API: `http://localhost:8000`; OpenAPI: `/docs`; health: `/health`.

## Production-д бэлэн болохын өмнө

1. Managed PostgreSQL үүсгэж нууц үг, TLS connection string тохируулна.
2. API болон frontend-ийн origin тус бүрийг CORS-д заана.
3. Нууц үг verification/reset явуулах email provider тохируулна.
4. Private object storage, хугацаатай signed URL, upload хэмжээ/төрлийн шалгалт нэмнэ.
5. CI дээр tests, migrations, build ажиллуулна.
6. Managed backup/restore шалгана.
7. Vercel-ийн `NEXT_PUBLIC_API_BASE_URL` болон backend-ийн `CORS_ORIGINS`-ийг preview/staging домэйнээр тохируулж шалгана.
8. Email verification, password reset provider, урилга, private object storage, upload шалгалтыг нэмж баталгаажуулна.
9. Migration-ийг эхлээд CI/staging PostgreSQL дээр upgrade, downgrade, дахин upgrade-аар шалгана. Одоогийн downgrade нь auth/session/invitation/throttle/audit өгөгдлийг устгадаг тул production rollback-д ашиглахгүй; forward-fix migration ба backup/restore төлөвлөгөө хэрэглэнэ.

### Утасны OTP тохиргоо (P4.4)

Backend орчинд `OTP_HASH_SECRET`-ийг `openssl rand -hex 32`-оор үүсгээд secret manager-д хадгал. Production-д `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` тохируулах шаардлагатай; нэг утгыг frontend env рүү бүү дамжуул. OTP secret болон Twilio credential дутуу үед production тохиргоо API-г эхлүүлэхгүй. Development-ийн `SMS_PROVIDER=fake` мессеж илгээхгүй.

Одоогийн account recovery зөвхөн verified phone ашиглана. Имэйл recovery хэрэгтэй бол email delivery/verification provider-ийг тусад нь холбож шалгасны дараа хэрэглэгчдэд санал болго.

`docker-compose.yml` нь development-д зориулагдсан бөгөөд API/DB портууд зөвхөн localhost дээр нээгдэнэ; production нууц үг, network, backup бодлого орлоход зориулагдаагүй.

Backend-ийн container root бус хэрэглэгчээр ажиллана. `/health` нь liveness, `/health/ready` нь PostgreSQL холболтын readiness шалгалт. Production deployment нь readiness probe-оо `/health/ready` рүү чиглүүлнэ.

Auth cookie production-д `Secure; HttpOnly; SameSite=None` тул HTTPS frontend/backend болон зөв CORS origin шаардлагатай. Vercel-ийн бодит deployment энэ phase-д хийгдээгүй; provider project/environment variables шалгах эрх ба тохиргоо баталгаажаагүй.

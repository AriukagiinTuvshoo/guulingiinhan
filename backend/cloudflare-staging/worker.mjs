import { Container, getRandom } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

// The FastAPI process remains the only HTTP application and owns CORS/auth.
// Forward the original Request and Response to retain cookies, headers, body,
// method, path, and query string without duplicating API behavior in the Worker.
export class GuulingiinhanBackend extends Container {
  defaultPort = 8000;
  sleepAfter = "10m";
  envVars = {
    APP_ENV: "staging",
    // Supabase's default postgresql:// URL selects psycopg2 in SQLAlchemy;
    // this image installs psycopg (v3), so select its dialect explicitly.
    DATABASE_URL: env.DATABASE_URL?.replace(/^postgresql:\/\//, "postgresql+psycopg://"),
    CORS_ORIGINS: env.CORS_ORIGINS,
    TRUST_CLOUDFLARE_PROXY_IP: "true",
    OTP_HASH_SECRET: env.OTP_HASH_SECRET,
    ...(env.VERIFY_MN_API_KEY ? { VERIFY_MN_API_KEY: env.VERIFY_MN_API_KEY } : {}),
    ...(env.ADMIN_BOOTSTRAP_EMAIL ? { ADMIN_BOOTSTRAP_EMAIL: env.ADMIN_BOOTSTRAP_EMAIL } : {}),
    ...(env.ADMIN_BOOTSTRAP_ADMIN_EMAIL ? { ADMIN_BOOTSTRAP_ADMIN_EMAIL: env.ADMIN_BOOTSTRAP_ADMIN_EMAIL } : {}),
    ...(env.ADMIN_BOOTSTRAP_MODERATOR_EMAIL ? { ADMIN_BOOTSTRAP_MODERATOR_EMAIL: env.ADMIN_BOOTSTRAP_MODERATOR_EMAIL } : {}),
    SMS_PROVIDER: env.SMS_PROVIDER ?? "disabled",
    ...(env.SMS_PROVIDER === "twilio"
      ? {
          TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
          TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
          TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER,
        }
      : {}),
    EMAIL_PROVIDER: env.EMAIL_PROVIDER ?? "disabled",
    ...(env.EMAIL_PROVIDER === "smtp"
      ? {
          EMAIL_FROM: env.EMAIL_FROM,
          EMAIL_PUBLIC_BASE_URL: env.EMAIL_PUBLIC_BASE_URL,
          EMAIL_SMTP_HOST: env.EMAIL_SMTP_HOST,
          EMAIL_SMTP_PORT: env.EMAIL_SMTP_PORT ?? "587",
          EMAIL_SMTP_USERNAME: env.EMAIL_SMTP_USERNAME,
          // Google displays app passwords in four-character groups. Treat
          // copied whitespace as presentation only for this Gmail relay.
          EMAIL_SMTP_PASSWORD: env.EMAIL_SMTP_HOST === "smtp.gmail.com"
            ? env.EMAIL_SMTP_PASSWORD?.replace(/\s/g, "")
            : env.EMAIL_SMTP_PASSWORD,
        }
      : {}),
    EMAIL_SMTP_STARTTLS: "true",
    GOOGLE_OIDC_ENABLED: env.GOOGLE_OIDC_ENABLED ?? "false",
    ...(env.GOOGLE_OIDC_ENABLED === "true"
      ? {
          GOOGLE_OIDC_CLIENT_ID: env.GOOGLE_OIDC_CLIENT_ID,
          GOOGLE_OIDC_CLIENT_SECRET: env.GOOGLE_OIDC_CLIENT_SECRET,
          GOOGLE_OIDC_REDIRECT_URI: env.GOOGLE_OIDC_REDIRECT_URI,
          GOOGLE_OIDC_STATE_SECRET: env.GOOGLE_OIDC_STATE_SECRET,
        }
      : {}),
    STORAGE_PROVIDER: "s3",
    STORAGE_ENDPOINT: env.STORAGE_ENDPOINT,
    STORAGE_BUCKET: "guulingiinhan-staging-media",
    STORAGE_REGION: "auto",
    STORAGE_ACCESS_KEY: env.STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY: env.STORAGE_SECRET_KEY,
  };
}

export default {
  async fetch(request, env) {
    const required = [
      "DATABASE_URL", "CORS_ORIGINS", "OTP_HASH_SECRET", "STORAGE_ENDPOINT",
      "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY",
    ];
    if (env.SMS_PROVIDER === "twilio") {
      required.push("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER");
    }
    if (env.EMAIL_PROVIDER === "smtp") {
      required.push(
        "EMAIL_FROM", "EMAIL_PUBLIC_BASE_URL", "EMAIL_SMTP_HOST",
        "EMAIL_SMTP_USERNAME", "EMAIL_SMTP_PASSWORD",
      );
    }
    if (env.GOOGLE_OIDC_ENABLED === "true") {
      required.push(
        "GOOGLE_OIDC_CLIENT_ID", "GOOGLE_OIDC_CLIENT_SECRET",
        "GOOGLE_OIDC_REDIRECT_URI", "GOOGLE_OIDC_STATE_SECRET",
      );
    }
    if (required.some((name) => !env[name])) {
      console.error("Staging backend configuration is incomplete");
      return new Response("Service unavailable", { status: 503 });
    }
    const container = await getRandom(env.BACKEND, 1);
    return container.fetch(request);
  },
};

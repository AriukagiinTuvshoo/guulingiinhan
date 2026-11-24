# Global admin access

Global roles are stored in `admin_grants` and are independent of `family_members`.
Family `owner`, `editor`, and `member` grants never authorize `/api/v1/admin/*`.
Global admins do not inherit access to private family content or `/api/v1/families/{id}`.

| Role | Dashboard, user/family metadata | Admin account list and role changes |
| --- | --- | --- |
| `SUPER_ADMIN` | Yes | Assign/revoke `ADMIN` and `MODERATOR` |
| `ADMIN` | Yes | No |
| `MODERATOR` | Yes | No |

The admin lists return limited account and family metadata. They do not return
family trees, private media, biographies, passwords, hashes, sessions, or tokens.
Every endpoint checks the current HttpOnly session and the current database role.
Deleting a grant takes effect on the next request. Disabled or expired sessions
are denied by the existing authentication dependency.

## First-time bootstrap

Apply Alembic migration `df1fecd80312` before setting bootstrap variables. Set
`ADMIN_BOOTSTRAP_EMAIL` to the email of an already active, verified user. To
provision the other two levels at the same time, set
`ADMIN_BOOTSTRAP_ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_MODERATOR_EMAIL` to distinct,
active, verified users. Configure these as runtime secrets, never in source or
the frontend build. A durable `admin_bootstrap` row ensures this bootstrap runs
only once, including after an admin role is revoked. Remove the variables after
the first successful startup. Later role changes use the authenticated
`SUPER_ADMIN` interface at `/admin`.

The Cloudflare staging Worker forwards these three optional secrets into its
FastAPI Container. That Container runs Alembic migrations before starting
FastAPI only when `APP_ENV=staging`. Production deployments must apply Alembic
migrations through the production release process and do not run migrations
from the Container command.

## API

- `GET /api/v1/admin/me` — authoritative role for the current session.
- `GET /api/v1/admin/overview` — real counts.
- `GET /api/v1/admin/users` and `/families` — paginated metadata, maximum 50.
- `GET /api/v1/admin/users/lookup?email=...` — exact email lookup, Super Admin only.
- `GET /api/v1/admin/admins` — current global grants, Super Admin only.
- `PUT /api/v1/admin/admins/{user_id}` — grant `ADMIN` or `MODERATOR`, Super Admin only.
- `DELETE /api/v1/admin/admins/{user_id}` — revoke a lower role, Super Admin only.

The role API forbids self changes and changes to `SUPER_ADMIN`. All role changes
are recorded in the existing audit log. The admin UI asks for confirmation
before a grant or revocation. The existing login redirects global admins to
`/admin`; ordinary users continue to `/dashboard`.

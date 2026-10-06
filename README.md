# Mon Compagnon — API

API de la plateforme Mon Compagnon : NestJS 12, PostgreSQL 17, Prisma 7.
Le front (Next.js) vit dans le dépôt `mon_compagnon`.

## Démarrage

Prérequis : Node 24, pnpm, Docker.

```bash
pnpm install
docker compose up -d          # PostgreSQL : dev sur 5442, tests sur 5443
cp .env.example .env
pnpm keys:generate            # paire de clés ES256 pour les JWT, écrite dans .env
pnpm db:migrate               # applique les migrations
pnpm db:seed                  # comptes de démo
pnpm start:dev                # http://localhost:4000/api/v1
```

Documentation interactive : <http://localhost:4000/api/docs>.

### Comptes de démo

Mot de passe commun : `MonCompagnon2026!` (variable `SEED_PASSWORD`).

| E-mail                       | Rôle                      |
| ---------------------------- | ------------------------- |
| `nadege@moncompagnon.bj`     | FAMILY (espace proche)    |
| `mme.adjovi@moncompagnon.bj` | SENIOR                    |
| `julienne@moncompagnon.bj`   | COMPANION (accompagnante) |
| `equipe@moncompagnon.bj`     | ADMIN                     |

## Commandes

| Commande                                       | Rôle                                      |
| ---------------------------------------------- | ----------------------------------------- |
| `pnpm start:dev`                               | serveur avec rechargement                 |
| `pnpm build` / `pnpm start:prod`               | build et exécution de production          |
| `pnpm test`                                    | tests unitaires (Vitest)                  |
| `pnpm test:e2e`                                | tests de bout en bout sur la base de test |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | qualité                                   |
| `pnpm db:migrate`                              | crée et applique une migration (dev)      |
| `pnpm db:deploy`                               | applique les migrations (CI, production)  |
| `pnpm db:seed`                                 | comptes de démo (idempotent)              |
| `pnpm keys:generate`                           | nouvelle paire de clés JWT locale         |

## Structure

```
src/
  core/        infrastructure transverse : config, Prisma, erreurs, décorateurs
  modules/     une fonctionnalité = un dossier (health, users, auth…)
  cli/         scripts (seed)
prisma/        schéma et migrations
test/          tests de bout en bout
```

Chaque module suit le même découpage : `*.controller.ts` (HTTP uniquement),
`*.service.ts` (règles métier), `*.repository.ts` (seul accès à Prisma),
`*.module.ts`, `dto/` (entrées validées, sorties explicites).

Toutes les routes sont protégées par défaut ; `@Public()` ouvre une route,
`@Roles(Role.ADMIN)` la restreint à un rôle.

Erreurs, toujours au même format :

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "…",
  "path": "/api/v1/…",
  "timestamp": "…"
}
```

## Authentification

- `POST /api/v1/auth/register` (rôles FAMILY, SENIOR, COMPANION),
  `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- Cookies httpOnly, `SameSite=Lax`, `Secure` en production :
  - `mc_access` : JWT signé ES256, 15 minutes, contient `sub`, `role`, `status` ;
  - `mc_refresh` : jeton opaque limité à `/api/v1/auth`, 30 jours avec
    « se souvenir de moi », sinon le temps de la session du navigateur.
- Le refresh token est stocké haché et renouvelé à chaque usage. Réutiliser
  un ancien jeton révoque toute la session (sauf dans les 10 s qui suivent
  un renouvellement, pour ne pas déconnecter deux onglets simultanés).
- Le middleware Next.js vérifie `mc_access` avec la **clé publique**
  (`JWT_PUBLIC_KEY`) uniquement ; la clé privée ne quitte jamais l'API.
- En production, `COOKIE_DOMAIN` doit être le domaine parent commun au front
  et à l'API (ex. `.moncompagnon.bj`), et `FRONT_ORIGIN` l'URL du front.

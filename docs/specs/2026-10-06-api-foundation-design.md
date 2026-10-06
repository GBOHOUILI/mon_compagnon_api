# Socle de l'API Mon Compagnon

## Objectif

Créer le projet backend de Mon Compagnon et poser ses bases : structure,
configuration, base de données, conventions, utilisateurs et authentification,
documentation, tests et CI. Les domaines métier (visites, paiements,
vérifications…) et le branchement du front viennent ensuite, chacun avec son
propre cycle spec → plan.

### Décisions (Eldo, 2026-10-06)

- Dépôt **séparé** : `mon compagnon/Mon Compagnon API`, dépôt GitHub
  `mon_compagnon_api` (création et push après accord explicite).
- **NestJS + PostgreSQL + Prisma**.
- Socle incluant : documentation OpenAPI, CI GitHub Actions, données de démo,
  utilisateurs + authentification.
- Session : **JWT d'accès court + refresh token** (rotation, révocable).
- Un module de fonctionnalité = un dossier, sous `src/modules/`.

### Critères de réussite

- `docker compose up -d` puis `pnpm dev` démarrent une API documentée sur
  `/api/docs`.
- On peut s'inscrire, se connecter, rafraîchir la session, se déconnecter et
  lire son profil ; un compte suspendu est bloqué.
- Tests unitaires et e2e verts en local et en CI.
- L'API refuse de démarrer si la configuration est incomplète.

### Contraintes

- Dépendances au strict nécessaire (liste ci-dessous, pas d'autre ajout sans
  accord).
- TypeScript strict ; commentaires en anglais, seulement sur les décisions non
  évidentes.
- Git : branches `feature/` `fix/` `chore/` `docs/`, merge `--no-ff`, commits
  atomiques.

## Section 1 — Projet et structure

- NestJS 11, TypeScript strict, pnpm, Node 24.
- PostgreSQL 17 via `docker-compose.yml` : une base de dev et une base de test.

```
src/
  main.ts, app.module.ts
  core/                  → infrastructure transverse
    config/              → schéma des variables d'environnement, validé au démarrage
    prisma/              → PrismaModule + PrismaService (seul accès à la base)
    common/              → filtre d'erreurs, décorateurs, guards
  modules/               → une fonctionnalité = un dossier
    health/
    users/               → users.controller.ts, users.service.ts,
                           users.repository.ts, users.module.ts, dto/
    auth/                → auth.controller.ts, auth.service.ts,
                           auth.module.ts, dto/, tokens/
prisma/                  → schema.prisma, migrations/, seed.ts
test/                    → tests e2e
```

**Convention par domaine** : controller fin (HTTP uniquement), service =
règles métier, repository = seul à utiliser Prisma, DTO d'entrée validés par
`class-validator`, DTO de sortie explicites (un hash de mot de passe ne peut
pas fuiter).

**Conventions API**
- Préfixe `/api/v1`.
- Format d'erreur unique :
  `{ statusCode, error, message, details?, path, timestamp }` ; erreurs Prisma
  connues traduites (contrainte d'unicité → 409).
- CORS limité à l'origine du front, `credentials: true`.
- `helmet` ; `@nestjs/throttler` sur les routes d'authentification.
- Swagger sur `/api/docs`.

**Dépendances** (en plus du socle NestJS) : `prisma` / `@prisma/client`,
`class-validator` / `class-transformer`, `@nestjs/config`, `@nestjs/jwt`,
`@nestjs/swagger`, `@nestjs/throttler`, `helmet`, `argon2`, `cookie-parser`.
Pas de Passport : un guard maison suffit.

## Section 2 — Données et authentification

**Schéma Prisma (socle)**
- `User` : `id` (uuid), `email` (unique, minuscules), `phone`, `firstName`,
  `lastName`, `role` (`FAMILY` | `SENIOR` | `COMPANION` | `ADMIN`), `status`
  (`ACTIVE` | `SUSPENDED`), `passwordHash` (argon2id), `createdAt`,
  `updatedAt`.
- `RefreshToken` : `id`, `userId`, `tokenHash`, `familyId`, `expiresAt`,
  `revokedAt`, `createdAt`, `userAgent`.

**Routes `/api/v1/auth`**
- `POST /register` — rôles `FAMILY`, `SENIOR`, `COMPANION` uniquement (jamais
  `ADMIN` : seed ou script).
- `POST /login` — `email`, `password`, `remember`.
- `POST /refresh`, `POST /logout`.
- `GET /me` — profil sans hash.

**Cookies** (httpOnly, `Secure` en production, `SameSite=Lax`, domaine
configurable)
- `mc_access` : JWT 15 min signé **ES256** ; claims `sub`, `role`, `status`.
  Le middleware Next le vérifiera avec la **clé publique** seule (`jose`).
- `mc_refresh` : jeton opaque, `path=/api/v1/auth` ; 30 jours avec
  « se souvenir de moi », sinon cookie de session. Stocké haché en base,
  **renouvelé à chaque usage** ; la réutilisation d'un jeton déjà consommé
  révoque toute sa famille.

**Règles**
- Mot de passe : 8 caractères minimum.
- Compte suspendu : ni connexion, ni rafraîchissement.
- Échec de connexion : message générique (ne révèle pas si l'e-mail existe).
- Limitation des essais sur `login` et `register`.

**Rôles** : guard global, tout est protégé par défaut ; `@Public()` pour les
routes ouvertes, `@Roles(...)` pour restreindre.

**Correspondance front** (sous-projet suivant) : `FAMILY` → `/proche`,
`SENIOR` → `/senior`, `COMPANION` → `/accompagnant`, `ADMIN` → `/admin`.

## Section 3 — Qualité, données de démo, CI

**Tests** (écrits avant le code)
- Unitaires (Jest), services avec repositories factices : e-mail déjà pris,
  rôle admin refusé à l'inscription, mauvais mot de passe, compte suspendu,
  rotation du refresh, réutilisation → révocation de la famille, expiration.
- E2E (supertest) contre la base de test, tables vidées entre les tests :
  inscription → `me` → refresh → logout, attributs des cookies, 401 sans jeton,
  403 mauvais rôle, format d'erreur, healthcheck.

**Données de démo** (`pnpm db:seed`, idempotent) : Nadège K. (famille),
Mme Adjovi (senior), Julienne A. (accompagnante), Équipe Cotonou (admin) ;
mot de passe de dev documenté dans le README.

**Commandes** : `dev`, `build`, `start`, `test`, `test:e2e`, `lint`,
`format`, `typecheck`, `db:migrate`, `db:seed`, `keys:generate` (paire ES256
locale).

**CI GitHub Actions** (push + PR, service PostgreSQL) : install, lint,
typecheck, unitaires, migrations, e2e.

**Configuration** : `.env.example` documente chaque variable (base, clés JWT,
origine du front, domaine des cookies, durées des jetons) ; validation au
démarrage.

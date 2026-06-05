# Ledesma AI Labs — Plataforma

Monorepo de la plataforma de configuracion de agentes (cuerpo agnostico de modelo).
Separado del showroom. Las llaves de modelo (BYOK) nunca se persisten.

## Estructura
- `apps/backend` — API (Fastify, el cuerpo del agente).
- `apps/console` — Consola de configuracion (React + Vite).

## Scripts (raiz)
- `npm run typecheck` — verificacion de tipos.
- `npm run lint` — ESLint.
- `npm run build` — build de todos los workspaces.
- `npm run test` — tests de todos los workspaces.

Node 20. Trabajo 100% en la nube.

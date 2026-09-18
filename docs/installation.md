# Installation

> PwnDoc-ng uses 3 containers: the backend, the frontend and the database.

## Production

All 3 containers can be run at once using the docker-compose file in the root directory.

!> For production usage make sure to change the certificates in `backend/ssl` folder and optionnaly to set the JWT secret in `backend/src/lib/auth.js` (`jwtSecret` and `jwtRefreshSecret` in `backend/src/config/config.json`) if you don't want to use random ones.

Build and run Docker containers

```
docker-compose up -d --build
```

Display backend container logs

```
docker-compose logs -f backend
```

Stop/Start containers

```
docker-compose stop
docker-compose start
```

Remove containers

```
docker-compose down
```

Update

```
docker-compose down
git pull
docker-compose up -d --build
```

See [Upgrading with data preservation](installation.md?id=upgrading-with-data-preservation) before updating a production instance: three tracked files/folders (`backend/src/config`, `backend/report-templates`, `backend/ssl`) are modified by the running application and must not be overwritten by `git pull`.

Application is accessible through https://localhost:8443
API is accessible through https://localhost:8443/api

## Development

For development purposes, specific docker-compose file can be used in each folder (backend/frontend).

> *Source code can be modified live and application will automatically reload on changes.*

Build and run backend and database containers

```
docker-compose -f backend/docker-compose.dev.yml up -d --build
```

Display backend container logs

```
docker-compose -f backend/docker-compose.dev.yml logs -f pwndoc-ng-backend
```

Stop/Start container

```
docker-compose -f backend/docker-compose.dev.yml stop
docker-compose -f backend/docker-compose.dev.yml start
```

Remove containers

```
docker-compose -f backend/docker-compose.dev.yml down
```

Application is accessible through https://localhost:8081
API is accessible through https://localhost:8081/api

## Tests

> For now only backend tests have been written (it's a continuous work in progress)

Test files are located in `backend/tests` using Jest testing framework

Script `run_tests.sh` at the root folder can be used to launch tests :

```
Usage:        ./run_tests.sh -q|-f [-h, --help]

Options:
  -h, --help  Display help
  -q          Run quick tests (No build)
  -f          Run full tests (Build with no cache)
```

!> **Don't use it in production as it will delete the production Database**

## Backup

It's possible, even recommended, to regularly backup the `mongo-data` volume. It contains all the database.

Find the location of the volume on the disk:

```
sudo docker inspect pwndoc-ng_mongo-data
[
    {
        "CreatedAt": "2022-09-18T19:11:42+02:00",
        "Driver": "local",
        "Labels": {
            "com.docker.compose.project": "pwndoc-ng",
            "com.docker.compose.version": "2.11.0",
            "com.docker.compose.volume": "mongo-data"
        },
        "Mountpoint": "/var/lib/docker/volumes/pwndoc-ng_mongo-data/_data",
        "Name": "pwndoc-ng_mongo-data",
        "Options": null,
        "Scope": "local"
    }
]
```

To restore :

- Stop containers
- Replace the current `mongo-data` volume with the backed up one
- Start containers

A raw copy of the volume is only consistent when the containers are stopped and is not portable across MongoDB major versions. A logical dump works while the instance is running and restores on any version:

```
mkdir -p backup
docker exec mongo-pwndoc-ng mongodump --archive --gzip --db pwndoc > backup/pwndoc-$(date +%F).archive.gz
docker exec -i mongo-pwndoc-ng mongorestore --archive --gzip --drop < backup/pwndoc-2024-01-31.archive.gz   # restore
```

The database is not the only state. Back up these folders together with the dump:

| What | Where | Notes |
|------|-------|-------|
| Report templates (.docx) | `backend/report-templates/` | the database only stores the template name |
| JWT secrets, roles, report formatting defaults | `backend/src/config/config.json`, `roles.json`, `report-styles.json` | `config.json` is rewritten by the backend on first start with random secrets |
| TLS certificates (if customized) | `backend/ssl/`, `frontend/ssl/` | baked into the images at build time |

!> If *Settings > Dangerous settings* enables automatic deletion of old audits, disable it before restoring an old dump: the daily job deletes audits by creation date.

## Upgrading with data preservation

The database schema has no migration step; upgrading is a rebuild of the backend/frontend images against the same volume. The traps are the compose project name (the volume is named `<project>_mongo-data`, `<project>` being the directory name unless `COMPOSE_PROJECT_NAME` is set) and the tracked files that the running instance modifies.

```
cd <directory containing docker-compose.yml>

# 1. backup
mkdir -p backup
docker exec mongo-pwndoc-ng mongodump --archive --gzip --db pwndoc > backup/pwndoc-$(date +%F).archive.gz
cp -a backend/report-templates backend/src/config backend/ssl frontend/ssl backup/

# 2. switch the code (git) without touching the runtime files
git stash push -u -- backend/src/config backend/report-templates backend/ssl frontend/ssl
git fetch <remote>
git checkout <branch or tag>
git stash pop

# 3. rebuild what changed; the mongodb container and its volume are untouched
docker compose build backend frontend
docker compose up -d backend frontend
docker compose logs -f backend
```

Roll back with `git checkout <previous commit>` and the same build/up commands. Restoring the dump is only needed if data was changed in between.

Keep the compose directory name (or set `COMPOSE_PROJECT_NAME` in a `.env` file) so the existing `mongo-data` volume is reused, and keep the container names `mongo-pwndoc-ng`, `pwndoc-ng-backend` and `pwndoc-ng-languagetool`: they are referenced by `backend/src/config/config.json` and `frontend/.docker/nginx.conf`.

Changing the MongoDB major version (e.g. 4.4 → 6.0) is a separate operation: upgrade one major at a time and run `db.adminCommand({setFeatureCompatibilityVersion: "<version>"})` between steps, or `mongodump` on the old version and `mongorestore` into a fresh volume on the new one.

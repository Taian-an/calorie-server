# ops

Files that live outside this folder on the production VM (Azure, Japan East, `azureuser@20.46.181.25`).

| File | Copy of / used for |
|---|---|
| `deploy.sh` | Deploys `server/` to `/var/www/calorie-backend` and restarts PM2; `--with-web` also builds and uploads the Expo web app. Run from `SP/` via the `SP/deploy.sh` symlink. Needs `SP/AI-calorie-server_key.pem` and `SP/calorie-app/`. |
| `nginx-calorie.conf` | Snapshot of `/etc/nginx/sites-available/calorie` (site, `/api` proxy, `/admin`, dotted-nip.io redirects). Certificates are managed by certbot and are not stored here. |

Server-side settings not captured in files:

- MongoDB listens on `127.0.0.1` only (`/etc/mongod.conf` `bindIp`). Connect with Compass over an SSH tunnel.
- The production `.env` is at `/var/www/calorie-backend/.env` and is never deployed or committed.

To restore nginx on a rebuilt VM: copy `nginx-calorie.conf` to `/etc/nginx/sites-available/calorie`, symlink it into `sites-enabled`, run `sudo certbot --nginx` for the domains, then `sudo nginx -t && sudo systemctl reload nginx`.

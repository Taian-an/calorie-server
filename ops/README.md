# ops

Files that live outside this folder on the production VM (Azure, Japan East, `azureuser@20.46.181.25`).

| File | Copy of / used for |
|---|---|
| `deploy.sh` | Deploys `server/` to `/var/www/calorie-backend` and restarts PM2; `--with-web` also builds and uploads the Expo web app. Run from `SP/` via the `SP/deploy.sh` symlink. Needs `SP/AI-calorie-server_key.pem` and `SP/calorie-app/`. |
| `nginx-calorie.conf` | Snapshot of `/etc/nginx/sites-available/calorie`: `app.calorietracks.com` (web app, `/api`, `/admin`); `calorietracks.com`/`www` (temporary 302 to the app until the landing page exists); the old `20-46-181-25.nip.io` host, which only serves `/api` for already-installed apps and 301-redirects every other path to `app.calorietracks.com`; http→https redirects. Certificates are managed by certbot (`calorietracks.com` and `20-46-181-25.nip.io`) and are not stored here. |
| `nginx-snippet-calorie-app.conf` | Copy of `/etc/nginx/snippets/calorie-app-locations.conf`: web app and `/admin` locations. |
| `nginx-snippet-calorie-api.conf` | Copy of `/etc/nginx/snippets/calorie-api.conf`: the `/api` proxy, included by both the new and the old host. |

Server-side settings not captured in files:

- MongoDB listens on `127.0.0.1` only (`/etc/mongod.conf` `bindIp`). Connect with Compass over an SSH tunnel.
- The production `.env` is at `/var/www/calorie-backend/.env` and is never deployed or committed.

To restore nginx on a rebuilt VM: copy `nginx-calorie.conf` to `/etc/nginx/sites-available/calorie` and the two snippets to `/etc/nginx/snippets/calorie-app-locations.conf` and `calorie-api.conf`, symlink the site into `sites-enabled`, run `sudo certbot --nginx` for the domains, then `sudo nginx -t && sudo systemctl reload nginx`.

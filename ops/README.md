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
- The VM boots kernel `6.17.0-1022-azure` on purpose (`GRUB_DEFAULT` in `/etc/default/grub`), and the `linux-*-azure` meta-packages are on `apt-mark hold`. MongoDB 8.0.32 refuses to start on kernels 6.19 and newer (SERVER-121912); an automatic update to 7.0 took the database down on 2026-10-15. Upgrade MongoDB to a release that supports the newer kernel before removing the hold.
- The admin panel has no default password. On an empty database the server creates the `admin` account only if `ADMIN_INITIAL_PASSWORD` (12+ characters) is set; remove the variable once the account exists.

## Pending on the production VM

- **Fix duplicate user numbers after the next deploy.** Older builds numbered users by user count, so deleting a user made the next sign-up reuse a number. `ops/` isn't deployed, so run the script from this machine through an SSH tunnel: back up `users` (mongodump), open `ssh -i ../AI-calorie-server_key.pem -N -L 27018:127.0.0.1:27017 azureuser@20.46.181.25`, then run `MONGODB_URI=mongodb://127.0.0.1:27018/calorieDB node ops/fix-duplicate-user-ids.js` (dry run), check the list, and run it again with `--apply`. It renumbers the newer account in each duplicate pair and creates the unique index on `userId`. Until then MongoDB can't build that index (the duplicates block it), but every new number is already unique.
- **Copy the two nginx snippets to the VM** (`/etc/nginx/snippets/`) and reload nginx. They now pass `X-Forwarded-For`; without it every request reaches Node as `127.0.0.1` and all users share one login rate limit.
- **Change the admin password first thing after the VM is back.** Older builds created `admin` / `admin123` automatically, and the production admin may still use it. Log in to `/admin` → Settings and set a strong password.

To restore nginx on a rebuilt VM: copy `nginx-calorie.conf` to `/etc/nginx/sites-available/calorie` and the two snippets to `/etc/nginx/snippets/calorie-app-locations.conf` and `calorie-api.conf`, symlink the site into `sites-enabled`, run `sudo certbot --nginx` for the domains, then `sudo nginx -t && sudo systemctl reload nginx`.

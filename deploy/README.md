# Running Shelved as a service

The app otherwise has to be started by hand and stops when the terminal closes.
This unit starts it at boot and restarts it if it falls over.

```bash
sudo cp deploy/shelved.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shelved
```

Check it:

```bash
systemctl status shelved
journalctl -u shelved -f          # live logs
```

The unit waits for the external drive to be mounted (`RequiresMountsFor`), since
the code lives there and udisks mounts it after boot.

## Serving it under a sub-path

Useful behind a reverse proxy, or on a Tailscale Funnel port that already hosts
something else. One setting drives the asset URLs, the client router and the
server mount point together, so the URL shape is the same everywhere.

```bash
SHELVED_BASE_PATH=/media npm run build
SHELVED_BASE_PATH=/media npm start        # http://localhost:4123/media
```

For the service, set it in the unit and rebuild to match — the build and the
server must agree, or the page will load with no styling and no data:

```bash
sudo systemctl edit --full shelved       # add: Environment=SHELVED_BASE_PATH=/media
SHELVED_BASE_PATH=/media npm run build
sudo systemctl restart shelved
```

### Publishing on a shared Tailscale Funnel port

Funnel only listens on 443, 8443 and 10000. If all three already host something,
mount this app on a path of one of them. `--set-path` strips the prefix before
proxying, so point the target at the same path to keep it:

```bash
sudo tailscale funnel --bg --set-path=/media http://127.0.0.1:4123/media
tailscale serve status                     # see everything you have published
```

To undo:

```bash
sudo tailscale funnel --https=443 --set-path=/media off
```

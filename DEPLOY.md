# Putting Shelved on a public URL

The app is a Node server with a SQLite database, so it needs somewhere that runs
Node and gives it a real disk. These steps use [Fly.io](https://fly.io), whose free
allowance comfortably covers a single-user app.

End result: `https://shelved.fly.dev` (or whatever name you pick), locked behind
your password, with your library on a persistent volume.

---

## Before you start

- A Fly.io account (card required for verification; this configuration stays inside
  the free allowance).
- `flyctl` installed:
  ```bash
  curl -L https://fly.io/install.sh | sh
  ```
  Then `fly auth login`.

## 1. Create the app

From the project directory:

```bash
fly launch --no-deploy --copy-config --name shelved --region lhr
```

`--copy-config` uses the `fly.toml` already in the repo. Say **no** if it offers to
set up Postgres or Redis — neither is needed. Pick a different `--name` if
`shelved` is taken; the URL follows the name.

## 2. Create the volume

```bash
fly volumes create shelved_data --size 1 --region lhr --yes
```

1 GB is far more than this needs — the sample library is under 20 MB including
cached metadata. It must be in the same region as the app.

> **One machine only.** A Fly volume attaches to a single machine, and SQLite
> expects one writer. Do not scale this app past one instance.

## 3. Set your password

```bash
fly secrets set SHELVED_PASSWORD='something long you will remember'
```

This matters: an app with no password refuses to let anyone set one over the public
internet — otherwise the first stranger to find the URL would claim it. Setting the
secret means the deployment is locked from its first boot.

## 4. Deploy

```bash
fly deploy
```

Then `fly open`, and sign in with the password above.

---

## Moving your existing library up

Your current library lives in `data/shelved.db` on the Pi. To carry it over:

```bash
# Stop the app so nothing is writing to the database mid-copy
fly machine list                      # note the machine id
fly machine stop <machine-id>

fly ssh sftp shell
> put data/shelved.db /data/shelved.db
> quit

fly machine start <machine-id>
```

Starting from scratch instead is fine too — open the deployed app, go to Import and
either upload your exports again or press "Load a sample library".

The password is stored *in* the database, so a copied-up database brings its own
password with it. `SHELVED_PASSWORD` is reapplied at every boot, so whatever is in
that secret wins.

## Backing it up

```bash
fly ssh sftp get /data/shelved.db ./shelved-backup.db
```

Worth doing occasionally — a Fly volume is a single disk, not a replicated store.
There is also **Settings → Your data → Export JSON/CSV** in the app itself.

## 5. Let GitHub deploy it from then on

The repo ships a deploy workflow that sits dormant until you give it a token:

```bash
fly tokens create deploy -x 999999h
gh secret set FLY_API_TOKEN          # paste the token when prompted
```

After that every push to `main` deploys itself, and you never touch `fly deploy`
again. Without the secret the workflow does nothing and passes, so it will not
clutter the repo with failures.

## 6. Put the link where you can find it

Once `fly open` works, point the repo at it:

```bash
# the "About" link on the GitHub repo page
gh repo edit --homepage https://shelved.fly.dev
```

and swap the placeholder at the top of `README.md` for:

```markdown
### ▶ [Open the app](https://shelved.fly.dev)
```

---

## Afterwards

**Service connections.** The redirect URI for Spotify changes once you are hosted.
In your Spotify dashboard add:

```
https://shelved.fly.dev/api/connections/spotify/callback
```

and paste the same address into the Redirect URI box on the Connections page. Trakt
(device code), Last.fm and Steam need no redirect and work unchanged.

**Cost control.** `auto_stop_machines = "suspend"` in `fly.toml` suspends the machine
when idle and wakes it on the next request, so it is not billing while you sleep. The
first request after an idle spell takes a few seconds. To keep it always warm, set
`min_machines_running = 1` — and check the pricing page first.

**Logs and shell.**

```bash
fly logs
fly ssh console
```

## Keeping the Pi copy too

They are independent: the Pi keeps its own `data/shelved.db`. Run both if you like,
but nothing syncs between them — decide which one is the real library.

# GitHub Actions Auto-Deploy Setup

## What This Does
Every push to `main` automatically deploys to your VPS via SSH. No more manual SSH sessions.

## Step 1: Generate an SSH Key Pair (on your local machine)
```bash
# In Git Bash or WSL
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy
# Do NOT set a passphrase (press Enter twice)
```

This creates:
- `~/.ssh/github_actions_deploy` — private key (GOES IN GITHUB SECRETS)
- `~/.ssh/github_actions_deploy.pub` — public key (GOES ON YOUR VPS)

## Step 2: Add Public Key to Your VPS
```bash
ssh root@YOUR_VPS_IP
# On the VPS:
mkdir -p ~/.ssh
cat >> ~/.ssh/authorized_keys << 'EOF'
# Paste the contents of github_actions_deploy.pub here
EOF
chmod 600 ~/.ssh/authorized_keys
```

## Step 3: Add Secrets to GitHub
1. Go to https://github.com/jpgyap-sudo/xsjprd55/settings/secrets/actions
2. Click **New repository secret** and add these 3 secrets:

| Secret Name | Value |
|---|---|
| `VPS_HOST` | Your VPS IP address (e.g., `123.45.67.89`) |
| `VPS_USER` | `root` (or your VPS username) |
| `VPS_SSH_KEY` | Full contents of `~/.ssh/github_actions_deploy` (private key) |

## Step 4: Test It
1. Push any change to `main` (or click "Run workflow" in the Actions tab)
2. Go to https://github.com/jpgyap-sudo/xsjprd55/actions
3. Watch the deploy job run — it should show green ✅

## What the Workflow Does
1. Fetches latest `main` from GitHub
2. Runs `npm install`
3. Restarts all PM2 processes with `pm2 restart ecosystem.config.cjs --update-env`
4. Runs a health check on `http://localhost:3000/api/health`
5. Fails the deploy if health check fails (so you know immediately)

## Security Notes
- The private key never leaves GitHub's encrypted secret store
- The public key only allows SSH access — it can't do anything on its own
- If you ever need to revoke access, just delete the public key from `~/.ssh/authorized_keys` on your VPS

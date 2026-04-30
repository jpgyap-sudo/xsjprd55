# Windows SSH Key Authentication Setup Guide

Complete guide for setting up SSH key-based authentication from Windows 10 to VPS (165.22.110.111) for automated deployments.

---

## Table of Contents

1. [Check Existing SSH Keys](#1-check-existing-ssh-keys)
2. [Generate New SSH Key](#2-generate-new-ssh-key-if-needed)
3. [Copy Public Key to VPS](#3-copy-public-key-to-vps)
4. [Configure SSH Client](#4-configure-ssh-client-windows)
5. [Test the Connection](#5-test-the-connection)
6. [Set Environment Variable](#6-set-up-environment-variable-for-deploy-scripts)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Check Existing SSH Keys

First, check if you already have SSH keys on your Windows machine.

### Using Command Prompt (cmd.exe):

```cmd
dir C:\Users\User\.ssh\
```

### Using PowerShell:

```powershell
Get-ChildItem C:\Users\User\.ssh\
```

### Expected Output (if keys exist):
```
id_ed25519
id_ed25519.pub
id_rsa
id_rsa.pub
known_hosts
config
```

### Common Key File Names:
| File | Description |
|------|-------------|
| `id_rsa` | RSA private key (older format) |
| `id_rsa.pub` | RSA public key |
| `id_ed25519` | Ed25519 private key (recommended) |
| `id_ed25519.pub` | Ed25519 public key |
| `id_ed25519_roo` | Project-specific private key |
| `id_ed25519_roo.pub` | Project-specific public key |
| `config` | SSH client configuration |
| `known_hosts` | Trusted host fingerprints |

**If you already have a key pair**, skip to [Step 3: Copy Public Key to VPS](#3-copy-public-key-to-vps).

---

## 2. Generate New SSH Key (if needed)

If no suitable key exists, generate a new Ed25519 key pair.

### Open PowerShell or Command Prompt

Press `Win + R`, type `powershell`, and press **Enter**.

### Generate the Key

```powershell
ssh-keygen -t ed25519 -C "your-email@example.com" -f C:\Users\User\.ssh\id_ed25519_roo
```

### During Generation, You'll See:

```
Generating public/private ed25519 key pair.
Enter passphrase (empty for no passphrase): [OPTIONAL - press Enter to skip]
Enter same passphrase again: [Press Enter again if no passphrase]
Your identification has been saved in C:\Users\User\.ssh\id_ed25519_roo
Your public key has been saved in C:\Users\User\.ssh\id_ed25519_roo.pub
The key fingerprint is:
SHA256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx your-email@example.com
```

### Passphrase Options:

| Option | Security | Convenience |
|--------|----------|-------------|
| **No passphrase** | Lower (key file alone grants access) | Higher (no password entry needed) |
| **With passphrase** | Higher (requires password + key file) | Lower (must enter password each time) |

**For automated deployments:** Use no passphrase or use `ssh-agent` (see troubleshooting section).

### Verify Key Creation:

```powershell
type C:\Users\User\.ssh\id_ed25519_roo.pub
```

You should see something like:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDIhz2GK/XCUj4i6Q5yQJNL1MXMY0RxzPV2QrBqfHrD your-email@example.com
```

---

## 3. Copy Public Key to VPS

Choose **Method A** (if `ssh-copy-id` is available) or **Method B** (manual copy via DigitalOcean Console).

### Method A: Using ssh-copy-id (Recommended if available)

**Check if ssh-copy-id exists:**

```powershell
Get-Command ssh-copy-id
```

If found, copy your key:

```powershell
ssh-copy-id -i C:\Users\User\.ssh\id_ed25519_roo.pub root@165.22.110.111
```

You'll be prompted for the VPS root password (once). After success, the key is installed.

### Method B: Manual Copy via DigitalOcean Console

Use this if `ssh-copy-id` is not available on Windows.

#### Step B1: Display Your Public Key

**In Windows PowerShell/CMD:**

```cmd
type C:\Users\User\.ssh\id_ed25519_roo.pub
```

Copy the entire output (starts with `ssh-ed25519` and ends with your email).

#### Step B2: Access VPS via DigitalOcean Console

1. Log into [DigitalOcean Dashboard](https://cloud.digitalocean.com/)
2. Go to **Droplets** → Select your droplet (165.22.110.111)
3. Click **Console** button (opens browser-based terminal)
4. Log in as `root` with your root password

#### Step B3: Add Key to authorized_keys

**In the DigitalOcean console, run:**

```bash
# Create .ssh directory if it doesn't exist
mkdir -p /root/.ssh

# Set correct permissions
chmod 700 /root/.ssh

# Add your public key to authorized_keys
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDIhz2GK/XCUj4i6Q5yQJNL1MXMY0RxzPV2QrBqfHrD your-email@example.com" >> /root/.ssh/authorized_keys
```

**⚠️ Replace the ssh-ed25519 string above with YOUR actual public key from Step B1!**

#### Step B4: Set Correct Permissions

```bash
# Set permissions on authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Verify
ls -la /root/.ssh/
```

Expected output:
```
drwx------ 2 root root 4096 Apr 30 22:00 .
drwx------ 6 root root 4096 Apr 30 21:00 ..
-rw------- 1 root root  106 Apr 30 22:00 authorized_keys
```

#### Step B5: Ensure SSH Key Auth is Enabled

```bash
grep -E "^(PubkeyAuthentication|PasswordAuthentication|PermitRootLogin)" /etc/ssh/sshd_config
```

Expected/Desired output:
```
PubkeyAuthentication yes
PasswordAuthentication yes
PermitRootLogin yes
```

If changes were made, restart SSH:

```bash
systemctl restart sshd
```

---

## 4. Configure SSH Client (Windows)

Create or edit the SSH config file to simplify connections.

### Create/Edit Config File

**In Windows PowerShell:**

```powershell
notepad C:\Users\User\.ssh\config
```

If the file doesn't exist, Notepad will ask to create it. Click **Yes**.

### Add VPS Host Configuration

Paste this into the config file:

```
# Trading Bot VPS
Host trading-bot
    HostName 165.22.110.111
    User root
    IdentityFile C:\Users\User\.ssh\id_ed25519_roo
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60
    ServerAliveCountMax 3
    ConnectTimeout 10
    IdentitiesOnly yes

# Alias for quick access
Host vps
    HostName 165.22.110.111
    User root
    IdentityFile C:\Users\User\.ssh\id_ed25519_roo
    StrictHostKeyChecking accept-new
    ServerAliveInterval 60
```

### Configuration Options Explained:

| Option | Description |
|--------|-------------|
| `Host` | Alias name for the connection |
| `HostName` | IP address or domain of the VPS |
| `User` | Username to log in as (root) |
| `IdentityFile` | Path to your private key |
| `StrictHostKeyChecking` | `accept-new` = auto-accept new hosts |
| `ServerAliveInterval` | Send keepalive every 60 seconds |
| `ServerAliveCountMax` | Disconnect after 3 failed keepalives |
| `ConnectTimeout` | Connection timeout in seconds |
| `IdentitiesOnly` | Only use the specified key |

### Save the File

1. Press `Ctrl + S` to save
2. Close Notepad

---

## 5. Test the Connection

### Basic Test

**In Windows PowerShell/CMD:**

```powershell
ssh root@165.22.110.111 "echo 'SSH OK'"
```

Expected output:
```
SSH OK
```

### Test Using Config Alias

```powershell
ssh trading-bot "echo 'Config alias works'"
```

Or:

```powershell
ssh vps "whoami"
```

Expected output:
```
root
```

### Test with Specific Key File

If the above doesn't work, try specifying the key explicitly:

```powershell
ssh -i C:\Users\User\.ssh\id_ed25519_roo root@165.22.110.111 "echo 'SSH with key works'"
```

### Test Deploy Script Commands

```powershell
ssh root@165.22.110.111 "cd ~/xsjprd55 && git rev-parse HEAD"
```

Expected output (commit hash):
```
5fe8f50c3d2e1a...
```

### Test PM2 Commands

```powershell
ssh root@165.22.110.111 "pm2 list"
```

Expected output: Table of running PM2 processes.

---

## 6. Set Up Environment Variable for Deploy Scripts

The deployment scripts use `VPS_SSH_KEY` environment variable to locate your private key.

### Option A: Set via System Properties (Persistent)

1. Press `Win + R`, type `sysdm.cpl`, press **Enter**
2. Go to **Advanced** tab → Click **Environment Variables**
3. Under **User variables**, click **New**
4. Variable name: `VPS_SSH_KEY`
5. Variable value: `C:\Users\User\.ssh\id_ed25519_roo`
6. Click **OK** → **OK** → **OK**
7. **Restart** any open PowerShell/CMD windows

### Option B: Set via PowerShell (Current Session Only)

```powershell
$env:VPS_SSH_KEY = "C:\Users\User\.ssh\id_ed25519_roo"
```

To verify:

```powershell
echo $env:VPS_SSH_KEY
```

### Option C: Set via Command Prompt (Current Session Only)

```cmd
set VPS_SSH_KEY=C:\Users\User\.ssh\id_ed25519_roo
```

To verify:

```cmd
echo %VPS_SSH_KEY%
```

### Option D: Add to PowerShell Profile (Persistent for PowerShell)

```powershell
# Open profile in notepad
notepad $PROFILE

# If file doesn't exist, create it first:
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
notepad $PROFILE
```

Add this line to the profile:

```powershell
$env:VPS_SSH_KEY = "C:\Users\User\.ssh\id_ed25519_roo"
```

Save and restart PowerShell.

---

## 7. Troubleshooting

### Error: "Permission denied (publickey)"

**Causes & Fixes:**

1. **Key not copied to VPS:**
   - Re-do [Step 3: Copy Public Key to VPS](#3-copy-public-key-to-vps)
   - Verify key is in `/root/.ssh/authorized_keys` on VPS

2. **Wrong permissions on VPS:**
   ```bash
   chmod 700 /root/.ssh
   chmod 600 /root/.ssh/authorized_keys
   ```

3. **Wrong key file specified:**
   - Check: `type C:\Users\User\.ssh\id_ed25519_roo.pub`
   - Ensure it matches what's in VPS authorized_keys

4. **SSH key auth disabled on VPS:**
   ```bash
   # On VPS, check:
   cat /etc/ssh/sshd_config | grep PubkeyAuthentication
   
   # Should show: PubkeyAuthentication yes
   # If not, edit and restart: systemctl restart sshd
   ```

### Error: "Connection timed out"

**Causes & Fixes:**

1. **VPS firewall blocking SSH:**
   - Check DigitalOcean firewall settings
   - Ensure port 22 is open

2. **Wrong IP address:**
   - Verify VPS IP: `165.22.110.111`

3. **Network issues:**
   ```powershell
   # Test connectivity
   Test-NetConnection 165.22.110.111 -Port 22
   ```

### Error: "Could not resolve hostname"

- Check your internet connection
- Verify the IP address is correct
- Try using IP instead of hostname

### Error: "Bad owner or permissions on .ssh/config"

Windows doesn't have the same permission issues as Linux, but if you see this:

```powershell
# Check file permissions
Get-Acl C:\Users\User\.ssh\config | Format-List
```

Ensure only your user has access. If needed, recreate the file.

### Using Password Auth Temporarily (Not Recommended for Production)

If you need to temporarily use password authentication:

```powershell
ssh -o PubkeyAuthentication=no root@165.22.110.111
```

**⚠️ Warning:** Password auth is less secure and should only be used for initial setup. Always switch to key-based auth for production.

### Using ssh-agent (For Passphrase-Protected Keys)

If you set a passphrase on your key and want to avoid typing it repeatedly:

```powershell
# Start ssh-agent
Get-Service ssh-agent | Set-Service -StartupType Manual
Start-Service ssh-agent

# Add your key (enter passphrase once)
ssh-add C:\Users\User\.ssh\id_ed25519_roo

# Verify key is loaded
ssh-add -l
```

Now you can SSH without entering the passphrase until you close the terminal.

### Debug SSH Connection

For detailed debugging:

```powershell
ssh -vvv root@165.22.110.111
```

This shows verbose output to identify exactly where the connection fails.

### Reset VPS Root Password (If Locked Out)

If you can't connect at all:

1. Go to [DigitalOcean Dashboard](https://cloud.digitalocean.com/)
2. Select your droplet
3. Click **Access** → **Reset Root Password**
4. Check your email for the new password
5. Use DigitalOcean Console to log in with new password

---

## Quick Reference Commands

| Task | Command |
|------|---------|
| Check for existing keys | `dir C:\Users\User\.ssh\` |
| Generate new Ed25519 key | `ssh-keygen -t ed25519 -f C:\Users\User\.ssh\id_ed25519_roo` |
| View public key | `type C:\Users\User\.ssh\id_ed25519_roo.pub` |
| Test SSH connection | `ssh root@165.22.110.111 "echo 'OK'"` |
| SSH with specific key | `ssh -i C:\Users\User\.ssh\id_ed25519_roo root@165.22.110.111` |
| Copy key (if available) | `ssh-copy-id -i C:\Users\User\.ssh\id_ed25519_roo.pub root@165.22.110.111` |
| Set env var (PowerShell) | `$env:VPS_SSH_KEY = "C:\Users\User\.ssh\id_ed25519_roo"` |
| Set env var (CMD) | `set VPS_SSH_KEY=C:\Users\User\.ssh\id_ed25519_roo` |
| Debug SSH issues | `ssh -vvv root@165.22.110.111` |

---

## Next Steps

Once SSH key authentication is working:

1. **Test deployment scripts:**
   ```powershell
   node workers/deploy-checker.js --status
   ```

2. **Verify auto-deploy can connect:**
   ```powershell
   ssh root@165.22.110.111 "cd ~/xsjprd55 && git status"
   ```

3. **Check VPS health:**
   ```powershell
   ssh root@165.22.110.111 "pm2 list"
   ```

---

*Last updated: 2026-04-30*
*VPS: 165.22.110.111*
*Key File: C:\Users\User\.ssh\id_ed25519_roo*

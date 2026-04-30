# 🚀 Deployment Tracking & Automation System

A comprehensive system to ensure all coding agent changes are tracked, committed, and deployed automatically.

## Overview

This system solves the problem of multiple coding agents making changes that might not get properly tracked, committed, or deployed. It provides:

- **Automatic change detection** - Tracks all agent modifications
- **Git hooks** - Prevents uncommitted work from being lost
- **Deployment queue** - Ensures every commit gets deployed
- **Auto-deployment** - Zero-downtime VPS deployment
- **Health checks** - Verifies deployments succeed
- **Dashboard** - Visual overview of deployment status

## Quick Start

### One-Command Deploy
```bash
# Deploy everything (commit + push + deploy)
./scripts/deploy-everything.sh

# Quick commit with message and deploy
./scripts/quick-commit-and-deploy.sh "Your commit message"

# Check current status
./scripts/check-deployment-status.sh
```

### Check Status
```bash
# Full status check
./scripts/check-deployment-status.sh

# Via API
GET http://localhost:3000/api/deployment-dashboard
```

## Components

### 1. Git Hooks (`.git/hooks/`)

**pre-commit**: Detects agent changes and tracks them before commit
- Identifies which agent made changes
- Classifies change type (feature/bugfix/hotfix/etc)
- Creates `.agent-changes.json` tracker

**post-commit**: Updates tracking after commit
- Records commit hash
- Adds to deployment queue
- Logs activity

**pre-push**: Validates before push
- Checks for uncommitted agent changes
- Verifies tests pass for worker changes

### 2. Workers (`workers/`)

**agent-change-tracker.js**
- Runs continuously to detect changes
- Alerts if uncommitted for >30 minutes
- Auto-commits if enabled
- Records to Supabase

**deployment-orchestrator.js**
- Processes deployment queue
- Auto-deploys to VPS
- Handles rollbacks on failure
- Sends Telegram notifications

**deploy-checker.js** (existing)
- Checks GitHub vs VPS commit sync
- Records status to database

### 3. Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `deploy-everything.sh` | Full deploy: commit → push → VPS deploy |
| `quick-commit-and-deploy.sh` | Quick commit + deploy in one command |
| `check-deployment-status.sh` | Check all deployment components |
| `roo-safe-deploy.sh` | VPS-side deployment script |
| `roo-safe-status.sh` | VPS health check script |

### 4. API (`api/`)

**deployment-dashboard.js**
```
GET  /api/deployment-dashboard          # Overview
GET  /api/deployment-dashboard/queue     # Deployment queue
GET  /api/deployment-dashboard/history   # Deploy history
GET  /api/deployment-dashboard/agents    # Agent activity
GET  /api/deployment-dashboard/status    # Current status
POST /api/deployment-dashboard/queue     # Add to queue
POST /api/deployment-dashboard/trigger   # Trigger deploy
```

### 5. Database Schema (`supabase/`)

**agent_deployment_tracking.sql**
- `agent_changes` - Every change detected
- `deployment_queue` - Pending deployments
- `deployment_history` - Complete audit trail
- `deployment_approvals` - Manual approval gates
- `agent_activity_log` - Real-time activity

## File Tracking

The system maintains several local tracking files:

| File | Purpose |
|------|---------|
| `.agent-changes.json` | Current detected changes |
| `.deploy-queue.json` | Pending deployments |
| `.deploy-state.json` | Deployment state |
| `.deployment-activity.log` | Activity log |

## Environment Variables

Add to `.env`:

```env
# Auto-deploy settings
AUTO_DEPLOY_ENABLED=true
AUTO_COMMIT_ENABLED=false
DEPLOY_MAINTENANCE_START_HOUR=23
DEPLOY_MAINTENANCE_END_HOUR=6

# VPS settings
VPS_IP=165.22.110.111
VPS_USER=root
VPS_SSH_KEY=/root/.ssh/id_ed25519

# Notifications
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id

# Supabase
SUPABASE_URL=your_url
SUPABASE_SERVICE_KEY=your_key
```

## Usage Workflows

### Workflow 1: Manual Deploy (Recommended)
```bash
# Make your changes
# ... edit files ...

# Deploy everything
./scripts/deploy-everything.sh

# This will:
# 1. Detect agent type from changes
# 2. Commit with proper message
# 3. Push to GitHub
# 4. Deploy to VPS
# 5. Run health checks
```

### Workflow 2: Quick Deploy
```bash
# Just commit and deploy with a message
./scripts/quick-commit-and-deploy.sh "Fixed trading signal bug"
```

### Workflow 3: Auto-Deploy (CI/CD)
```bash
# Start the orchestrator
node workers/deployment-orchestrator.js

# Or with PM2
pm2 start workers/deployment-orchestrator.js --name deploy-orchestrator

# It will:
# - Check queue every 2 minutes
# - Auto-deploy when commits detected
# - Handle failures and rollbacks
```

### Workflow 4: Track Agent Changes
```bash
# Start the change tracker
node workers/agent-change-tracker.js

# Or with PM2
pm2 start workers/agent-change-tracker.js --name agent-tracker

# It will:
# - Check for changes every minute
# - Alert if uncommitted >30 min
# - Auto-commit if enabled
```

## PM2 Configuration

Add to `ecosystem.config.cjs`:

```javascript
{
  name: 'agent-tracker',
  script: './workers/agent-change-tracker.js',
  instances: 1,
  exec_mode: 'fork',
  watch: false,
  autorestart: true
},
{
  name: 'deploy-orchestrator',
  script: './workers/deployment-orchestrator.js',
  instances: 1,
  exec_mode: 'fork',
  watch: false,
  autorestart: true
}
```

## Deployment Status Codes

| Status | Meaning |
|--------|---------|
| `detected` | Changes detected, not committed |
| `pending` | Waiting to be committed |
| `committed` | Committed, waiting to deploy |
| `queued` | In deployment queue |
| `deploying` | Currently deploying |
| `deployed` | Successfully deployed |
| `failed` | Deployment failed |
| `rolled_back` | Rolled back to previous |

## Safety Features

1. **Maintenance Window**: No auto-deploy between 23:00-06:00
2. **Consecutive Failure Limit**: Stops after 3 failures
3. **Health Checks**: Verifies deployment success
4. **Automatic Rollback**: Rolls back on health check failure
5. **SSH Timeout**: Prevents hanging connections
6. **Queue Persistence**: Survives restarts

## Troubleshooting

### Issue: Changes not being tracked
```bash
# Check if hooks are executable
ls -la .git/hooks/pre-commit

# Reinstall hooks
chmod +x .git/hooks/*
```

### Issue: Auto-deploy not working
```bash
# Check environment
node workers/deployment-orchestrator.js status

# Check VPS connectivity
ssh root@165.22.110.111 "echo 'OK'"
```

### Issue: Queue stuck
```bash
# Clear queue
rm .deploy-queue.json

# Or force deploy
node workers/deployment-orchestrator.js force-deploy
```

### Issue: Health checks failing
```bash
# Check VPS manually
ssh root@165.22.110.111 "pm2 status"
ssh root@165.22.110.111 "curl http://localhost:3000/api/health"
```

## Database Setup

Run the SQL to create tracking tables:

```bash
# Via psql
psql $DATABASE_URL -f supabase/agent_deployment_tracking.sql

# Via Supabase dashboard
# Copy contents of supabase/agent_deployment_tracking.sql
```

## Monitoring

### Dashboard
Visit `/api/deployment-dashboard` for real-time status

### Telegram Notifications
Get alerts for:
- Deployments started/completed/failed
- Uncommitted changes detected
- Health check failures
- Rollback events

### Logs
```bash
# Local activity
 tail -f .deployment-activity.log

# VPS deployment logs
ssh root@165.22.110.111 "tail -f /var/log/roo-deploy.log"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Coding Agent Activity                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Git Hooks (pre-commit, post-commit, pre-push)              │
│  - Detect agent type                                        │
│  - Track changes                                            │
│  - Update queue                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent Change Tracker Worker                                │
│  - Continuous monitoring                                    │
│  - Auto-commit (optional)                                   │
│  - Supabase sync                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Deployment Queue (.deploy-queue.json)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Deployment Orchestrator Worker                             │
│  - Process queue                                            │
│  - SSH to VPS                                               │
│  - Git pull + PM2 reload                                    │
│  - Health checks                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  VPS Production                                             │
│  - GitHub sync                                              │
│  - PM2 processes                                            │
│  - Health endpoint                                          │
└─────────────────────────────────────────────────────────────┘
```

## Best Practices

1. **Always use `./scripts/deploy-everything.sh`** instead of manual git commands
2. **Check status first** with `./scripts/check-deployment-status.sh`
3. **Enable auto-commit** only in trusted environments
4. **Monitor the queue** regularly to ensure deployments are processing
5. **Review agent activity** in Supabase dashboard
6. **Set up Telegram alerts** for production deployments

## Security Notes

- Never commit `.env` files
- SSH keys should be properly secured
- VPS access limited to necessary users
- Auto-deploy disabled by default
- Manual approval recommended for schema changes

---

*Last updated: 2026-04-30*
*System Version: 1.0*
# PERMISSIONS.md — Access and Approval Rules

Follow least-privilege access.

## Safe Without Extra Approval
May:
- Read project files
- Suggest code changes
- Edit local files
- Run local tests
- Create documentation
- Prepare commits
- Explain errors

## Ask Before Doing
Must ask before:
- Installing packages
- Creating commits
- Pushing to GitHub
- Opening pull requests
- Running migrations
- Changing Vercel settings
- Changing Supabase settings
- Setting Telegram webhook
- Sending test messages to a real Telegram chat
- Creating scheduled jobs
- Connecting paid APIs

## Strong Approval Required
Needs explicit approval before:
- Production deployment
- Destructive database migration (especially `signals`, `trades`, `users` tables)
- Deleting production data (signal history, trade logs, user data)
- Changing RLS/security policies
- Accessing production secrets
- Using service-role keys
- Enabling real trading or auto-trading
- Connecting exchange API keys
- Connecting wallet functionality
- Changing signal strategy logic

## Never Allowed
Must never ask for or handle:
- Crypto wallet seed phrases
- Private keys
- Raw passwords in chat
- Unrestricted exchange withdrawal keys
- Secrets committed to git

## Recommended Access Pattern
Use:
- Read-only API keys for market data
- Separate dev and production projects
- Separate dev and production environment variables
- Supabase anon key only in client code
- Supabase service-role key only in server-side secure runtime
- Telegram bot token only in server-side env vars
- Paper mode as default; live mode requires explicit user opt-in

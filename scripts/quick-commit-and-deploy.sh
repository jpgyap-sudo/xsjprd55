#!/bin/bash
# ============================================================
# Quick Commit and Deploy
# For when you just want to commit current changes and deploy
# Usage: ./scripts/quick-commit-and-deploy.sh "Your commit message"
# ============================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

# Get commit message
COMMIT_MSG="${1:-"Quick update $(date '+%Y-%m-%d %H:%M')"}"

echo "🚀 Quick Commit & Deploy"
echo "========================"
echo ""

# Check if there are changes
if [ -z "$(git status --porcelain)" ]; then
    echo "No changes to commit"
    echo "Running deploy anyway..."
else
    echo "Changes detected:"
    git status --short
    echo ""
    
    # Stage and commit
    echo "Staging changes..."
    git add .
    
    echo "Committing: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"
    
    echo "Pushing..."
    git push origin main
    
    echo ""
    echo "✅ Committed and pushed"
fi

echo ""
echo "Starting deployment..."
./scripts/deploy-everything.sh
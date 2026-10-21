#!/usr/bin/env bash
# 建置後把 dist/ 推到 gh-pages 分支
set -euo pipefail
npm run build
cd dist
touch .nojekyll
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Luke}" -c user.email="${GIT_AUTHOR_EMAIL:-lukens124@users.noreply.github.com}" commit -q -m "deploy $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f "$(git -C .. remote get-url origin)" gh-pages
rm -rf .git

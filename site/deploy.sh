#!/bin/sh
# Deploys the site to Vercel production. The tour lives once in the repo
# (demo/tour-v7.mp4); the site serves a copy as tour.mp4 (gitignored).
set -e
cd "$(dirname "$0")"
cp ../demo/tour-v7.mp4 tour.mp4
vercel deploy --prod --yes

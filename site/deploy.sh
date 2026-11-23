#!/bin/sh
# Deploys the site to Vercel production. The tour lives once in the repo
# (demo/tour-v8.mp4); the site serves a copy as tour.mp4 (gitignored).
set -e
cd "$(dirname "$0")"
cp ../demo/tour-v8.mp4 tour.mp4
vercel deploy --prod --yes
# Vercel has dropped the 28 MB tour from a deploy without an error: check it is served.
for i in 1 2 3; do
  curl -sfI https://fevm-replay.vercel.app/tour.mp4 >/dev/null && exit 0
  sleep 10
done
echo "deploy.sh: tour.mp4 is not served after the deploy; run it again" >&2
exit 1

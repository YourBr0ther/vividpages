#!/bin/bash
cd /home/chris/vividpages/backend

# Load environment variables
set -a
source ../.env
set +a

# Run the character worker
npm run worker:character

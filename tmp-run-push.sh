#!/bin/bash
cd /root/xsjprd55
export SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY /root/xsjprd55/.env | cut -d= -f2-)
node /tmp/push-schema.mjs

#!/bin/bash

hb-service update-node
hb-service add homebridge-appletv-enhanced@$(cat /tmp/package.json | jq --raw-output '.version')

#
# Docker Homebridge Custom Startup Script - homebridge/homebridge
#
# This script can be used to customise the environment and will be executed as
# the root user each time the container starts.
#
# Example installing packages:
#
# apt-get update
# apt-get install -y python3
#
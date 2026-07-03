#!/bin/bash
node /home/runner/workspace/node_modules/firebase-tools/lib/bin/firebase.js deploy --only functions:createCheckoutSession > /home/runner/workspace/cf2_deploy.log 2>&1
echo "EXIT:$?" >> /home/runner/workspace/cf2_deploy.log

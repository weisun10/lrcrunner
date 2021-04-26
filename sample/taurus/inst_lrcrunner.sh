#!/bin/bash

# Copyright 2021 - Micro Focus or one of its affiliates
#
# The only warranties for products and services of Micro Focus and its affiliates and licensors (“Micro Focus”)
# are as may be set forth in the express warranty statements accompanying such products and services.
# Nothing herein should be construed as constituting an additional warranty.
# Micro Focus shall not be liable for technical or editorial errors or omissions contained herein.
# The information contained herein is subject to change without notice.

echo "LRC_RUNNER_RELEASE_NUMBER: ${LRC_RUNNER_RELEASE_NUMBER}, LRC_RUNNER_PACKAGE: ${LRC_RUNNER_PACKAGE}"

if [ ! -e "/tmp/${LRC_RUNNER_PACKAGE}" ]; then
  echo "installing lrcrunner package from github"
  npm i -g --no-save --production https://github.com/weisun10/lrcrunner/releases/download/${LRC_RUNNER_RELEASE_NUMBER}/${LRC_RUNNER_PACKAGE}
else
  echo "installing lrcrunner package from /tmp"
  npm i -g --no-save --production "/tmp/${LRC_RUNNER_PACKAGE}"
fi

if [ $? != 0 ]; then
  echo "failed to install lrcrunner"
  exit 1
fi

lrcrunner --version

BZT_FOLDER=`find /usr/local/lib -name bzt-configs.json -type f | xargs dirname`
echo ${BZT_FOLDER}

cp /usr/lib/node_modules/lrcrunner/sample/taurus/lrc.py ${BZT_FOLDER}/modules/lrc.py
sed -i '/bzt.modules.gatling.GatlingExecutor$/a\
\  lrc:' ${BZT_FOLDER}/resources/10-base-config.yml
sed -i '/lrc:$/a\
\    class: bzt.modules.lrc.LRCExecutor' ${BZT_FOLDER}/resources/10-base-config.yml

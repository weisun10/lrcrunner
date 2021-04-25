#!/bin/bash

npm i -g --no-save --production https://github.com/weisun10/lrcrunner/releases/download/1.0/lrcrunner-1.0.0.tgz
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

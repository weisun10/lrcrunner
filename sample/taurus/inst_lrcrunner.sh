#!/bin/bash

npm i -g --no-save --production https://github.com/weisun10/lrcrunner.git
if [ $? != 0 ]; then
  echo "failed to install lrcrunner"
  exit 1
fi

lrcrunner --version

BZT_FOLDER=`find /usr/local/lib -name bzt-configs.json -type f | xargs dirname`
echo ${BZT_FOLDER}

curl -o ${BZT_FOLDER}/modules/lrc.py https://github.com/weisun10/lrcrunner/blob/main/sample/taurus/lrc.py
sed -i '/bzt.modules.gatling.GatlingExecutor$/a\
\  lrc:' ${BZT_FOLDER}/resources/10-base-config.yml
sed -i '/lrc:$/a\
\    class: bzt.modules.lrc.LRCExecutor' ${BZT_FOLDER}/resources/10-base-config.yml

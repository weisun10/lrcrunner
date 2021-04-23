FROM blazemeter/taurus

LABEL maintainer="wei.sun10@microfocus.com"
RUN curl -fsSL https://github.com/weisun10/lrcrunner/blob/main/sample/taurus/inst_lrcrunner.sh | bash -
WORKDIR /bzt-configs
ENTRYPOINT ["sh", "-c", "bzt -l /tmp/artifacts/bzt.log \"$@\"", "ignored"]
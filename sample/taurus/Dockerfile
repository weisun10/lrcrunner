FROM blazemeter/taurus

LABEL maintainer="wei.sun10@microfocus.com"
ENV LRC_RUNNER_RELEASE_NUMBER 1.0.1
ENV LRC_RUNNER_PACKAGE lrcrunner-1.0.1.tgz

COPY inst_lrcrunner.sh /tmp
COPY ${LRC_RUNNER_PACKAGE} /tmp
RUN bash /tmp/inst_lrcrunner.sh
WORKDIR /bzt-configs
ENTRYPOINT ["sh", "-c", "bzt -l /tmp/artifacts/bzt.log \"$@\"", "ignored"]

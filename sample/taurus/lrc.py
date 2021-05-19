"""
 Copyright 2021 - Micro Focus or one of its affiliates

 The only warranties for products and services of Micro Focus and its affiliates and licensors (“Micro Focus”)
 are as may be set forth in the express warranty statements accompanying such products and services.
 Nothing herein should be construed as constituting an additional warranty.
 Micro Focus shall not be liable for technical or editorial errors or omissions contained herein.
 The information contained herein is subject to change without notice.
"""

import os
from bzt import TaurusConfigError, ToolError
from bzt.engine import HavingInstallableTools
from bzt.modules import ScenarioExecutor, FileLister, SelfDiagnosable
from bzt.modules.console import WidgetProvider, ExecutorWidget
from bzt.modules.aggregator import ResultsReader, ConsolidatingAggregator
from bzt.utils import RequiredTool, CALL_PROBLEMS, FileReader, shutdown_process, is_windows

class LRCExecutor(ScenarioExecutor, FileLister, WidgetProvider, HavingInstallableTools, SelfDiagnosable):
    def __init__(self):
        super(LRCExecutor, self).__init__()
        self.process = None
        self.retcode = None
        self.lrc = None
        self.runner = "lrcrunner"

    def prepare(self):
        super(LRCExecutor, self).prepare()
        self.install_required_tools()

        if is_windows():
            self.runner = "lrcrunner.cmd"

        client_id = self.settings.get("client_id")
        if not client_id:
            raise TaurusConfigError("LRC - 'client_id' should be defined")
        client_secret = self.settings.get("client_secret")
        if not client_secret:
            raise TaurusConfigError("LRC - 'client_secret' should be defined")
        tenant = self.settings.get("tenant")
        if not tenant:
            raise TaurusConfigError("LRC - 'tenant' should be defined")
        url = self.settings.get("url")
        if not url:
            raise TaurusConfigError("LRC - 'url' is missing")

        self.log.info("LRC - url: %s, tenant: %s", url, tenant)

        os.environ["LRC_CLIENT_ID"] = client_id
        os.environ["LRC_CLIENT_SECRET"] = client_secret
        os.environ["LRC_ARTIFACTS_FOLDER"] = os.environ["TAURUS_ARTIFACTS_DIR"]

        self.stdout = open(self.engine.create_artifact("lrc", ".out"), "w")
        self.stderr = open(self.engine.create_artifact("lrc", ".err"), "w")

    def startup(self):
        self.process = self._execute([self.runner, "--run", os.path.join(os.environ["TAURUS_ARTIFACTS_DIR"], "merged.yml")])

    def get_widget(self):
        if not self.widget:
            label = "%s" % self
            self.widget = ExecutorWidget(self, "LRC: " + label.split('/')[1])
        return self.widget

    def check(self):
        self.retcode = self.process.poll()
        if self.retcode is not None:
            if self.retcode != 0:
                raise ToolError("LRC runner exited with non-zero code: %s" % self.retcode,
                                self.get_error_diagnostics())
            return True
        return False

    def get_error_diagnostics(self):
        diagnostics = []
        if self.stderr is not None:
            with open(self.stderr.name) as fds:
                contents = fds.read().strip()
                if contents.strip():
                    diagnostics.append("LRC STDERR:\n" + contents)
        return diagnostics

    def shutdown(self):
        shutdown_process(self.process, self.log)

    def has_results(self):
        return True

    def get_script_path(self, required=False, scenario=None):
        return "script"

    def install_required_tools(self):
        self.lrc = self._get_tool(LRC, config=self.settings)
        self.lrc.tool_name = self.lrc.tool_name.lower()
        if not self.lrc.check_if_installed():
            self.lrc.install()

class LRC(RequiredTool):
    def __init__(self, config=None, **kwargs):
        super(LRC, self).__init__(installable=False, mandatory=False, **kwargs)

    def check_if_installed(self):
        self.log.debug('Checking LRC runner: %s' % self.tool_path)
        try:
            runner = "lrcrunner"
            if is_windows():
                runner = "lrcrunner.cmd"
            out, err = self.call([runner, '--version'])
        except CALL_PROBLEMS as exc:
            self.log.warning("%s check failed: %s", self.tool_name, exc)
            return False

        if err:
            out += err
        self.log.debug("LRC output: %s", out)
        return True

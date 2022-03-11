import { URL } from "url";
import winston = require("winston");
export function loadAndCheckConfig(options: any, isLocalTesting: any, logger: any): Promise<{
    config: any;
    testOpts: any;
    lrcCfg: any;
    lrcUrl: any;
    lrcURLObject: URL;
    proxy: any;
}>;
export function loadAndCheckTestOpts(testOpts: any, logger: any): Promise<{
    projectId: any;
    testId: any;
    name: any;
    scripts: any;
    runTest: any;
    detach: any;
    downloadReport: any;
    settings: any;
    reportTypes: any;
    distributions: any;
    loadGenerators: any;
}>;
export function isOptionEnabled(option: any): boolean;
export function getDashboardUrl(urlObject: any, tenant: any, projectId: any, runId: any, isLocalTesting: any): string;
export function validateReportType(reportTypes: any): any;
export function createLogger(): winston.Logger;
//# sourceMappingURL=utils.d.ts.map
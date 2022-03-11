
export = Client;
declare class Client {
    constructor(tenant: any, url: any, proxy: any, logger: any);
    server: any;
    logger: any;
    tenant: any;
    proxy: {
        host: string;
        port: string;
    };
    _client: any;
    getDefaultOptions(): {
        prefixUrl: any;
        retry: number;
        searchParams: URLSearchParams;
        headers: {
            'content-type': string;
        };
    };
    authClient(json?: {}): Promise<void>;
    credentials: {};
    token: any;
    getTest(projectId: any, testId: any): Promise<any>;
    runTest(projectId: any, testId: any): Promise<any>;
    getTestRunStatus(runId: any): Promise<any>;
    getTestRun(runId: any): Promise<any>;
    getTestRunStatusPolling(runId: any, time?: number): Promise<any>;
    createTest(projectId: any, json: any): Promise<any>;
    getTestSettings(projectId: any, testId: any): Promise<any>;
    updateTestSettings(projectId: any, testId: any, json: any): Promise<any>;
    uploadScript(projectId: any, filePath: any): Promise<any>;
    addTestScript(projectId: any, testId: any, json: any): Promise<any>;
    updateTestScript(projectId: any, testId: any, json: any): Promise<any>;
    getTestDistributionLocations(projectId: any, testId: any): Promise<any>;
    updateTestDistributionLocation(projectId: any, testId: any, locationId: any, json: any): Promise<any>;
    getLoadGenerators(projectId: any): Promise<any>;
    assignLgToTest(projectId: any, testId: any, loadGeneratorId: any): Promise<any>;
    createTestRunReport(runId: any, reportType: any): Promise<any>;
    downloadTestRunReport(fileName: any, reportId: any): Promise<void>;
    checkTestRunReport(reportId: any): Promise<any>;
    getTestRunReportPolling(name: any, reportId: any, time?: number): Promise<any>;
    getRunStatusAndResultReport(runId: any, downloadReport: any, reportTypes: any, artifacts_folder: any): Promise<any>;
}
import { URLSearchParams } from "url";
//# sourceMappingURL=Client.d.ts.map
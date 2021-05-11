/*
 * #© Copyright 2021 - Micro Focus or one of its affiliates
 * #
 * # The only warranties for products and services of Micro Focus and its affiliates and licensors (“Micro Focus”)
 * # are as may be set forth in the express warranty statements accompanying such products and services.
 * # Nothing herein should be construed as constituting an additional warranty.
 * # Micro Focus shall not be liable for technical or editorial errors or omissions contained herein.
 * # The information contained herein is subject to change without notice.
 *
 */

const { URL, URLSearchParams } = require('url');
const fs = require('fs-extra');
const path = require('path');
const got = require('got');
const _ = require('lodash');
const tunnel = require('tunnel');
const FormData = require('form-data');

const MAX_DOWNLOAD_TIME = 10 * 60000;
const MAX_RUN_STATUS_STUCK_TIME = 10 * 60000;
const MAX_RUN_CREATE_REPORT_TIME = 10 * 60000;
const RUN_POLLING_INTERVAL = 20 * 1000;
const REPORT_POLLING_INTERVAL = 15 * 1000;
const MAX_RETRIES_COUNT = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function handleNA(data) {
  if (_.isNil(data)) {
    return 'N/A';
  }

  return data;
}

function getRunStatisticString(data) {
  return `Vusers: ${data.runningVusers}, Passed TX: ${data.passedTrx}, Failed TX: ${data.failedTrx}, TPS: ${handleNA(data.TrxPerSec || data.trxPerSec)}, Hits/s: ${handleNA(data.hitsPerSec)}`;
}

class Client {
  constructor(tenant, url, proxy, logger) {
    this.server = url;
    this.logger = logger;
    this.tenant = tenant;

    if (proxy) {
      const proxyUrl = new URL(proxy);
      this.proxy = {
        host: proxyUrl.hostname,
        port: proxyUrl.port,
      };

      if (!_.isEmpty(proxyUrl.username) && !_.isEmpty(proxyUrl.password)) {
        this.proxy.proxyAuth = `${proxyUrl.username}:${proxyUrl.password}`;
      }
    }

    this._client = got.extend({
      handlers: [
        (options, next) => (async () => {
          const response = await next(options)
            .catch((err) => {
              if (err.response && err.response.body) {
                let currErr;
                try {
                  currErr = new Error(JSON.parse(err.response.body).message);
                } catch (e) {
                  currErr = new Error(err.response.body);
                }
                currErr.statusCode = err.response.statusCode;
                throw currErr;
              }
              throw err;
            });
          let result;
          try {
            result = JSON.parse(response.body);
          } catch (e) {
            // Better to use the response returned 401 error instead
            if ((response.body.indexOf('Sign in with corporate credentials') >= 0)
                && (response.body.indexOf('Submit your email address') >= 0)) {
              const currErr = new Error('Unauthorized');
              currErr.statusCode = 401;
              throw currErr;
            }
            result = response.body;
          }
          return result;
        })(),
      ],
    });
  }

  getDefaultOptions() {
    const options = {
      prefixUrl: this.server,
      retry: 0,
      searchParams: new URLSearchParams(`TENANTID=${this.tenant}`),
      headers: {
        'content-type': 'application/json',
      },
    };
    if (this.token) {
      options.headers.Authorization = `Bearer ${this.token}`;
    }

    if (!_.isEmpty(this.proxy)) {
      options.agent = {
        https: tunnel.httpsOverHttp({
          proxy: this.proxy,
        }),
      };
    }

    return options;
  }

  async authClient(json = {}) {
    const that = this;
    this.credentials = json;
    const opt = this.getDefaultOptions();
    opt.json = json;
    const result = await this._client.post('v1/auth-client', opt)
      .catch((err) => {
        that.logger.error(`authentication failed: ${err.message}`);
        throw err;
      });
    this.token = result.token;
  }

  async getTest(projectId, testId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}`, opt)
      .catch((err) => {
        that.logger.error(`failed to get test: ${err.message}`);
        throw err;
      });
  }

  async runTest(projectId, testId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.post(`v1/projects/${projectId}/load-tests/${testId}/runs`, opt)
      .catch((err) => {
        that.logger.error(`running test failed: ${err.message}`);
        throw err;
      });
  }

  async getTestRunStatus(runId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/${runId}/status`, opt)
      .catch((err) => {
        that.logger.error(`getting run status failed: ${err.message}`);
        throw err;
      });
  }

  async getTestRun(runId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/${runId}`, opt)
      .catch((err) => {
        that.logger.error(`getting run result failed: ${err.message}`);
        throw err;
      });
  }

  async getTestRunStatusPolling(runId, time = 5000) {
    const that = this;
    let retriesCount = 0; // number of times to check whether the test run has been terminated

    let timeOut = null; // will set timeout for same detailed state
    let sameDetailedStatusCount = 0; // number of times in the same detail state
    let lastDetailedStatus = null; // the detail status of last polling
    const needSetTimeoutDetailedStatus = ['INITIALIZING', 'STOPPING'];
    const noResultDetailedStatus = ['SYSTEM_ERROR', 'HALTED', 'ABORTED'];
    const hasReportUIStatus = ['FAILED', 'PASSED', 'STOPPED'];
    const originalInterval = time;
    let interval = time;

    async function polling() {
      await wait(interval);
      const currStatus = await that.getTestRunStatus(runId);
      if (currStatus.detailedStatus === 'RUNNING') {
        interval = 10;
      } else {
        interval = originalInterval;
      }

      if (currStatus.detailedStatus === 'RUNNING') {
        that.logger.info(`RUNNING - ${getRunStatisticString(currStatus)}`);
      } else if (_.includes(noResultDetailedStatus, currStatus.detailedStatus)) {
        throw new Error(currStatus.detailedStatus);
      } else {
        that.logger.info(currStatus.detailedStatus);
      }

      if (lastDetailedStatus === currStatus.detailedStatus) {
        sameDetailedStatusCount += 1;
      } else {
        sameDetailedStatusCount = 0;
      }
      lastDetailedStatus = currStatus.detailedStatus;
      if (currStatus.status === 'in-progress') {
        if (_.includes(needSetTimeoutDetailedStatus, currStatus.detailedStatus)) {
          if (sameDetailedStatusCount === 1) {
          // only the first time here for each detail status
            return Promise.race([
              polling(),
              new Promise((resolve, reject) => {
                timeOut = setTimeout(() => reject(
                  new Error(`test run "${currStatus.detailedStatus}" time exceeds 10 minutes`),
                ), MAX_RUN_STATUS_STUCK_TIME);
              }),
            ]).then((result) => {
              clearTimeout(timeOut);
              timeOut = null;
              return result;
            }).catch((err) => {
              clearTimeout(timeOut);
              timeOut = null;
              throw err;
            });
          }
        } else {
          clearTimeout(timeOut);
          timeOut = null;
        }

        return polling();
      }

      clearTimeout(timeOut);
      timeOut = null;

      // check if the test run is terminated
      let hasReport = false;
      do {
        const isTerminated = _.get(await that.getTestRun(runId), 'isTerminated');
        hasReport = _.includes(hasReportUIStatus, currStatus.detailedStatus) && isTerminated;
        retriesCount += 1;

        await wait(time);
      } while (!hasReport && retriesCount <= MAX_RETRIES_COUNT);
      if (!hasReport) {
        throw new Error('no report');
      }
      return null;
    }

    return polling();
  }

  async createTest(projectId, json) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.post(`v1/projects/${projectId}/load-tests`, opt)
      .catch((err) => {
        that.logger.error(`creating test failed: ${err.message}`);
        throw err;
      });
  }

  async getTestSettings(projectId, testId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}/settings`, opt)
      .catch((err) => {
        that.logger.error(`getting test settings failed: ${err.message}`);
        throw err;
      });
  }

  async updateTestSettings(projectId, testId, json) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/settings`, opt)
      .catch((err) => {
        that.logger.error(`updating test settings failed: ${err.message}`);
        throw err;
      });
  }

  async uploadScript(projectId, filePath) {
    const that = this;
    const stats = await fs.promises.stat(filePath);
    if (!stats || !stats.size) {
      const err = new Error(`file '${filePath}' does not exist`);
      err.statusCode = 400;
      that.logger.error(err.message);
      throw err;
    }
    const opt = this.getDefaultOptions();
    const form = new FormData();
    form.append('file', fs.createReadStream(path.resolve(process.cwd(), filePath)));
    opt.body = form;
    opt.headers['content-type'] = `multipart/form-data; boundary=${form.getBoundary()}`;
    return this._client.post(`v1/projects/${projectId}/scripts`, opt)
      .catch((err) => {
        that.logger.error(`uploading script failed: ${err.message}`);
        throw err;
      });
  }

  async addTestScript(projectId, testId, json) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.post(`v1/projects/${projectId}/load-tests/${testId}/scripts`, opt)
      .catch((err) => {
        that.logger.error(`adding test script failed: ${err.message}`);
        throw err;
      });
  }

  async updateTestScript(projectId, testId, json) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = [json];
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/scripts`, opt)
      .then((testScripts) => (testScripts.length ? testScripts[0] : {}))
      .catch((err) => {
        that.logger.error(`updating test script failed: ${err.message}`);
        throw err;
      });
  }

  async getTestDistributionLocations(projectId, testId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-tests/${testId}/locations`, opt)
      .catch((err) => {
        that.logger.error(`getting test locations failed: ${err.message}`);
        throw err;
      });
  }

  async updateTestDistributionLocation(projectId, testId, locationId, json) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = json;
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/locations/${locationId}`, opt)
      .catch((err) => {
        that.logger.error(`updating test script location failed: ${err.message}`);
        throw err;
      });
  }

  async getLoadGenerators(projectId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/projects/${projectId}/load-generators`, opt)
      .catch((err) => {
        that.logger.error(`getting load generators failed: ${err.message}`);
        throw err;
      });
  }

  async assignLgToTest(projectId, testId, loadGeneratorId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.put(`v1/projects/${projectId}/load-tests/${testId}/load-generators/${loadGeneratorId}`, opt)
      .catch((err) => {
        that.logger.error(`assigning load generator to test failed: ${err.message}`);
        throw err;
      });
  }

  async createTestRunReport(runId, reportType) {
    const that = this;
    const opt = this.getDefaultOptions();
    opt.json = { reportType };
    return this._client.post(`v1/test-runs/${runId}/reports`, opt)
      .catch((err) => {
        that.logger.error(`creating run report failed: ${err.message}`);
        throw err;
      });
  }

  async downloadTestRunReport(fileName, reportId) {
    const that = this;

    const opt = this.getDefaultOptions();
    opt.isStream = true;
    const downloadStream = got(`v1/test-runs/reports/${reportId}`, opt);
    const fileWriterStream = fs.createWriteStream(fileName);

    const downloadPromise = () => new Promise((resolve, reject) => {
      let isNotReturn = true;
      try {
        let transferredNums = [];
        downloadStream
          .on('downloadProgress', ({ transferred }) => {
            transferredNums.push(transferred);
            if (transferredNums.length > 15) {
              that.logger.info(`downloading report ...... ${transferred} (bytes)`);
              transferredNums = [];
            }
          }).on('end', () => {
            if (transferredNums.length > 0) {
              that.logger.info(`downloading report ...... ${_.last(transferredNums)} (bytes)`);
              transferredNums = [];
            }
          }).on('error', (error) => {
            that.logger.error(`downloading failed: ${error.message}`);
            if (isNotReturn) {
              isNotReturn = false;
              return reject(error);
            }
            return null;
          });

        fileWriterStream
          .on('error', (error) => {
            that.logger.error(`failed to write file: ${error.message}`);
            if (isNotReturn) {
              isNotReturn = false;
              return reject(error);
            }
            return null;
          })
          .on('finish', () => {
            that.logger.info(`report saved to ${fileName}`);
            if (isNotReturn) {
              isNotReturn = false;
              return resolve();
            }
            return null;
          });

        downloadStream.pipe(fileWriterStream);
      } catch (e) {
        if (isNotReturn) {
          isNotReturn = false;
          return reject(e);
        }
      }
      return null;
    })
      .catch((err) => {
        that.logger.error(`download report failed: ${err.message}`);
        throw err;
      });

    let timeOut = null;
    return Promise.race([
      downloadPromise(),
      new Promise((resolve, reject) => {
        timeOut = setTimeout(() => {
          downloadStream.destroy();
          fileWriterStream.destroy();
          return reject(new Error('Download time exceeds 10 minutes'));
        }, MAX_DOWNLOAD_TIME);
      }),
    ]).then(() => {
      clearTimeout(timeOut);
      timeOut = null;
    });
  }

  async checkTestRunReport(reportId) {
    const that = this;
    const opt = this.getDefaultOptions();
    return this._client.get(`v1/test-runs/reports/${reportId}`, opt)
      .catch((err) => {
        that.logger.error(`checking run report failed: ${err.message}`);
        throw err;
      });
  }

  async getTestRunReportPolling(name, reportId, time = 5000) {
    const that = this;
    let hasStartedToGenerate = false;
    let timeOut = null;
    async function polling() {
      const currReport = await that.checkTestRunReport(reportId);
      await wait(time);
      if (currReport.message === 'In progress') {
        if (!hasStartedToGenerate) {
          hasStartedToGenerate = true;
          // only the first time here
          return Promise.race([
            polling(),
            new Promise((resolve, reject) => {
              timeOut = setTimeout(() => reject(
                new Error(`create test run report (${reportId}) time exceeds 10 minutes`),
              ), MAX_RUN_CREATE_REPORT_TIME);
            }),
          ]).then((result) => {
            clearTimeout(timeOut);
            timeOut = null;
            return result;
          }).catch((err) => {
            clearTimeout(timeOut);
            timeOut = null;
            throw err;
          });
        }

        that.logger.info(`report (${reportId}) is not yet ready`);
        return polling();
      }
      that.logger.info('report is ready, going to download it');
      await that.downloadTestRunReport(name, reportId);
      return currReport;
    }

    await wait(time);
    return polling();
  }

  async getRunStatusAndResultReport(runId, downloadReport, reportTypes, artifacts_folder) {
    const that = this;
    let needReLogin = false;
    let needRetry = false;
    let retriesCount = 0;
    do {
      try {
        if (that.credentials && needReLogin) {
          await that.authClient(that.credentials);
        }
        await that.getTestRunStatusPolling(runId, RUN_POLLING_INTERVAL);
        if (!downloadReport) {
          return null;
        }

        const getReport = async (reportType) => {
          that.logger.info(`preparing report (${reportType}) ...`);
          const resultPath = path.join(artifacts_folder, `./results_run_${runId}.${reportType}`);
          const report = await that.createTestRunReport(runId, reportType);
          if (_.isSafeInteger(_.get(report, 'reportId'))) {
            return that.getTestRunReportPolling(resultPath, report.reportId, REPORT_POLLING_INTERVAL);
          }
          return that.logger.info(`report (${reportType}) is not available`);
        };

        this.logger.info(`requested reports: ${reportTypes}`);
        let reportPromise = Promise.resolve();
        _.forEach(reportTypes, (type) => {
          reportPromise = reportPromise.then(() => getReport(type));
        });
        await reportPromise;

        needRetry = false;
      } catch (err) {
        if (retriesCount < MAX_RETRIES_COUNT && err.statusCode === 401) {
          needReLogin = true;
          needRetry = true;
          retriesCount += 1;
        } else {
          throw err;
        }
      }
    } while (needRetry);
    return null;
  }
}

module.exports = Client;
